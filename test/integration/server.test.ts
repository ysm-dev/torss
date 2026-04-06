import { describe, expect, it } from "bun:test";

import { createApp } from "../../src/index";
import { createCache } from "../../src/lib/cache";
import { CHROME_136_UA } from "../../src/utils/ua";
import { createMockFetch } from "../support/mock-fetch";

const blogHtml = await Bun.file(
  "test/fixtures/html/blog-with-links.html",
).text();
const emptyTitlesHtml = await Bun.file(
  "test/fixtures/html/empty-titles.html",
).text();

describe("server", () => {
  it("serves the health endpoint", async () => {
    const app = createApp();
    const response = await app.request("http://127.0.0.1:3000/");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.name).toBe("torss");
    expect(body.usage.rss).toBe(
      "GET /rss?url=<url>&item=<selector>&link=<selector>",
    );
  });

  it("returns JSON 404 and 405 responses", async () => {
    const app = createApp();

    const notFound = await app.request("http://127.0.0.1:3000/nope");
    expect(notFound.status).toBe(404);
    expect(await notFound.json()).toEqual({
      error: "Not found",
      routes: ["/", "/rss", "/atom"],
    });

    const notAllowed = await app.request("http://127.0.0.1:3000/rss", {
      method: "POST",
    });
    expect(notAllowed.status).toBe(405);
    expect(notAllowed.headers.get("allow")).toBe("GET");
    expect(await notAllowed.json()).toEqual({ error: "Method not allowed" });
  });

  it("generates RSS feeds with normalized titles, deduped links, and cache headers", async () => {
    const { calls, fetchImpl } = createMockFetch({
      "https://example.com/blog": {
        body: blogHtml,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    });

    const app = createApp({ fetchImpl });
    const response = await app.request(
      "http://127.0.0.1:3000/rss?url=example.com/blog&item=.post&link=a&desc=p",
      { headers: { host: "127.0.0.1:3000" } },
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/rss+xml; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(response.headers.get("etag")).toStartWith('"');
    expect(xml).toContain("<title>First Article</title>");
    expect(xml).toContain("<link>https://example.com/article/1</link>");
    expect(xml).toContain("<link>https://cdn.example.com/article/2</link>");
    expect(xml).not.toContain("mailto:hello@example.com");
    expect(xml).not.toContain("Duplicate article");
    expect(xml).toContain(
      '<atom:link href="http://127.0.0.1:3000/rss?url=example.com/blog&amp;item=.post&amp;link=a&amp;desc=p" rel="self" type="application/rss+xml"/>',
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.get("user-agent")).toBe(CHROME_136_UA);
    expect(calls[0]?.headers.get("accept-language")).toBe("en");
  });

  it("resolves empty titles from linked pages and falls back to the url", async () => {
    const { fetchImpl } = createMockFetch({
      "https://example.com/list": {
        body: emptyTitlesHtml,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
      "https://example.com/article/a": {
        body: "<title>Resolved A</title>",
        headers: { "content-type": "text/html; charset=utf-8" },
      },
      "https://example.com/article/b": {
        body: "<html><body>No title here</body></html>",
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    });

    const app = createApp({ fetchImpl });
    const response = await app.request(
      "http://127.0.0.1:3000/rss?url=https://example.com/list&item=.entry&link=a&limit=0",
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain("<title>Resolved A</title>");
    expect(xml).toContain("<title>https://example.com/article/b</title>");
  });

  it("returns debug JSON for both xml endpoints and bypasses cache", async () => {
    const { calls, fetchImpl } = createMockFetch({
      "https://example.com/blog": {
        body: blogHtml,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    });

    const cache = createCache();
    const app = createApp({ cache, fetchImpl, now: () => 1_000 });

    const first = await app.request(
      "http://127.0.0.1:3000/atom?url=example.com/blog&item=.post&link=a&debug=1",
    );
    const second = await app.request(
      "http://127.0.0.1:3000/rss?url=example.com/blog&item=.post&link=a&debug=1",
    );

    expect(first.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(second.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(calls).toHaveLength(2);

    const body = await first.json();
    expect(body.source.url).toBe("https://example.com/blog");
    expect(body.source.title).toBe("Example Site");
    expect(body.source.charset).toBe("utf-8");
    expect(body.totalMatched).toBe(5);
    expect(body.totalAfterDedup).toBe(2);
    expect(body.totalAfterLimit).toBe(2);
    expect(cache.size()).toBe(0);
  });

  it("reuses cached feeds across normalized query ordering and honors if-none-match", async () => {
    let nowMs = 1_000;
    const { calls, fetchImpl } = createMockFetch({
      "https://example.com/blog": {
        body: blogHtml,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    });

    const app = createApp({ fetchImpl, now: () => nowMs });
    const first = await app.request(
      "http://127.0.0.1:3000/rss?url=example.com/blog&item=.post&link=a",
    );
    const etag = first.headers.get("etag");

    nowMs = 2_000;
    const second = await app.request(
      "http://127.0.0.1:3000/rss?link=a&item=.post&url=example.com/blog",
      { headers: { "if-none-match": etag ?? "" } },
    );

    expect(calls).toHaveLength(1);
    expect(second.status).toBe(304);
  });

  it("bypasses cache when ttl=0", async () => {
    const { calls, fetchImpl } = createMockFetch({
      "https://example.com/blog": {
        body: blogHtml,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    });

    const app = createApp({ fetchImpl });

    await app.request(
      "http://127.0.0.1:3000/rss?url=example.com/blog&item=.post&link=a&ttl=0",
    );
    await app.request(
      "http://127.0.0.1:3000/rss?url=example.com/blog&item=.post&link=a&ttl=0",
    );

    expect(calls).toHaveLength(2);
  });
});
