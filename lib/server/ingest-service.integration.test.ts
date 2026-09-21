import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { closeDatabase, db } from "@/db/client";
import { errorGroups, ingestionBatches } from "@/db/schema";
import type { IngestBatch } from "@/lib/contracts/ingest";
import { ingestBatch } from "@/lib/server/ingest-service";
import { sha256 } from "@/lib/server/serialization";

const batchIds = new Set<string>();
const groupIds = new Set<string>();

function createBatch(message: string): IngestBatch {
  const batchId = randomUUID();
  batchIds.add(batchId);

  return {
    schema_version: 1,
    batch_id: batchId,
    timestamp: new Date().toISOString(),
    errors: [
      {
        event_id: randomUUID(),
        type: "console_error",
        timestamp: new Date().toISOString(),
        payload: {
          error_name: "Error",
          message,
          stack: "Error\n at saveOrder (app/orders.ts:10:2)",
        },
      },
    ],
  };
}

async function send(batch: IngestBatch) {
  const body = JSON.stringify(batch);
  const result = await ingestBatch(
    batch,
    Buffer.byteLength(body),
    sha256(body),
  );

  result.response.results.forEach((receipt) => {
    if (receipt.group_id) groupIds.add(receipt.group_id);
  });
  return result;
}

afterEach(async () => {
  if (batchIds.size) {
    await db
      .delete(ingestionBatches)
      .where(inArray(ingestionBatches.batchId, [...batchIds]));
  }
  if (groupIds.size) {
    await db
      .delete(errorGroups)
      .where(inArray(errorGroups.groupId, [...groupIds]));
  }
  batchIds.clear();
  groupIds.clear();
});

afterAll(async () => {
  await closeDatabase();
});

describe("ingestBatch integration", () => {
  it("serializes concurrent retries of the same batch", async () => {
    const batch = createBatch(`Concurrent replay ${randomUUID()}`);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => send(batch)),
    );

    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(results.filter((result) => result.replayed)).toHaveLength(4);
    expect(
      new Set(results.map((result) => result.response.results[0].group_id))
        .size,
    ).toBe(1);

    const groupId = results[0].response.results[0].group_id;
    expect(groupId).not.toBeNull();
    const [group] = await db
      .select({ eventCount: errorGroups.eventCount })
      .from(errorGroups)
      .where(eq(errorGroups.groupId, groupId!));
    expect(group.eventCount).toBe(1);
  });

  it("atomically increments a group across concurrent batches", async () => {
    const sharedMessage = `Concurrent grouping ${randomUUID()}`;
    const batches = Array.from({ length: 8 }, () => createBatch(sharedMessage));

    const results = await Promise.all(batches.map(send));
    const resultGroupIds = new Set(
      results.map((result) => result.response.results[0].group_id),
    );

    expect(resultGroupIds.size).toBe(1);
    const groupId = results[0].response.results[0].group_id;
    expect(groupId).not.toBeNull();
    const [group] = await db
      .select({ eventCount: errorGroups.eventCount })
      .from(errorGroups)
      .where(eq(errorGroups.groupId, groupId!));
    expect(group.eventCount).toBe(8);
  });
});
