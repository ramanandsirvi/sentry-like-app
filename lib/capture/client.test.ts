import { afterEach, describe, expect, it, vi } from "vitest";

import type { ErrorEvent } from "@/lib/contracts/ingest";
import { sanitizeCapturedUrl, trackedFetch } from "@/lib/capture/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("capture client", () => {
  it("removes credentials, query values, and fragments from captured URLs", () => {
    vi.stubGlobal("window", {
      location: { href: "https://app.example.test/current" },
    });

    expect(
      sanitizeCapturedUrl(
        "https://user:secret@api.example.test/orders/123?token=secret#details",
      ),
    ).toBe("https://api.example.test/orders/123");
  });

  it("never changes HTTP response semantics when instrumentation fails", async () => {
    vi.stubGlobal("window", {
      location: { href: "https://app.example.test/checkout?session=secret" },
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { code: "PAYMENT_FAILED", message: "Payment failed" },
            { status: 500 },
          ),
        ),
    );
    const captured: ErrorEvent[] = [];

    const response = await trackedFetch(
      "https://api.example.test/orders/123?token=secret",
      undefined,
      {
        capture: (event) => {
          captured.push(event);
          throw new Error("The SDK queue is unavailable");
        },
      },
    );

    expect(response.status).toBe(500);
    expect(captured).toHaveLength(1);
    expect(captured[0].type).toBe("network_error");
    if (captured[0].type === "network_error") {
      expect(captured[0].payload.request.url).toBe(
        "https://api.example.test/orders/123",
      );
      expect(captured[0].payload.context?.page_url).toBe(
        "https://app.example.test/checkout",
      );
    }
  });

  it("rethrows the original fetch failure even when capture fails", async () => {
    vi.stubGlobal("window", {
      location: { href: "https://app.example.test/checkout" },
    });
    const originalError = new TypeError("Failed to fetch");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(originalError));

    await expect(
      trackedFetch("https://api.example.test/orders", undefined, {
        capture: () => {
          throw new Error("Capture failed");
        },
      }),
    ).rejects.toBe(originalError);
  });
});
