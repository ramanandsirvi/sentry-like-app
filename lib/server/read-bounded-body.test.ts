import { describe, expect, it } from "vitest";

import {
  readBoundedBody,
  RequestBodyTooLargeError,
} from "@/lib/server/read-bounded-body";

describe("readBoundedBody", () => {
  it("returns the complete request body at the exact limit", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      body: "abcd",
    });

    const body = await readBoundedBody(request, 4);

    expect(new TextDecoder().decode(body)).toBe("abcd");
  });

  it("stops reading after the configured limit", async () => {
    const request = new Request("https://example.test", {
      method: "POST",
      body: "abcde",
    });

    await expect(readBoundedBody(request, 4)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
  });
});
