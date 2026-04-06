# torss - Turn any website into an RSS feed

## Goals

- **Stateless**: No database, no config file. All scraping rules encoded in the URL
- **Companion to wachi**: Fills the gap for sites without RSS. wachi subscribes to torss URLs as regular RSS feeds
- **Zero config**: Start the server, construct a URL, subscribe in wachi. Done
- **Universal**: Works with any website that serves HTML. CSS selectors define what to extract
- **Minimal**: Single-purpose tool. Scrape HTML, generate RSS. Nothing else

## Overview

torss is a local HTTP server that scrapes web pages and generates RSS/Atom feeds on the fly. It bridges the gap between websites without RSS feeds and RSS readers like wachi.

**Tagline:** Turn any website into an RSS feed.

```
Website (no RSS)         torss                     wachi
                    GET /rss?url=...&item=...
https://example.com ──────────────────────────> RSS 2.0 XML
                         │                         │
                    1. Fetch HTML                   │
                    2. Parse with cheerio            │
                    3. Extract items via CSS         │
                    4. Generate RSS XML              │
                    5. Return with ETag         wachi sub ...
                                               wachi check
                                               (treats it as a normal RSS feed)
```

## Architecture

### Request Flow

```
wachi check
  │
  ▼
GET http://127.0.0.1:3000/rss?url=https://example.com/news&item=.article&link=a
  │
  ▼
torss receives request
  │
  ├─ Not GET? → 405 Method Not Allowed (Allow: GET)
  ├─ Unknown path? → 404 JSON error with available routes
  │
  ├─ Cache hit (TTL not expired)?
  │    ├─ If-None-Match matches ETag? → 304 Not Modified
  │    └─ ETag differs or no If-None-Match? → 200 + cached RSS XML
  │
  └─ Cache miss or expired
       │
       ▼
  1. Validate required params (url, item, link) → 400 if missing
  2. Normalize url param (auto-prepend https:// if no protocol)
  3. Fetch target URL with Chrome User-Agent (15s timeout, no retry)
  4. Detect charset from Content-Type / <meta charset>, decode to UTF-8
  5. Reject if response exceeds 5MB
  6. Parse HTML with cheerio
  7. $(item).each() → extract link (href from <a>), title (text), desc (text)
  8. Filter: skip items without valid http(s) link
  9. For items with empty title: fetch link page's <title> (concurrent, p-limit 5, 5s timeout)
  10. Dedup items by resolved link URL (first occurrence wins)
  11. Limit to N items (default 50, limit=0 means no limit)
  12. Resolve relative URLs against target URL
  13. Generate RSS 2.0 or Atom 1.0 XML
  14. Compute ETag: first 16 hex chars of SHA-256 of XML, quoted per RFC 7232
  15. Store in cache with normalized cache key
  16. Return XML with Content-Type + ETag + Cache-Control headers
```

### Zero Matches = Error

When the `item` selector matches zero elements, torss returns **HTTP 502** (not an empty RSS feed). This allows wachi's health tracking to detect broken selectors via consecutive failures, rather than silently appearing as "no new items."

## URL Protocol

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Health check + usage guide (JSON) |
| GET | `/rss` | Generate RSS 2.0 feed |
| GET | `/atom` | Generate Atom 1.0 feed |

Any other path returns **404** with JSON: `{"error": "Not found", "routes": ["/", "/rss", "/atom"]}`.

Any non-GET method returns **405 Method Not Allowed** with `Allow: GET` header.

**Unknown query parameters are silently ignored.** Only the documented parameters are processed.

