import { describe, expect, it } from "bun:test";

import { resolveUrl } from "../../../src/utils/resolve-url";

describe("resolveUrl", () => {
  it("resolves relative links against the source url", () => {
    expect(resolveUrl("/post/123", "https://example.com/news")).toBe(
      "https://example.com/post/123",
    );
  });

  it("converts protocol-relative links to https", () => {
    expect(resolveUrl("//cdn.example.com/file", "https://example.com")).toBe(
      "https://cdn.example.com/file",
    );
  });

  it("filters unsupported schemes and fragments", () => {
    expect(
      resolveUrl("mailto:hi@example.com", "https://example.com"),
    ).toBeNull();
    expect(resolveUrl("#top", "https://example.com")).toBeNull();
  });
});
