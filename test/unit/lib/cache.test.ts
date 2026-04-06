import { describe, expect, it } from "bun:test";

import { buildCacheKey, createCache } from "../../../src/lib/cache";

describe("cache", () => {
  it("stores entries until the ttl expires", () => {
    const cache = createCache();

    cache.set("feed", { body: "<rss />", etag: '"abc"' }, 10, 1_000);

    expect(cache.get("feed", 1_005)?.body).toBe("<rss />");
    expect(cache.get("feed", 11_001)).toBeNull();
  });

  it("builds a normalized key from sorted parameters", () => {
    const key = buildCacheKey("/rss", {
      debug: false,
      desc: undefined,
      item: ".post",
      lang: "en",
      limit: 50,
      link: "a",
      title: undefined,
      ttl: 300,
      url: "https://example.com",
    });

    expect(key).toBe(
      "/rss?item=.post&lang=en&limit=50&link=a&ttl=300&url=https%3A%2F%2Fexample.com",
    );
  });
});
