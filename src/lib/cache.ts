import type { FeedRequest } from "./types";

type CacheValue = {
  body: string;
  etag: string;
  expiresAt: number;
};

type StoredValue = {
  body: string;
  etag: string;
};

export function buildCacheKey(pathname: string, request: FeedRequest): string {
  const params = new URLSearchParams();
  const entries: Array<[string, string | undefined]> = [
    ["desc", request.desc],
    ["item", request.item],
    ["lang", request.lang],
    ["limit", String(request.limit)],
    ["link", request.link],
    ["title", request.title],
    ["ttl", String(request.ttl)],
    ["url", request.url],
  ];

  for (const [key, value] of entries) {
    if (typeof value === "string") {
      params.set(key, value);
    }
  }

  return `${pathname}?${params.toString()}`;
}

export function createCache() {
  const entries = new Map<string, CacheValue>();

  return {
    get(key: string, nowMs: number): null | StoredValue {
      const entry = entries.get(key);
      if (!entry) {
        return null;
      }

      if (entry.expiresAt <= nowMs) {
        entries.delete(key);
        return null;
      }

      return {
        body: entry.body,
        etag: entry.etag,
      };
    },

    set(key: string, value: StoredValue, ttlSeconds: number, nowMs: number) {
      entries.set(key, {
        body: value.body,
        etag: value.etag,
        expiresAt: nowMs + ttlSeconds * 1000,
      });
    },

    size() {
      return entries.size;
    },
  };
}
