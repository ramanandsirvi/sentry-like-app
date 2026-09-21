import {
  BATCH_FLUSH_INTERVAL_MS,
  INGEST_SCHEMA_VERSION,
  MAX_BATCH_BODY_BYTES,
  type ErrorEvent,
  type IngestBatch,
  type IngestSuccessResponse,
} from "@/lib/contracts/ingest";

type FlushReason = "interval" | "size" | "manual";

interface PendingBatch {
  batch: IngestBatch;
  reason: FlushReason;
  attempts: number;
}

export interface BatcherSnapshot {
  queuedEventCount: number;
  queuedBytes: number;
  pendingBatchCount: number;
  pendingEventCount: number;
  isSending: boolean;
  nextFlushAt: number | null;
  lastBatch: {
    batchId: string;
    reason: FlushReason;
    response: IngestSuccessResponse;
  } | null;
  lastError: string | null;
}

type BatchSender = (batch: IngestBatch) => Promise<IngestSuccessResponse>;
type SnapshotListener = (snapshot: BatcherSnapshot) => void;

const ESTIMATE_BATCH_ID = "00000000-0000-4000-8000-000000000000";
const ESTIMATE_TIMESTAMP = "2000-01-01T00:00:00.000Z";

function bodyBytes(batch: IngestBatch): number {
  return new TextEncoder().encode(JSON.stringify(batch)).byteLength;
}

function envelopeForEstimate(errors: ErrorEvent[]): IngestBatch {
  return {
    schema_version: INGEST_SCHEMA_VERSION,
    batch_id: ESTIMATE_BATCH_ID,
    timestamp: ESTIMATE_TIMESTAMP,
    errors,
  };
}

export class ErrorBatcher {
  private queue: ErrorEvent[] = [];
  private outbox: PendingBatch[] = [];
  private listeners = new Set<SnapshotListener>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private nextFlushAt: number | null = null;
  private isSending = false;
  private lastBatch: BatcherSnapshot["lastBatch"] = null;
  private lastError: string | null = null;

  constructor(private readonly send: BatchSender) {}

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  capture(event: ErrorEvent): void {
    const singleEventBytes = bodyBytes(envelopeForEstimate([event]));
    if (singleEventBytes > MAX_BATCH_BODY_BYTES) {
      throw new Error(
        `Event ${event.event_id} is ${singleEventBytes} bytes and exceeds the batch limit`,
      );
    }

    const candidate = [...this.queue, event];
    if (bodyBytes(envelopeForEstimate(candidate)) > MAX_BATCH_BODY_BYTES) {
      this.sealCurrentBatch("size");
    }

    this.queue.push(event);
    if (this.queue.length === 1) {
      this.scheduleIntervalFlush();
    }
    this.emit();
  }

  flush(reason: FlushReason = "manual"): void {
    this.sealCurrentBatch(reason);
  }

  dispose(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.flushTimer = null;
    this.retryTimer = null;
    this.nextFlushAt = null;
    this.listeners.clear();
  }

  private scheduleIntervalFlush(): void {
    if (this.flushTimer) return;
    this.nextFlushAt = Date.now() + BATCH_FLUSH_INTERVAL_MS;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.nextFlushAt = null;
      this.sealCurrentBatch("interval");
    }, BATCH_FLUSH_INTERVAL_MS);
  }

  private sealCurrentBatch(reason: FlushReason): void {
    if (!this.queue.length) return;

    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.nextFlushAt = null;

    const batch: IngestBatch = {
      schema_version: INGEST_SCHEMA_VERSION,
      batch_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      errors: this.queue,
    };

    this.queue = [];
    this.outbox.push({ batch, reason, attempts: 0 });
    this.emit();
    void this.drainOutbox();
  }

  private async drainOutbox(): Promise<void> {
    if (this.isSending || !this.outbox.length) return;

    const pending = this.outbox[0];
    pending.attempts += 1;
    this.isSending = true;
    this.lastError = null;
    this.emit();

    let succeeded = false;
    try {
      const response = await this.send(pending.batch);
      this.outbox.shift();
      this.lastBatch = {
        batchId: pending.batch.batch_id,
        reason: pending.reason,
        response,
      };
      succeeded = true;
    } catch (error) {
      this.lastError =
        error instanceof Error ? error.message : "Unknown ingestion error";
      if (!this.retryTimer) {
        const retryDelay = Math.min(
          BATCH_FLUSH_INTERVAL_MS * 2 ** Math.max(0, pending.attempts - 1),
          30_000,
        );
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          void this.drainOutbox();
        }, retryDelay);
      }
    } finally {
      this.isSending = false;
      this.emit();
    }

    if (succeeded) {
      void this.drainOutbox();
    }
  }

  private snapshot(): BatcherSnapshot {
    return {
      queuedEventCount: this.queue.length,
      queuedBytes: this.queue.length
        ? bodyBytes(envelopeForEstimate(this.queue))
        : 0,
      pendingBatchCount: this.outbox.length,
      pendingEventCount: this.outbox.reduce(
        (total, item) => total + item.batch.errors.length,
        0,
      ),
      isSending: this.isSending,
      nextFlushAt: this.nextFlushAt,
      lastBatch: this.lastBatch,
      lastError: this.lastError,
    };
  }

  private emit(): void {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}
