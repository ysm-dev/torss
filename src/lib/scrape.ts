import { load } from "cheerio";

import { resolveUrl } from "../utils/resolve-url";
import { normalizeText } from "../utils/text";
import { fetchPage } from "./fetch-page";
import { resolveTitles } from "./resolve-titles";
import type { FeedItem, FeedRequest, Result, ScrapeResult } from "./types";

type ScrapeOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs: number;
  titleTimeoutMs: number;
};

function truncateDescription(input: string): string {
  if (input.length <= 500) {
    return input;
  }

  return `${input.slice(0, 497)}...`;
}

export async function scrapeFeed(
  request: FeedRequest,
  options: ScrapeOptions,
): Promise<Result<ScrapeResult>> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const page = await fetchPage(request.url, {
    fetchImpl: options.fetchImpl,
    lang: request.lang,
    timeoutMs: options.timeoutMs,
  });

  if (!page.ok) {
    return page;
  }

  const $ = load(page.value.html);
  const matchedItems = $(request.item).toArray();
  if (matchedItems.length === 0) {
    return {
      error: {
        body: {
          error: "No items matched",
          selector: request.item,
          url: request.url,
        },
        status: 502,
      },
      ok: false,
    };
  }

  const seen = new Set<string>();
  const extracted: FeedItem[] = [];

  for (const node of matchedItems) {
    const item = $(node);
    const linkElement = item.is(request.link)
      ? item
      : item.find(request.link).first();
    const linkNode = linkElement.get(0);
    if (!linkNode || !("tagName" in linkNode)) {
      continue;
    }
    if (linkNode.tagName.toLowerCase() !== "a") {
      continue;
    }

    const href = linkElement.attr("href");
    if (!href) {
      continue;
    }

    const link = resolveUrl(href, request.url);
    if (!link || seen.has(link)) {
      continue;
    }

    seen.add(link);

    const linkText = normalizeText(linkElement.text());
    const title = request.title
      ? normalizeText(item.find(request.title).first().text())
      : linkText;
    const desc = request.desc
      ? truncateDescription(
          normalizeText(item.find(request.desc).first().text()),
        )
      : "";

    extracted.push({
      desc: desc || null,
      link,
      title,
    });
  }

  if (extracted.length === 0) {
    return {
      error: {
        body: {
          detail: "All matched items were missing http(s) links",
          error: "No valid items",
        },
        status: 502,
      },
      ok: false,
    };
  }

  const resolvedItems = await resolveTitles(extracted, {
    fetchImpl: options.fetchImpl,
    lang: request.lang,
    timeoutMs: options.titleTimeoutMs,
  });
  const limitedItems =
    request.limit === 0 ? resolvedItems : resolvedItems.slice(0, request.limit);
  const sourceTitle = normalizeText($("title").first().text()) || request.url;

  return {
    ok: true,
    value: {
      charset: page.value.charset,
      fetchMs: now() - startedAt,
      fetchedAt: new Date(startedAt).toISOString(),
      items: limitedItems,
      sourceTitle,
      sourceUrl: request.url,
      totalAfterDedup: resolvedItems.length,
      totalAfterLimit: limitedItems.length,
      totalMatched: matchedItems.length,
    },
  };
}
