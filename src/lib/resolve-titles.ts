import { load } from "cheerio";
import pLimit from "p-limit";

import { normalizeText } from "../utils/text";
import { fetchPage } from "./fetch-page";
import type { FeedItem } from "./types";

type ResolveTitlesOptions = {
  fetchImpl?: typeof fetch;
  lang: string;
  timeoutMs: number;
};

export async function resolveTitles(
  items: FeedItem[],
  options: ResolveTitlesOptions,
) {
  const limit = pLimit(5);

  return Promise.all(
    items.map((item) => {
      if (item.title) {
        return Promise.resolve(item);
      }

      return limit(async () => {
        const response = await fetchPage(item.link, {
          fetchImpl: options.fetchImpl,
          lang: options.lang,
          timeoutMs: options.timeoutMs,
        });

        if (!response.ok) {
          return {
            ...item,
            title: item.link,
          };
        }

        const $ = load(response.value.html);
        const title = normalizeText($("title").first().text());

        return {
          ...item,
          title: title || item.link,
        };
      });
    }),
  );
}