### Query Parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `url` | Yes | - | Target URL to scrape. Protocol auto-prepended if missing (`https://`) |
| `item` | Yes | - | CSS selector for item containers |
| `link` | Yes | - | CSS selector for link within each item. Extracts `href` from `<a>` elements. **Text content is used as title when `title` is omitted.** |
| `title` | No | link text | CSS selector for title within each item. Extracts text content. Falls back to link element's text content |
| `desc` | No | - | CSS selector for description within each item. Extracts text content. Max 500 characters (truncated with `...`) |
| `limit` | No | `50` | Maximum number of items. `0` means no limit (return all matched items) |
| `ttl` | No | global default | Cache TTL in seconds for this specific feed. `0` disables cache (always fetches fresh) |
| `lang` | No | `en` | Accept-Language header sent to target site |
| `debug` | No | - | When `1`, returns JSON instead of RSS/Atom XML. Works on both `/rss` and `/atom` (same JSON output). **Only the string `"1"` activates debug mode; all other values are ignored.** Debug requests always bypass the cache |

### URL Normalization

If the `url` parameter has no protocol prefix, `https://` is auto-prepended (same behavior as wachi):

- `url=example.com/news` → fetches `https://example.com/news`
- `url=https://example.com` → used as-is
- `url=http://example.com` → used as-is (http preserved if explicitly specified)

### Selector Behavior

- **link**: Extracts `href` attribute from the first matching `<a>` element within each item. First match only when multiple elements match. If the matched element is not `<a>` (no href available), the item is **skipped** (treated as having no link)
- **title**: Extracts text content from the first matching element. When omitted, the text content of the link element is used as the title
- **desc**: Extracts text content (HTML tags stripped) from the first matching element. Truncated to 500 characters with `...` suffix if longer
- **All selectors are scoped to each item container** (not the global document)

### Text Extraction

All extracted text (title, desc, link text) is processed with:

1. **Trim**: Remove leading/trailing whitespace
2. **Collapse**: Replace consecutive whitespace characters (`\n`, `\t`, multiple spaces) with a single space

Example: `"  foo\n  bar  "` → `"foo bar"`

### Empty Title Resolution

When the title extraction produces an empty string (after trim + collapse), torss fetches the link URL's page to extract its `<title>` tag:

1. Collect all items with empty titles
2. Fetch their link URLs concurrently (max 5 concurrent via p-limit, 5-second timeout per request)
3. Parse each response's `<title>` tag
4. If fetch fails or `<title>` is empty/missing, fall back to the link URL itself as the title

This ensures every RSS item always has a meaningful title.

### Item Filtering & Ordering

- **Link validation**: Items where the link selector matches no `<a>` element (or produces no `href`) are **silently skipped**
- **Special URL schemes**: Links with `javascript:`, `mailto:`, `#fragment`-only, or other non-http(s) schemes are skipped. Protocol-relative URLs (`//cdn.example.com/...`) are resolved by prepending `https:`
- **Dedup**: Duplicate items (same resolved link URL) are deduped. First occurrence in DOM order wins
- **Ordering**: DOM order as-is (no sorting)
- **Limit**: Applied after filtering and dedup. Default 50. `limit=0` returns all items

## Examples

### Basic Usage

```bash
# Start torss
torss
# Listening on http://127.0.0.1:3000

# Subscribe in wachi
wachi sub -n hn -a "slack://xoxb-.../channel" \
  "http://127.0.0.1:3000/rss?url=https://news.ycombinator.com&item=.athing&link=.titleline>a"

# wachi treats this as a normal RSS feed
wachi check
```

### Title Same as Link (Common Case)

When the title is the link text itself, only `item` and `link` are needed:

```html
<!-- Target page -->
<div class="post">
  <a href="/article/123">Breaking: New Discovery</a>
</div>
```

```
/rss?url=https://example.com&item=.post&link=a
```

Result: `title = "Breaking: New Discovery"`, `link = "https://example.com/article/123"`

### Separate Title and Link

```html
<div class="entry">
  <h2>Major Update Released</h2>
  <a href="/updates/456">Read more</a>
  <p>Version 2.0 brings significant improvements...</p>
</div>
```

```
/rss?url=https://example.com&item=.entry&link=a&title=h2&desc=p
```

