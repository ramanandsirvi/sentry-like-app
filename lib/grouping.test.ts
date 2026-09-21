import { describe, expect, it } from "vitest";

import type { ErrorEvent } from "@/lib/contracts/ingest";
import { groupErrorEvent, normalizeEndpoint } from "@/lib/grouping";

function consoleEvent(
  message: string,
  stack = "Error\n at saveOrder (app/orders.ts:10:2)",
): ErrorEvent {
  return {
    event_id: crypto.randomUUID(),
    type: "console_error",
    timestamp: new Date().toISOString(),
    payload: { error_name: "Error", message, stack },
  };
}

function networkEvent(overrides?: {
  url?: string;
  status?: number;
  code?: string;
  traceId?: string;
  stack?: string;
}): ErrorEvent {
  return {
    event_id: crypto.randomUUID(),
    type: "network_error",
    timestamp: new Date().toISOString(),
    payload: {
      request: {
        method: "POST",
        url: overrides?.url ?? "https://api.example.test/orders/123/checkout",
        operation: "submit_checkout",
      },
      response: {
        status: overrides?.status ?? 500,
        error_code: overrides?.code ?? "PAYMENT_PROVIDER_TIMEOUT",
        error_message: "Payment provider did not respond",
      },
      failure: {
        kind: "http",
        name: "CheckoutRequestError",
        message: "Checkout request failed",
        stack:
          overrides?.stack ??
          "Error\n at submitCheckout (app/checkout.ts:20:4)",
      },
      context: { trace_id: overrides?.traceId ?? crypto.randomUUID() },
    },
  };
}

describe("groupErrorEvent", () => {
  it("groups console errors whose volatile entity IDs differ", () => {
    const first = groupErrorEvent(consoleEvent("User 123 failed to save"));
    const second = groupErrorEvent(consoleEvent("User 456 failed to save"));

    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it("keeps console errors from different call sites separate", () => {
    const first = groupErrorEvent(
      consoleEvent("Save failed", "Error\n at saveOrder (app/orders.ts:10:2)"),
    );
    const second = groupErrorEvent(
      consoleEvent("Save failed", "Error\n at saveUser (app/users.ts:10:2)"),
    );

    expect(first.fingerprint).not.toBe(second.fingerprint);
  });

  it("groups route IDs and query-string variations together", () => {
    const first = groupErrorEvent(
      networkEvent({
        url: "https://api.example.test/orders/123/checkout?retry=1",
      }),
    );
    const second = groupErrorEvent(
      networkEvent({
        url: "https://api.example.test/orders/456/checkout?retry=2",
      }),
    );

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(
      normalizeEndpoint("https://api.example.test/orders/123/checkout?q=1")
        .pathname,
    ).toBe("/orders/:id/checkout");
  });

  it("keeps structured error codes and status codes distinct", () => {
    const timeout = groupErrorEvent(networkEvent());
    const inventory = groupErrorEvent(
      networkEvent({ code: "INVENTORY_RESERVATION_FAILED" }),
    );
    const notFound = groupErrorEvent(networkEvent({ status: 404 }));

    expect(timeout.fingerprint).not.toBe(inventory.fingerprint);
    expect(timeout.fingerprint).not.toBe(notFound.fingerprint);
  });

  it("does not use per-request trace IDs for grouping", () => {
    const first = groupErrorEvent(networkEvent({ traceId: "trace-one" }));
    const second = groupErrorEvent(networkEvent({ traceId: "trace-two" }));

    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it("removes changing Next.js chunk names from browser call sites", () => {
    const first = groupErrorEvent(
      networkEvent({
        stack:
          "Error\n at trackedFetch (http://localhost:3000/_next/static/chunks/first.js:10:4)",
      }),
    );
    const second = groupErrorEvent(
      networkEvent({
        stack:
          "Error\n at trackedFetch (https://app.example.test/_next/static/chunks/second.js:99:2)",
      }),
    );

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.normalizedSummary).toContain(
      "trackedFetch@_next/static/chunks/:bundle",
    );
  });
});
