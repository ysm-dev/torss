import { describe, expect, it } from "bun:test";

import { normalizeText } from "../../../src/utils/text";

describe("normalizeText", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeText("  foo\n\t  bar   ")).toBe("foo bar");
  });
});
