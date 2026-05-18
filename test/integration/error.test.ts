import { describe, expect, it } from "bun:test";

import { createApp } from "../../src/index";
import { createMockFetch } from "../support/mock-fetch";

const invalidLinksHtml = await Bun.file(
  "test/fixtures/html/no-valid-links.html",
).text();

describe("error responses", () => {
  it("returns 400 for missing required parameters", async () => {
    const app = createApp();
    const response = await app.request(
      "http://127.0.0.1:8677/rss?item=.post&link=a",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Missing required parameter: url",
      usage: "GET /rss?url=<url>&item=<selector>&link=<selector>",
    });
  });

  it("returns 400 for invalid selectors", async () => {
    const app = createApp();
    const response = await app.request(
      "http://127.0.0.1:8677/rss?url=example.com&item=[&link=a",
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid CSS selector",
      param: "item",
      selector: "[",
    });
  });

  it("returns 502 when the target is unreachable", async () => {
    const { fetchImpl } = createMockFetch({
      "https://example.com/blog": new Error("network down"),
    });

    const app = createApp({ fetchImpl });
    const response = await app.request(
      "http://127.0.0.1:8677/rss?url=example.com/blog&item=.post&link=a",
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      detail: "network down",
      error: "Failed to fetch https://example.com/blog",
    });
  });

  it("returns 502 for access denied responses", async () => {
    const { fetchImpl } = createMockFetch({
      "https://example.com/blog": {
        body: "blocked",
        headers: { "content-type": "text/html; charset=utf-8" },
        status: 403,
      },
    });

    const app = createApp({ fetchImpl });
    const response = await app.request(
      "http://127.0.0.1:8677/rss?url=example.com/blog&item=.post&link=a",
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      detail: "The site may be blocking automated requests",
      error: "Access denied by https://example.com/blog",
    });
  });

  it("returns 502 when no items match", async () => {
    const { fetchImpl } = createMockFetch({
      "https://example.com/blog": {
        body: "<html><head><title>Example</title></head><body></body></html>",
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    });

    const app = createApp({ fetchImpl });
    const response = await app.request(
      "http://127.0.0.1:8677/rss?url=example.com/blog&item=.post&link=a",
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "No items matched",
      selector: ".post",
      url: "https://example.com/blog",
    });
  });

  it("returns 502 when every matched item has an invalid link", async () => {
    const { fetchImpl } = createMockFetch({
      "https://example.com/blog": {
        body: invalidLinksHtml,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    });

    const app = createApp({ fetchImpl });
    const response = await app.request(
      "http://127.0.0.1:8677/rss?url=example.com/blog&item=.post&link=a",
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      detail: "All matched items were missing http(s) links",
      error: "No valid items",
    });
  });
});
