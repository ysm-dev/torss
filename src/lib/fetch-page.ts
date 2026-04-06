import { createFetch } from "ofetch";

import { CHROME_136_UA } from "../utils/ua";
import { decodeHtml } from "./charset";
import type { PageResult, Result } from "./types";

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

function normalizeFetchErrorMessage(message: string): string {
  const noResponseMatch = /<no response>\s*(.*)$/.exec(message);
  if (noResponseMatch?.[1]) {
    return noResponseMatch[1];
  }

  const requestMatch = /^\[[A-Z]+\]\s+"[^"]+":\s*(.*)$/.exec(message);
  return requestMatch?.[1] || message;
}

type FetchPageOptions = {
  fetchImpl?: typeof fetch;
  lang: string;
  timeoutMs: number;
};

export async function fetchPage(
  url: string,
  options: FetchPageOptions,
): Promise<Result<PageResult>> {
  const client = createFetch({ fetch: options.fetchImpl ?? fetch });

  try {
    const response = await client.raw<ArrayBuffer, "arrayBuffer">(url, {
      headers: {
        "accept-language": options.lang,
        "user-agent": CHROME_136_UA,
      },
      ignoreResponseError: true,
      responseType: "arrayBuffer",
      retry: 0,
      timeout: options.timeoutMs,
    });

    if (response.status === 403) {
      return {
        error: {
          body: {
            detail: "The site may be blocking automated requests",
            error: `Access denied by ${url}`,
          },
          status: 502,
        },
        ok: false,
      };
    }

    if (!response.ok) {
      return {
        error: {
          body: {
            detail: `HTTP ${response.status} ${response.statusText}`.trim(),
            error: `Failed to fetch ${url}`,
          },
          status: 502,
        },
        ok: false,
      };
    }

    const bytes = response._data
      ? new Uint8Array(response._data)
      : new Uint8Array();
    if (bytes.byteLength > MAX_RESPONSE_BYTES) {
      return {
        error: {
          body: {
            detail: `Exceeded 5MB limit from ${url}`,
            error: "Response too large",
          },
          status: 502,
        },
        ok: false,
      };
    }

    return {
      ok: true,
      value: decodeHtml(bytes, response.headers.get("content-type")),
    };
  } catch (error) {
    return {
      error: {
        body: {
          detail: normalizeFetchErrorMessage(
            error instanceof Error ? error.message : String(error),
          ),
          error: `Failed to fetch ${url}`,
        },
        status: 502,
      },
      ok: false,
    };
  }
}