### With Options

```
/rss?url=https://example.com/news&item=article&link=a&title=h2&limit=20&ttl=120&lang=ko
```

### URL Without Protocol

```
/rss?url=example.com/news&item=.post&link=a
```

Fetches `https://example.com/news` (auto-prepended).

### Atom Format

```
/atom?url=https://example.com&item=.post&link=a
```

### Debug Mode

```
/rss?url=https://example.com&item=.post&link=a&debug=1
```

Returns JSON (same output regardless of `/rss` or `/atom` path):

```json
{
  "source": {
    "url": "https://example.com",
    "title": "Example Site",
    "charset": "utf-8",
    "fetchedAt": "2026-04-06T12:00:00.000Z",
    "fetchMs": 342
  },
  "items": [
    {
      "title": "Breaking: New Discovery",
      "link": "https://example.com/article/123",
      "desc": null
    },
    {
      "title": "Another Post",
      "link": "https://example.com/article/124",
      "desc": "Summary text here"
    }
  ],
  "totalMatched": 2,
  "totalAfterDedup": 2,
  "totalAfterLimit": 2
}
```

### Disable Cache

```
/rss?url=https://example.com&item=.post&link=a&ttl=0
```

Always fetches the target site fresh (no caching).

### No Item Limit

```
/rss?url=https://example.com&item=.post&link=a&limit=0
```

Returns all matched items (no 50-item cap).

## RSS Output

### RSS 2.0

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Example Site</title>
    <link>https://example.com</link>
    <description>Generated by torss</description>
    <atom:link href="http://127.0.0.1:3000/rss?url=..." rel="self" type="application/rss+xml"/>
    <item>
      <title>Breaking: New Discovery</title>
      <link>https://example.com/article/123</link>
      <guid isPermaLink="true">https://example.com/article/123</guid>
    </item>
    <item>
      <title>Another Post</title>
      <link>https://example.com/article/124</link>
      <guid isPermaLink="true">https://example.com/article/124</guid>
      <description>Summary text here</description>
    </item>
  </channel>
</rss>
```

### Atom 1.0

```xml
<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example Site</title>
  <link href="https://example.com" rel="alternate"/>
  <link href="http://127.0.0.1:3000/atom?url=..." rel="self"/>
  <id>https://example.com</id>
  <updated>2026-04-06T12:00:00.000Z</updated>
  <entry>
    <title>Breaking: New Discovery</title>
    <link href="https://example.com/article/123" rel="alternate"/>
    <id>https://example.com/article/123</id>
    <updated>2026-04-06T12:00:00.000Z</updated>
  </entry>
</feed>
```

### Channel Metadata

| Field | Value |
|-------|-------|
| **title** | Target page's `<title>` HTML tag. Falls back to the `url` parameter value if absent or empty |
| **link** | The `url` parameter value |
| **description** | Fixed string `"Generated by torss"` (RSS only; Atom has no description) |
| **guid** | Resolved link URL with `isPermaLink="true"` |
| **updated** (Atom) | ISO 8601 timestamp of when the target page was fetched. For cached responses, this is the original fetch time. Applied to both `<feed>` and each `<entry>` (same timestamp for all, since individual item dates are not extracted) |

### Self-Link Construction

The `<atom:link rel="self">` URL is constructed from the incoming request's `Host` header and request path + query string:

```
<atom:link href="http://{request.host}{request.path}?{request.querystring}" rel="self" .../>
```

This ensures correct self-links even behind a reverse proxy. The scheme is always `http://` (torss does not serve TLS).

### XML Escaping

All text content inserted into XML is entity-escaped. No CDATA sections.

| Character | Escaped |
|-----------|---------|
| `&` | `&amp;` |
| `<` | `&lt;` |
| `>` | `&gt;` |
| `"` | `&quot;` |
| `'` | `&apos;` |

## Caching

### In-Memory Cache

