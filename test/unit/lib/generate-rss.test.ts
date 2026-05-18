import { describe, expect, it } from "bun:test";

import { generateRss } from "../../../src/lib/generate-rss";

describe("generateRss", () => {
  it("escapes XML and includes a self link", () => {
    const xml = generateRss({
      fetchedAt: "2026-04-06T12:00:00.000Z",
      items: [
        {
          desc: "Tom & Jerry",
          link: "https://example.com/post/1",
          title: "A < B",
        },
      ],
      selfUrl: "http://127.0.0.1:8677/rss?url=https://example.com",
      sourceTitle: 'Fish & "Chips"',
      sourceUrl: "https://example.com",
    });

    expect(xml).toContain("<title>Fish &amp; &quot;Chips&quot;</title>");
    expect(xml).toContain("<title>A &lt; B</title>");
    expect(xml).toContain("<description>Tom &amp; Jerry</description>");
    expect(xml).toContain(
      '<atom:link href="http://127.0.0.1:8677/rss?url=https://example.com" rel="self" type="application/rss+xml"/>',
    );
  });
});
