import { z } from "zod";

export const INGEST_SCHEMA_VERSION = 1 as const;
export const GROUPING_VERSION = 1 as const;
export const MAX_BATCH_BODY_BYTES = 500 * 1024;
export const BATCH_FLUSH_INTERVAL_MS = 3_000;

const isoTimestampSchema = z.string().datetime({ offset: true });

export const consoleErrorPayloadSchema = z
  .object({
    error_name: z.string().trim().min(1).max(200).optional(),
    message: z.string().trim().min(1).max(20_000),
    stack: z.string().max(100_000).optional(),
    source: z.string().max(2_000).optional(),
    line: z.number().int().nonnegative().optional(),
    column: z.number().int().nonnegative().optional(),
  })
  .strict();

export const networkErrorPayloadSchema = z
  .object({
    request: z
      .object({
        method: z.string().trim().min(1).max(20),
        url: z.string().url().max(8_000),
        operation: z.string().trim().min(1).max(200).optional(),
      })
      .strict(),
    response: z
      .object({
        status: z.number().int().min(100).max(599),
        status_text: z.string().max(500).optional(),
        content_type: z.string().max(500).optional(),
        error_code: z.string().trim().min(1).max(500).optional(),
        error_message: z.string().trim().min(1).max(20_000).optional(),
        body_sample_hash: z
          .string()
          .regex(/^sha256:[a-f0-9]{64}$/)
          .optional(),
      })
      .strict()
      .optional(),
    failure: z
      .object({
        kind: z.enum([
          "http",
          "timeout",
          "abort",
          "network",
          "cors_or_network",
          "unknown",
        ]),
        name: z.string().max(500).optional(),
        message: z.string().max(20_000).optional(),
        stack: z.string().max(100_000).optional(),
      })
      .strict(),
    timing: z
      .object({
        duration_ms: z.number().nonnegative().finite(),
      })
      .strict()
      .optional(),
    context: z
      .object({
        page_url: z.string().url().max(8_000).optional(),
        release: z.string().max(500).optional(),
        environment: z.string().max(200).optional(),
        trace_id: z.string().max(500).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const consoleErrorEventSchema = z
  .object({
    event_id: z.string().uuid(),
    type: z.literal("console_error"),
    timestamp: isoTimestampSchema,
    payload: consoleErrorPayloadSchema,
  })
  .strict();

export const networkErrorEventSchema = z
  .object({
    event_id: z.string().uuid(),
    type: z.literal("network_error"),
    timestamp: isoTimestampSchema,
    payload: networkErrorPayloadSchema,
  })
  .strict();

export const errorEventSchema = z.discriminatedUnion("type", [
  consoleErrorEventSchema,
  networkErrorEventSchema,
]);

export const ingestBatchSchema = z
  .object({
    schema_version: z.literal(INGEST_SCHEMA_VERSION),
    batch_id: z.string().uuid(),
    timestamp: isoTimestampSchema,
    errors: z.array(errorEventSchema).min(1).max(5_000),
  })
  .strict()
  .superRefine((batch, context) => {
    const seen = new Set<string>();

    batch.errors.forEach((event, index) => {
      if (seen.has(event.event_id)) {
        context.addIssue({
          code: "custom",
          path: ["errors", index, "event_id"],
          message: "event_id must be unique within a batch",
        });
      }
      seen.add(event.event_id);
    });
  });

export type ConsoleErrorPayload = z.infer<typeof consoleErrorPayloadSchema>;
export type NetworkErrorPayload = z.infer<typeof networkErrorPayloadSchema>;
export type ConsoleErrorEvent = z.infer<typeof consoleErrorEventSchema>;
export type NetworkErrorEvent = z.infer<typeof networkErrorEventSchema>;
export type ErrorEvent = z.infer<typeof errorEventSchema>;
export type IngestBatch = z.infer<typeof ingestBatchSchema>;

export interface IngestEventResult {
  event_id: string;
  group_id: string | null;
  outcome: "accepted" | "duplicate";
  is_new_group: boolean;
}

export interface IngestSuccessResponse {
  batch_id: string;
  status: "processed";
  accepted_count: number;
  duplicate_count: number;
  groups_touched: number;
  processed_at: string | null;
  idempotent_replay: boolean;
  results: IngestEventResult[];
}

export interface IngestErrorResponse {
  error: {
    code: string;
    message: string;
    issues?: Array<{ path: string; message: string }>;
  };
}
