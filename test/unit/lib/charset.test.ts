import { describe, expect, it } from "bun:test";

import { decodeHtml } from "../../../src/lib/charset";

describe("decodeHtml", () => {
  it("prefers the content-type charset", () => {
    const bytes = new TextEncoder().encode("<title>Example</title>");
    const result = decodeHtml(bytes, "text/html; charset=utf-8");

    expect(result.charset).toBe("utf-8");
    expect(result.html).toContain("Example");
  });

  it("falls back to the meta charset when the header is missing", () => {
    const bytes = new TextEncoder().encode(
      '<meta charset="utf-8"><title>Fallback</title>',
    );
    const result = decodeHtml(bytes, null);

    expect(result.charset).toBe("utf-8");
    expect(result.html).toContain("Fallback");
  });
});
