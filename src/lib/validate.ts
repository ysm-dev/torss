import { load } from "cheerio";

import { normalizeUrl } from "../utils/normalize-url";
import type { FeedRequest, Result } from "./types";

function invalidParameter(param: string): Result<FeedRequest> {
  return {
    error: {
      body: {
        detail: "Expected a non-negative integer",
        error: "Invalid parameter value",
        param,
      },
      status: 400,
    },
    ok: false,
  };
}

function validateSelector(
  param: string,
  selector: string,
): Result<FeedRequest> | undefined {
  try {
    const $ = load("<div></div>");
    $(selector);
    return undefined;
  } catch {
    return {
      error: {
        body: {
          error: "Invalid CSS selector",
          param,
          selector,
        },
        status: 400,
      },
      ok: false,
    };
  }
}

function parseNonNegativeInt(
  rawValue: null | string,
  defaultValue: number,
  param: string,
): Result<number> {
  if (rawValue === null || rawValue === "") {
    return { ok: true, value: defaultValue };
  }

  if (!/^\d+$/.test(rawValue)) {
    return {
      error: {
        body: {
          detail: "Expected a non-negative integer",
          error: "Invalid parameter value",
          param,
        },
        status: 400,
      },
      ok: false,
    };
  }

  return { ok: true, value: Number.parseInt(rawValue, 10) };
}

export function validateFeedRequest(
  pathname: string,
  searchParams: URLSearchParams,
  defaultTtl = 300,
): Result<FeedRequest> {
  for (const param of ["url", "item", "link"]) {
    const value = searchParams.get(param);
    if (!value) {
      return {
        error: {
          body: {
            error: `Missing required parameter: ${param}`,
            usage: `GET ${pathname}?url=<url>&item=<selector>&link=<selector>`,
          },
          status: 400,
        },
        ok: false,
      };
    }
  }

  const limitResult = parseNonNegativeInt(
    searchParams.get("limit"),
    50,
    "limit",
  );
  if (!limitResult.ok) {
    return limitResult;
  }

  const ttlResult = parseNonNegativeInt(
    searchParams.get("ttl"),
    defaultTtl,
    "ttl",
  );
  if (!ttlResult.ok) {
    return ttlResult;
  }

  const selectors: Array<[string, null | string]> = [
    ["item", searchParams.get("item")],
    ["link", searchParams.get("link")],
    ["title", searchParams.get("title")],
    ["desc", searchParams.get("desc")],
  ];

  for (const [param, selector] of selectors) {
    if (!selector) {
      continue;
    }

    const selectorError = validateSelector(param, selector);
    if (selectorError) {
      return selectorError;
    }
  }

  const item = searchParams.get("item");
  const link = searchParams.get("link");
  const url = searchParams.get("url");

  if (!item || !link || !url) {
    return invalidParameter("url");
  }

  return {
    ok: true,
    value: {
      debug: searchParams.get("debug") === "1",
      desc: searchParams.get("desc") || undefined,
      item,
      lang: searchParams.get("lang") || "en",
      limit: limitResult.value,
      link,
      title: searchParams.get("title") || undefined,
      ttl: ttlResult.value,
      url: normalizeUrl(url),
    },
  };
}
