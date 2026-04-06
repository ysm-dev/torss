import { describe, expect, it } from "bun:test";

import { normalizeUrl } from "../../../src/utils/normalize-url";

describe("normalizeUrl", () => {
  it("prepends https when the protocol is missing", () => {
    expect(normalizeUrl("example.com/news")).toBe("https://example.com/news");
  });

  it("preserves explicit protocols", () => {
    expect(normalizeUrl("http://example.com/news")).toBe(
      "http://example.com/news",
    );
  });
});