- **Cache key**: Normalized request path + query parameters **sorted alphabetically**. `?url=x&item=y` and `?item=y&url=x` produce the same cache key
- **Cache value**: Generated XML string + ETag hash + fetch timestamp (ISO 8601)
- **Default TTL**: 300 seconds (5 minutes), configurable via `TORSS_TTL` env
- **Per-feed override**: `?ttl=N` query parameter in seconds. `ttl=0` disables caching (always fetches fresh)
- **Memory only**: Cache is lost on server restart. Cold start causes a single cache miss per feed, which is acceptable

### ETag Support

torss supports conditional requests for wachi's ETag/If-Modified-Since optimization:

1. Generate RSS/Atom XML
2. Compute SHA-256 hash of the XML content
3. Take the **first 16 hex characters** of the hash
4. Return as a **quoted** `ETag` response header per RFC 7232: `"a1b2c3d4e5f6a7b8"`
5. On subsequent requests, if `If-None-Match` header matches the current ETag, return **304 Not Modified** with no body

This saves bandwidth when the target page content hasn't changed between wachi checks.

## HTTP

### Outbound Requests (torss -> target site)

- **User-Agent**: Chrome 136 UA string, hardcoded in `src/utils/ua.ts`. Updated with new torss releases:

  ```
  Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36
  ```

- **Accept-Language**: Default `en`, override via `?lang=` parameter
- **Timeout**: 15 seconds (configurable via `TORSS_TIMEOUT` env). Must complete within wachi's 30s timeout
- **Retry**: None. wachi handles retry at the RSS consumer level. No double-retry amplification
- **Response size limit**: 5MB. Responses exceeding this are rejected with HTTP 502
- **Charset detection**: Auto-detect from `Content-Type` header charset or `<meta charset>` tag. Decode to UTF-8

### Title Page Fetch (for empty titles)

- **Scope**: Only triggered for items where title extraction produced an empty string
- **Concurrency**: Max 5 concurrent fetches via p-limit
- **Timeout**: 5 seconds per request (shorter than main fetch)
- **User-Agent**: Same Chrome UA as main fetch
- **Failure handling**: If fetch fails or `<title>` is empty/missing, use the link URL itself as the title
- **Size limit**: Same 5MB limit applies

### Inbound Responses (torss -> wachi)

| Response Type | Content-Type |
|--------------|-------------|
| RSS 2.0 | `application/rss+xml; charset=utf-8` |
| Atom 1.0 | `application/atom+xml; charset=utf-8` |
| JSON (debug, errors, health) | `application/json; charset=utf-8` |

Additional headers on successful feed responses:

| Header | Value |
|--------|-------|
| `ETag` | `"<first 16 hex chars of SHA-256>"` |
| `Cache-Control` | `public, max-age=<ttl>` |

### Relative URL Resolution

All relative URLs extracted from the page are resolved against the `url` parameter value using `new URL(relative, baseUrl)`:

- `/post/123` → `https://example.com/post/123`
- `post/123` → `https://example.com/post/123`
- `//cdn.example.com/img.png` → `https://cdn.example.com/img.png` (protocol-relative gets `https:`)

## Error Handling

