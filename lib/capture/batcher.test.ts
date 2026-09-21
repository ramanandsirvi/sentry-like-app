import { afterEach, describe, expect, it, vi } from "vitest";

import { ErrorBatcher } from "@/lib/capture/batcher";
import type { ErrorEvent, IngestSuccessResponse } from "@/lib/contracts/ingest";

function event(message = "Something failed"): ErrorEvent {
  return {
    event_id: crypto.randomUUID(),
    type: "console_error",
    timestamp: new Date().toISOString(),
    payload: { error_name: "Error", message },
  };
}

function response(batchId: string): IngestSuccessResponse {
  return {
    batch_id: batchId,
    status: "processed",
    accepted_count: 1,
    duplicate_count: 0,
    groups_touched: 1,
    processed_at: new Date().toISOString(),
    idempotent_replay: false,
    results: [],
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ErrorBatcher", () => {
  it("flushes queued errors after three seconds", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async (batch) => response(batch.batch_id));
    const batcher = new ErrorBatcher(send);

    batcher.capture(event());
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].errors).toHaveLength(1);
    batcher.dispose();
  });

  it("seals the current batch before the next event crosses 500 KiB", async () => {
    const send = vi.fn(async (batch) => response(batch.batch_id));
    const batcher = new ErrorBatcher(send);

    batcher.capture(event("a".repeat(300_000)));
    batcher.capture(event("b".repeat(300_000)));
    await Promise.resolve();

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].errors).toHaveLength(1);
    batcher.dispose();
  });

  it("rejects an event that cannot fit in a batch by itself", () => {
    const batcher = new ErrorBatcher(vi.fn());

    expect(() => batcher.capture(event("x".repeat(520_000)))).toThrow(
      /exceeds the batch limit/,
    );
    batcher.dispose();
  });

  it("retries a failed delivery with the same batch ID", async () => {
    vi.useFakeTimers();
    const batchIds: string[] = [];
    const send = vi
      .fn()
      .mockImplementationOnce(async (batch) => {
        batchIds.push(batch.batch_id);
        throw new Error("Database unavailable");
      })
      .mockImplementationOnce(async (batch) => {
        batchIds.push(batch.batch_id);
        return response(batch.batch_id);
      });
    const batcher = new ErrorBatcher(send);

    batcher.capture(event());
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(send).toHaveBeenCalledTimes(2);
    expect(batchIds[0]).toBe(batchIds[1]);
    batcher.dispose();
  });
});
