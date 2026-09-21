import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const errorTypeEnum = pgEnum("error_type", [
  "console_error",
  "network_error",
]);

export const batchStatusEnum = pgEnum("batch_status", [
  "received",
  "processing",
  "processed",
  "failed",
]);

export const groupStatusEnum = pgEnum("group_status", ["open", "resolved"]);

export const receiptOutcomeEnum = pgEnum("receipt_outcome", [
  "accepted",
  "duplicate",
]);

export const ingestionBatches = pgTable(
  "ingestion_batches",
  {
    batchId: uuid("batch_id").primaryKey(),
    schemaVersion: smallint("schema_version").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    status: batchStatusEnum("status").default("received").notNull(),
    requestSizeBytes: integer("request_size_bytes").notNull(),
    bodyHash: varchar("body_hash", { length: 64 }).notNull(),
    eventCount: integer("event_count").notNull(),
    acceptedCount: integer("accepted_count").default(0).notNull(),
    duplicateCount: integer("duplicate_count").default(0).notNull(),
    failureReason: text("failure_reason"),
  },
  (table) => [
    index("ingestion_batches_status_idx").on(table.status),
    check(
      "ingestion_batches_request_size_check",
      sql`${table.requestSizeBytes} between 1 and 512000`,
    ),
    check(
      "ingestion_batches_event_count_check",
      sql`${table.eventCount} between 1 and 5000`,
    ),
    check(
      "ingestion_batches_accepted_count_check",
      sql`${table.acceptedCount} >= 0`,
    ),
    check(
      "ingestion_batches_duplicate_count_check",
      sql`${table.duplicateCount} >= 0`,
    ),
  ],
);

export const errorGroups = pgTable(
  "error_groups",
  {
    groupId: uuid("group_id").defaultRandom().primaryKey(),
    groupingVersion: smallint("grouping_version").notNull(),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    type: errorTypeEnum("type").notNull(),
    title: text("title").notNull(),
    culprit: text("culprit"),
    status: groupStatusEnum("status").default("open").notNull(),
    eventCount: integer("event_count").default(0).notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("error_groups_fingerprint_version_uidx").on(
      table.groupingVersion,
      table.fingerprint,
    ),
    index("error_groups_inbox_idx").on(table.status, table.lastSeenAt),
    check("error_groups_event_count_check", sql`${table.eventCount} > 0`),
    check(
      "error_groups_grouping_version_check",
      sql`${table.groupingVersion} > 0`,
    ),
  ],
);

export const errorEvents = pgTable(
  "error_events",
  {
    eventId: uuid("event_id").primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => ingestionBatches.batchId, { onDelete: "cascade" }),
    sequenceNumber: integer("sequence_number").notNull(),
    type: errorTypeEnum("type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
    normalizedSummary: text("normalized_summary"),
    fingerprint: varchar("fingerprint", { length: 64 }),
    groupingVersion: smallint("grouping_version").default(1).notNull(),
    groupId: uuid("group_id").references(() => errorGroups.groupId, {
      onDelete: "set null",
    }),
    groupWasCreated: boolean("group_was_created").default(false).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [
    index("error_events_batch_idx").on(table.batchId),
    index("error_events_group_occurred_idx").on(
      table.groupId,
      table.occurredAt,
    ),
    index("error_events_fingerprint_idx").on(table.fingerprint),
    check(
      "error_events_sequence_number_check",
      sql`${table.sequenceNumber} >= 0`,
    ),
    check(
      "error_events_grouping_version_check",
      sql`${table.groupingVersion} > 0`,
    ),
  ],
);

export const batchEventReceipts = pgTable(
  "batch_event_receipts",
  {
    batchId: uuid("batch_id")
      .notNull()
      .references(() => ingestionBatches.batchId, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => errorEvents.eventId, { onDelete: "cascade" }),
    sequenceNumber: integer("sequence_number").notNull(),
    outcome: receiptOutcomeEnum("outcome").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.batchId, table.eventId] }),
    index("batch_event_receipts_batch_sequence_idx").on(
      table.batchId,
      table.sequenceNumber,
    ),
    check(
      "batch_event_receipts_sequence_number_check",
      sql`${table.sequenceNumber} >= 0`,
    ),
  ],
);

export type ErrorGroupRow = typeof errorGroups.$inferSelect;
export type ErrorEventRow = typeof errorEvents.$inferSelect;