| Condition | HTTP Status | Response Body |
|-----------|-------------|---------------|
| Missing `url`, `item`, or `link` param | 400 | `{"error": "Missing required parameter: <param>", "usage": "GET /rss?url=<url>&item=<selector>&link=<selector>"}` |
| Invalid CSS selector syntax | 400 | `{"error": "Invalid CSS selector", "selector": "<selector>", "param": "<param_name>"}` |
| Invalid numeric parameter (`limit=abc`, `ttl=-1`) | 400 | `{"error": "Invalid parameter value", "param": "<param_name>", "detail": "Expected a non-negative integer"}` |
| Target site unreachable / timeout | 502 | `{"error": "Failed to fetch <url>", "detail": "<reason>"}` |
| Target returns 403 / bot challenge | 502 | `{"error": "Access denied by <url>", "detail": "The site may be blocking automated requests"}` |
| Response exceeds 5MB | 502 | `{"error": "Response too large", "detail": "Exceeded 5MB limit from <url>"}` |
| `item` selector matches 0 elements | 502 | `{"error": "No items matched", "selector": "<item_selector>", "url": "<url>"}` |
| All matched items have no valid link | 502 | `{"error": "No valid items", "detail": "All matched items were missing http(s) links"}` |
| Unknown path | 404 | `{"error": "Not found", "routes": ["/", "/rss", "/atom"]}` |
| Non-GET method | 405 | `{"error": "Method not allowed"}` + `Allow: GET` header |
| Port already in use | - | Print `Error: Port <port> already in use` to stdout, exit with code 1 |

All error responses use `Content-Type: application/json; charset=utf-8`.

Bot-protected sites (Cloudflare Turnstile, CAPTCHAs, etc.) fail fast with a clear message. torss does not attempt to bypass bot protection.

## Server Configuration

All configuration via environment variables. No config file.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `HOST` | `127.0.0.1` | Bind address. Set to `0.0.0.0` for all interfaces |
| `TORSS_TTL` | `300` | Global default cache TTL in seconds |
| `TORSS_TIMEOUT` | `15000` | Outbound fetch timeout in milliseconds |
| `TORSS_VERBOSE` | - | Set to `1` for detailed request logging |

### Logging

All log output goes to **stdout**.

- **Default**: Errors + startup message only
- **Verbose** (`TORSS_VERBOSE=1`): Log every request with URL, response time, cache hit/miss, items matched

```
# Default
Listening on http://127.0.0.1:3000

# Verbose
Listening on http://127.0.0.1:3000
[req] GET /rss?url=https://example.com&item=.post&link=a (cache miss, 342ms, 12 items)
[req] GET /rss?url=https://example.com&item=.post&link=a (cache hit, etag match, 304)
[err] GET /rss?url=https://down.example.com&item=.x&link=a (fetch failed, timeout 15000ms)
```

### Shutdown

On SIGINT/SIGTERM (Ctrl+C): immediate exit. No graceful drain. Local server with short-lived requests does not need connection draining.

### Health Check (GET /)

Returns JSON with server info and usage guide:

```json
{
  "name": "torss",
  "version": "0.1.0",
  "uptime": 3600,
  "cache": {
    "entries": 5,
    "ttl": 300
  },
  "usage": {
    "rss": "GET /rss?url=<url>&item=<selector>&link=<selector>",
    "atom": "GET /atom?url=<url>&item=<selector>&link=<selector>",
    "params": {
      "url": "Target URL to scrape (required, https:// auto-prepended)",
      "item": "CSS selector for item containers (required)",
      "link": "CSS selector for link within each item (required)",
      "title": "CSS selector for title (optional, defaults to link text)",
      "desc": "CSS selector for description (optional, max 500 chars)",
      "limit": "Max items, 0 = no limit (default: 50)",
      "ttl": "Cache TTL in seconds, 0 = no cache (default: 300)",
      "lang": "Accept-Language for target request (default: en)",
      "debug": "Set to 1 for JSON output instead of XML"
    }
  }
}
```

## Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | Type safety, matches wachi ecosystem |
| Type checker | tsgo (`@typescript/native-preview`) | 10x faster type checking, matches wachi |
| Runtime | Bun | `Bun.serve()` built-in HTTP server, fast startup, `bun build --compile` |
| HTML parsing | cheerio | Fast, jQuery-like CSS selector API, no browser needed |
| HTTP client | ofetch | Timeout support, consistent with wachi. No retry configured |
| Concurrency | p-limit | Limit concurrent title-page fetches. Same as wachi |
| Linter/Formatter | Biome v2 | Matches wachi. Single tool for linting + formatting |
| Dead code detection | knip | Matches wachi. Find unused deps/exports |
| Test runner | bun test | Native Bun test runner, matches wachi |

