import { Hono } from "hono";

import { buildCacheKey, createCache } from "./lib/cache";
import { generateAtom } from "./lib/generate-atom";
import { generateRss } from "./lib/generate-rss";
import { scrapeFeed } from "./lib/scrape";
import { validateFeedRequest } from "./lib/validate";
import { VERSION } from "./version";

type AppOptions = {
  cache?: ReturnType<typeof createCache>;
  defaultTtl?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  verbose?: boolean;
};

const ROUTES = ["/", "/rss", "/atom"];

function getNumberEnv(name: string, fallback: number): number {
  const value = Bun.env[name];
  if (!value || !/^\d+$/.test(value)) {
    return fallback;
  }

  return Number.parseInt(value, 10);
}

async function createEtag(body: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  const hex = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");

  return `"${hex.slice(0, 16)}"`;
}

function createSelfUrl(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  return `http://${host}${url.pathname}${url.search}`;
}

function xmlResponse(
  body: null | string,
  contentType: string,
  etag: string,
  ttl: number,
  status = 200,
): Response {
  return new Response(body, {
    headers: {
      "Cache-Control": `public, max-age=${ttl}`,
      "Content-Type": contentType,
      ETag: etag,
    },
    status,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    status,
  });
}

export function createApp(options: AppOptions = {}) {
  const now = options.now ?? Date.now;
  const defaultTtl = options.defaultTtl ?? getNumberEnv("TORSS_TTL", 300);
  const timeoutMs = options.timeoutMs ?? getNumberEnv("TORSS_TIMEOUT", 15_000);
  const cache = options.cache ?? createCache();
  const app = new Hono();
  const startedAt = now();

  app.use("*", async (c, next) => {
    if (c.req.method !== "GET") {
      const response = jsonResponse({ error: "Method not allowed" }, 405);
      response.headers.set("Allow", "GET");
      return response;
    }

    await next();
  });

  app.get("/", () => {
    return jsonResponse({
      cache: {
        entries: cache.size(),
        ttl: defaultTtl,
      },
      name: "torss",
      uptime: Math.floor((now() - startedAt) / 1000),
      usage: {
        atom: "GET /atom?url=<url>&item=<selector>&link=<selector>",
        params: {
          debug: "Set to 1 for JSON output instead of XML",
          desc: "CSS selector for description (optional, max 500 chars)",
          item: "CSS selector for item containers (required)",
          lang: "Accept-Language for target request (default: en)",
          limit: "Max items, 0 = no limit (default: 50)",
          link: "CSS selector for link within each item (required)",
          title: "CSS selector for title (optional, defaults to link text)",
          ttl: `Cache TTL in seconds, 0 = no cache (default: ${defaultTtl})`,
          url: "Target URL to scrape (required, https:// auto-prepended)",
        },
        rss: "GET /rss?url=<url>&item=<selector>&link=<selector>",
      },
      version: VERSION,
    });
  });

  app.get("/rss", async (c) => {
    return handleFeed(
      c.req.raw,
      c.req.header("if-none-match") ?? null,
      "/rss",
      "rss",
    );
  });

  app.get("/atom", async (c) => {
    return handleFeed(
      c.req.raw,
      c.req.header("if-none-match") ?? null,
      "/atom",
      "atom",
    );
  });

  app.notFound(() => jsonResponse({ error: "Not found", routes: ROUTES }, 404));

  async function handleFeed(
    rawRequest: Request,
    ifNoneMatch: null | string,
    pathname: "/atom" | "/rss",
    format: "atom" | "rss",
  ) {
    const url = new URL(rawRequest.url);
    const validated = validateFeedRequest(
      pathname,
      url.searchParams,
      defaultTtl,
    );
    if (!validated.ok) {
      return jsonResponse(validated.error.body, validated.error.status);
    }

    const request = validated.value;
    const cacheKey = buildCacheKey(pathname, request);
    const nowMs = now();
    const contentType =
      format === "rss"
        ? "application/rss+xml; charset=utf-8"
        : "application/atom+xml; charset=utf-8";

    if (!request.debug && request.ttl > 0) {
      const cached = cache.get(cacheKey, nowMs);
      if (cached) {
        if (ifNoneMatch === cached.etag) {
          return xmlResponse(null, contentType, cached.etag, request.ttl, 304);
        }

        return xmlResponse(cached.body, contentType, cached.etag, request.ttl);
      }
    }

    const scraped = await scrapeFeed(request, {
      fetchImpl: options.fetchImpl,
      now,
      timeoutMs,
      titleTimeoutMs: 5_000,
    });
    if (!scraped.ok) {
      return jsonResponse(scraped.error.body, scraped.error.status);
    }

    if (request.debug) {
      return jsonResponse({
        items: scraped.value.items,
        source: {
          charset: scraped.value.charset,
          fetchMs: scraped.value.fetchMs,
          fetchedAt: scraped.value.fetchedAt,
          title: scraped.value.sourceTitle,
          url: scraped.value.sourceUrl,
        },
        totalAfterDedup: scraped.value.totalAfterDedup,
        totalAfterLimit: scraped.value.totalAfterLimit,
        totalMatched: scraped.value.totalMatched,
      });
    }

    const selfUrl = createSelfUrl(rawRequest);
    const body =
      format === "rss"
        ? generateRss({
            fetchedAt: scraped.value.fetchedAt,
            items: scraped.value.items,
            selfUrl,
            sourceTitle: scraped.value.sourceTitle,
            sourceUrl: scraped.value.sourceUrl,
          })
        : generateAtom({
            fetchedAt: scraped.value.fetchedAt,
            items: scraped.value.items,
            selfUrl,
            sourceTitle: scraped.value.sourceTitle,
            sourceUrl: scraped.value.sourceUrl,
          });
    const etag = await createEtag(body);

    if (request.ttl > 0) {
      cache.set(cacheKey, { body, etag }, request.ttl, nowMs);
    }

    if (ifNoneMatch === etag) {
      return xmlResponse(null, contentType, etag, request.ttl, 304);
    }

    return xmlResponse(body, contentType, etag, request.ttl);
  }

  return app;
}

export function startServer() {
  const host = Bun.env.HOST || "127.0.0.1";
  const port = getNumberEnv("PORT", 8677);
  const app = createApp({ verbose: Bun.env.TORSS_VERBOSE === "1" });

  try {
    const server = Bun.serve({
      fetch: app.fetch,
      hostname: host,
      port,
    });

    console.log(`Listening on http://${host}:${port}`);
    process.on("SIGINT", () => process.exit(0));
    process.on("SIGTERM", () => process.exit(0));
    return server;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.includes("in use") || detail.includes("EADDRINUSE")) {
      console.log(`Error: Port ${port} already in use`);
      process.exit(1);
    }

    throw error;
  }
}

if (import.meta.main) {
  startServer();
}
