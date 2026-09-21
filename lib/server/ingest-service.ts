import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  batchEventReceipts,
  errorEvents,
  errorGroups,
  ingestionBatches,
} from "@/db/schema";
import {
  errorEventSchema,
  type ErrorEvent,
  type IngestBatch,
  type IngestSuccessResponse,
} from "@/lib/contracts/ingest";
import { groupErrorEvent } from "@/lib/grouping";
import { sha256, stableStringify } from "@/lib/server/serialization";

export class IngestConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestConflictError";
  }
}

interface StoredEventInput {
  event: ErrorEvent;
  sequenceNumber: number;
  payloadHash: string;
}

function eventPayloadHash(event: ErrorEvent): string {
  return sha256(
    stableStringify({
      type: event.type,
      timestamp: event.timestamp,
      payload: event.payload,
    }),
  );
}

async function readBatchResponse(
  batchId: string,
  idempotentReplay: boolean,
): Promise<IngestSuccessResponse> {
  const [batch] = await db
    .select()
    .from(ingestionBatches)
    .where(eq(ingestionBatches.batchId, batchId))
    .limit(1);

  if (!batch || batch.status !== "processed") {
    throw new Error(`Processed batch ${batchId} could not be read`);
  }

  const receipts = await db
    .select({
      eventId: batchEventReceipts.eventId,
      outcome: batchEventReceipts.outcome,
      groupId: errorEvents.groupId,
      groupWasCreated: errorEvents.groupWasCreated,
    })
    .from(batchEventReceipts)
    .innerJoin(errorEvents, eq(batchEventReceipts.eventId, errorEvents.eventId))
    .where(eq(batchEventReceipts.batchId, batchId))
    .orderBy(asc(batchEventReceipts.sequenceNumber));

  const touchedGroups = new Set(
    receipts
      .filter((receipt) => receipt.outcome === "accepted")
      .map((receipt) => receipt.groupId)
      .filter((groupId): groupId is string => Boolean(groupId)),
  );

  return {
    batch_id: batch.batchId,
    status: "processed",
    accepted_count: batch.acceptedCount,
    duplicate_count: batch.duplicateCount,
    groups_touched: touchedGroups.size,
    processed_at: batch.processedAt?.toISOString() ?? null,
    idempotent_replay: idempotentReplay,
    results: receipts.map((receipt) => ({
      event_id: receipt.eventId,
      group_id: receipt.groupId,
      outcome: receipt.outcome,
      is_new_group: receipt.outcome === "accepted" && receipt.groupWasCreated,
    })),
  };
}

async function storeBatch(
  batch: IngestBatch,
  requestSizeBytes: number,
  bodyHash: string,
): Promise<{ created: boolean }> {
  const prepared: StoredEventInput[] = batch.errors.map((event, index) => ({
    event,
    sequenceNumber: index,
    payloadHash: eventPayloadHash(event),
  }));

  return db.transaction(async (transaction) => {
    const insertedBatch = await transaction
      .insert(ingestionBatches)
      .values({
        batchId: batch.batch_id,
        schemaVersion: batch.schema_version,
        sentAt: new Date(batch.timestamp),
        status: "received",
        requestSizeBytes,
        bodyHash,
        eventCount: batch.errors.length,
      })
      .onConflictDoNothing({ target: ingestionBatches.batchId })
      .returning({ batchId: ingestionBatches.batchId });

    if (!insertedBatch.length) {
      const [existingBatch] = await transaction
        .select({ bodyHash: ingestionBatches.bodyHash })
        .from(ingestionBatches)
        .where(eq(ingestionBatches.batchId, batch.batch_id))
        .limit(1);

      if (!existingBatch || existingBatch.bodyHash !== bodyHash) {
        throw new IngestConflictError(
          `batch_id ${batch.batch_id} was already used with a different body`,
        );
      }

      return { created: false };
    }

    const insertedEvents = await transaction
      .insert(errorEvents)
      .values(
        prepared.map(({ event, sequenceNumber, payloadHash }) => ({
          eventId: event.event_id,
          batchId: batch.batch_id,
          sequenceNumber,
          type: event.type,
          occurredAt: new Date(event.timestamp),
          payload: event.payload,
          payloadHash,
        })),
      )
      .onConflictDoNothing({ target: errorEvents.eventId })
      .returning({ eventId: errorEvents.eventId });

    const acceptedIds = new Set(insertedEvents.map((event) => event.eventId));
    const eventIds = prepared.map((item) => item.event.event_id);
    const persistedEvents = await transaction
      .select({
        eventId: errorEvents.eventId,
        payloadHash: errorEvents.payloadHash,
      })
      .from(errorEvents)
      .where(inArray(errorEvents.eventId, eventIds));
    const persistedById = new Map(
      persistedEvents.map((event) => [event.eventId, event]),
    );

    for (const item of prepared) {
      const persisted = persistedById.get(item.event.event_id);
      if (!persisted) {
        throw new Error(`Event ${item.event.event_id} was not persisted`);
      }
      if (persisted.payloadHash !== item.payloadHash) {
        throw new IngestConflictError(
          `event_id ${item.event.event_id} was already used with different content`,
        );
      }
    }

    await transaction.insert(batchEventReceipts).values(
      prepared.map((item) => ({
        batchId: batch.batch_id,
        eventId: item.event.event_id,
        sequenceNumber: item.sequenceNumber,
        outcome: acceptedIds.has(item.event.event_id)
          ? ("accepted" as const)
          : ("duplicate" as const),
      })),
    );

    await transaction
      .update(ingestionBatches)
      .set({
        acceptedCount: acceptedIds.size,
        duplicateCount: prepared.length - acceptedIds.size,
      })
      .where(eq(ingestionBatches.batchId, batch.batch_id));

    return { created: true };
  });
}