### Dependencies

**Runtime:**

| Package | Purpose |
|---------|---------|
| `cheerio` | HTML parsing + CSS selector engine |
| `ofetch` | HTTP client for fetching target pages |
| `p-limit` | Concurrency limiter for title-page fetches |

**Dev:**

| Package | Purpose |
|---------|---------|
| `@typescript/native-preview` | Type checking (tsgo) |
| `@biomejs/biome` | Linting + formatting |
| `knip` | Dead code / unused dependency detection |
| `@types/bun` | Bun type definitions |

## Project Structure

```
torss/
  src/
    index.ts                    # Bun.serve() entry point, routing, 405/404 handling
    version.ts                  # Baked-in version constant
    lib/
      scrape.ts                 # Fetch URL + cheerio parse + extract items
      resolve-titles.ts         # Fetch link pages for empty titles (p-limit 5, 5s timeout)
      generate-rss.ts           # Generate RSS 2.0 XML from items
      generate-atom.ts          # Generate Atom 1.0 XML from items
      cache.ts                  # In-memory cache with TTL, ETag, normalized keys
      validate.ts               # Validate + parse query parameters
      charset.ts                # Detect and decode charset from headers/meta
    utils/
      escape-xml.ts             # XML entity escaping (& < > " ')
      resolve-url.ts            # Resolve relative URLs against base, filter non-http(s)
      normalize-url.ts          # Auto-prepend https:// if no protocol
      ua.ts                     # Chrome 136 User-Agent string constant
      text.ts                   # Trim + collapse whitespace
  test/
    fixtures/
      html/
        blog-with-links.html
        blog-without-links.html
        euc-kr-page.html
        large-list.html
        ads-mixed.html
        empty-titles.html
        special-urls.html
      expected/
        blog-rss.xml
        blog-atom.xml
    unit/
      lib/
        scrape.test.ts
        resolve-titles.test.ts
        generate-rss.test.ts
        generate-atom.test.ts
        cache.test.ts
        validate.test.ts
        charset.test.ts
      utils/
        escape-xml.test.ts
        resolve-url.test.ts
        normalize-url.test.ts
        text.test.ts
    integration/
      server.test.ts            # Full HTTP server tests (routing, 404, 405)
      etag.test.ts              # Conditional request tests (304, ETag format)
      debug.test.ts             # Debug mode tests (JSON output, both /rss and /atom)
      error.test.ts             # Error response tests (400, 502, missing params)
      cache.test.ts             # Cache behavior (TTL, ttl=0, key normalization)
  docs/
    SPEC.en.md                  # This file
  biome.json
  knip.json
  package.json
  tsconfig.json
  .github/
    workflows/
      release.yml               # Test + lint + build + npm publish + GitHub Release
```

## Code Conventions

Mirrors wachi's conventions:

| Rule | Detail |
|------|--------|
| 1 file = 1 exported function | Each file exports one primary function |
| Max 200 lines per file | Except test files |
| No type assertions | No `as` keyword. Use zod or type guards |
| Install with `bun i` | Never manually edit package.json |

## Distribution

### npm (primary)

Published as `torss` on npm with platform-specific binary packages:

```
torss/                          # Main package (entry point script)
@torss/darwin-arm64/            # macOS ARM64 binary
@torss/darwin-x64/              # macOS x64 binary
@torss/linux-arm64/             # Linux ARM64 binary
@torss/linux-x64/               # Linux x64 binary
@torss/win32-x64/               # Windows x64 binary
```

Same pattern as wachi (and esbuild, turbo, biome):

