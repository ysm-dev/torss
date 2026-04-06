import { describe, expect, it } from "bun:test";

import { validateFeedRequest } from "../../../src/lib/validate";

describe("validateFeedRequest", () => {
  it("normalizes defaults and boolean debug flag", () => {
    const result = validateFeedRequest(
      "/rss",
      new URLSearchParams("url=example.com&item=.post&link=a&debug=1"),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.url).toBe("https://example.com");
    expect(result.value.limit).toBe(50);
    expect(result.value.ttl).toBe(300);
    expect(result.value.lang).toBe("en");
    expect(result.value.debug).toBe(true);
  });

  it("rejects invalid numeric values", () => {
    const result = validateFeedRequest(
      "/rss",
      new URLSearchParams("url=example.com&item=.post&link=a&limit=-1"),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.status).toBe(400);
    expect(result.error.body).toEqual({
      detail: "Expected a non-negative integer",
      error: "Invalid parameter value",
      param: "limit",
    });
  });

  it("rejects invalid CSS selectors", () => {
    const result = validateFeedRequest(
      "/rss",
      new URLSearchParams("url=example.com&item=[&link=a"),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error.status).toBe(400);
    expect(result.error.body).toEqual({
      error: "Invalid CSS selector",
      param: "item",
      selector: "[",
    });
  });
});