async function processStoredBatch(batchId: string): Promise<void> {
  try {
    await db.transaction(async (transaction) => {
      // Different requests for the same batch may race after durable storage.
      // A transaction-scoped advisory lock serializes processing and is released
      // automatically on commit, rollback, or connection loss.
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${batchId}, 0))`,
      );

      const [batch] = await transaction
        .select({ status: ingestionBatches.status })
        .from(ingestionBatches)
        .where(eq(ingestionBatches.batchId, batchId))
        .limit(1);

      if (!batch) throw new Error(`Batch ${batchId} does not exist`);
      if (batch.status === "processed") return;

      await transaction
        .update(ingestionBatches)
        .set({ status: "processing", failureReason: null })
        .where(eq(ingestionBatches.batchId, batchId));

      const pendingEvents = await transaction
        .select()
        .from(errorEvents)
        .where(
          and(eq(errorEvents.batchId, batchId), isNull(errorEvents.groupId)),
        );

      const projected = pendingEvents.map((event) => {
        const sourceEvent = errorEventSchema.parse({
          event_id: event.eventId,
          type: event.type,
          timestamp: event.occurredAt.toISOString(),
          payload: event.payload,
        });

        return { event, projection: groupErrorEvent(sourceEvent) };
      });

      const byFingerprint = new Map<string, typeof projected>();
      for (const item of projected) {
        const key = `${item.projection.groupingVersion}:${item.projection.fingerprint}`;
        const groupItems = byFingerprint.get(key) ?? [];
        groupItems.push(item);
        byFingerprint.set(key, groupItems);
      }

      for (const items of byFingerprint.values()) {
        const sample = items[items.length - 1];
        const projection = sample.projection;
        const eventDates = items.map((item) => item.event.occurredAt);
        const firstSeenAt = new Date(
          Math.min(...eventDates.map((date) => date.getTime())),
        );
        const lastSeenAt = new Date(
          Math.max(...eventDates.map((date) => date.getTime())),
        );
        const insertedGroup = await transaction
          .insert(errorGroups)
          .values({
            groupingVersion: projection.groupingVersion,
            fingerprint: projection.fingerprint,
            type: sample.event.type,
            title: projection.title,
            culprit: projection.culprit,
            eventCount: items.length,
            firstSeenAt,
            lastSeenAt,
          })
          .onConflictDoNothing({
            target: [errorGroups.groupingVersion, errorGroups.fingerprint],
          })
          .returning({ groupId: errorGroups.groupId });

        const groupWasCreated = insertedGroup.length === 1;
        let groupId = insertedGroup[0]?.groupId;

        if (!groupId) {
          const [updatedGroup] = await transaction
            .update(errorGroups)
            .set({
              title: projection.title,
              culprit: projection.culprit,
              eventCount: sql`${errorGroups.eventCount} + ${items.length}`,
              firstSeenAt: sql`least(${errorGroups.firstSeenAt}, ${firstSeenAt.toISOString()}::timestamptz)`,
              lastSeenAt: sql`greatest(${errorGroups.lastSeenAt}, ${lastSeenAt.toISOString()}::timestamptz)`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(errorGroups.groupingVersion, projection.groupingVersion),
                eq(errorGroups.fingerprint, projection.fingerprint),
              ),
            )
            .returning({ groupId: errorGroups.groupId });

          if (!updatedGroup) {
            throw new Error(
              `Group ${projection.fingerprint} disappeared during upsert`,
            );
          }
          groupId = updatedGroup.groupId;
        }

        await transaction
          .update(errorEvents)
          .set({
            normalizedSummary: projection.normalizedSummary,
            fingerprint: projection.fingerprint,
            groupingVersion: projection.groupingVersion,
            groupId,
            groupWasCreated,
            processedAt: new Date(),
          })
          .where(
            inArray(
              errorEvents.eventId,
              items.map((item) => item.event.eventId),
            ),
          );
      }

      await transaction
        .update(ingestionBatches)
        .set({ status: "processed", processedAt: new Date() })
        .where(eq(ingestionBatches.batchId, batchId));
    });
  } catch (error) {
    const failureReason =
      error instanceof Error ? error.message.slice(0, 2_000) : "Unknown error";

    try {
      await db
        .update(ingestionBatches)
        .set({ status: "failed", failureReason })
        .where(eq(ingestionBatches.batchId, batchId));
    } catch {
      // Preserve the processing error if the database itself is unavailable.
    }
    throw error;
  }
}

export async function ingestBatch(
  batch: IngestBatch,
  requestSizeBytes: number,
  bodyHash: string,
): Promise<{ response: IngestSuccessResponse; replayed: boolean }> {
  const stored = await storeBatch(batch, requestSizeBytes, bodyHash);
  await processStoredBatch(batch.batch_id);

  return {
    response: await readBatchResponse(batch.batch_id, !stored.created),
    replayed: !stored.created,
  };
}