```json
{
  "name": "torss",
  "bin": { "torss": "bin/torss" },
  "optionalDependencies": {
    "@torss/darwin-arm64": "0.1.0",
    "@torss/darwin-x64": "0.1.0",
    "@torss/linux-arm64": "0.1.0",
    "@torss/linux-x64": "0.1.0",
    "@torss/win32-x64": "0.1.0"
  }
}
```

### GitHub Releases

Each release publishes `bun build --compile` binaries for all 5 platform/arch combinations.

### Version Management

Version baked into source at build time, same as wachi:

```typescript
// src/version.ts
export const VERSION = "0.1.0"
```

## CI/CD

Mirrors wachi's pipeline. One GitHub Actions workflow on push to main:

1. Run tests (`bun test`)
2. Type check (`tsgo`)
3. Lint (`biome check`)
4. Dead code detection (`knip`)
5. `bun build --compile` for all 5 platform/arch targets
6. Publish to npm (main package + 5 platform packages)
7. Create GitHub Release with binaries

## Testing

### Test Layers

| Layer | Scope |
|-------|-------|
| **Unit** | `scrape`, `resolve-titles`, `generate-rss`, `generate-atom`, `cache`, `validate`, `charset`, `escape-xml`, `resolve-url`, `normalize-url`, `text` |
| **Integration** | Full HTTP server: routing (404, 405), feed generation, ETag/304, debug mode, error responses, cache behavior |

### Test Philosophy

- **Deterministic**: No network calls in tests. All HTML fixtures are local files. HTTP mocked in unit tests
- **Realistic fixtures**: Capture real HTML from actual sites (blogs, news, Korean sites with EUC-KR, pages with ads mixed in, empty title scenarios, special URL schemes)
- **Error paths tested**: Every error condition in the error table has a corresponding test

## Non-Goals

- JavaScript rendering (Playwright/Puppeteer)
- Authenticated/cookie-based sites
- SSRF protection (trusted local environment)
- Disk-based cache persistence
- URL shortening / registration
- Date extraction / parsing
- Attribute extraction beyond href (no `data-*`, `src`, `datetime` etc.)
- Interactive configuration
- Web UI / dashboard
- Pagination / infinite scroll support
- Request coalescing (thundering herd)

## Implementation Plan

1. Project scaffolding (`bun i`, tsconfig.json, biome.json, knip.json, directory structure)
2. Utils layer (XML escaping, URL resolution, URL normalization, Chrome UA constant, text trim+collapse)
3. Query parameter validation (zod schema for all params, type coercion for limit/ttl/debug)
4. Charset detection (Content-Type header charset + `<meta charset>` parsing + decode to UTF-8)
5. HTML scraping (ofetch + cheerio: fetch, parse, extract items with CSS selectors, filter invalid links)
6. Empty title resolution (p-limit 5, 5s timeout, fetch link page `<title>`, fallback to URL)
7. RSS 2.0 generation (items -> XML string, channel metadata from `<title>`, entity escaping, self-link from Host header)
8. Atom 1.0 generation (items -> XML string, `<updated>` from fetch timestamp)
9. In-memory cache (normalized key via sorted params, TTL, ttl=0 bypass)
10. ETag computation (SHA-256, first 16 hex chars, RFC 7232 quoted format)
11. HTTP server (`Bun.serve()` with routing: `/` health, `/rss`, `/atom`, 404 catch-all, 405 for non-GET)
12. Conditional request support (If-None-Match -> 304 Not Modified)
13. Debug mode (`?debug=1` -> JSON response, works on both endpoints)
14. Error handling (400/404/405/502 responses with JSON error bodies)
15. Verbose logging (`TORSS_VERBOSE=1`, all output to stdout)
16. Port conflict handling (detect, print error, exit 1)
17. Version baking (package.json -> src/version.ts)
18. Test suite (unit + integration with HTML fixtures)
19. Build pipeline (`bun build --compile` for 5 targets)
20. GitHub Actions workflow (test + lint + knip + build + publish)
21. npm package configuration (main + 5 platform packages with optionalDependencies)
