# torss

Turn any website into an RSS feed.

torss is a stateless local HTTP server that scrapes web pages using CSS selectors and generates RSS 2.0 or Atom 1.0 feeds on the fly. All scraping rules are encoded in the URL -- no database, no config file.

## Install

```bash
bun i torss
```

Or clone and install from source:

```bash
git clone https://github.com/ysm-dev/torss.git
cd torss
bun i
```

## Quick start

```bash
# Start the server
bun run start
# Listening on http://127.0.0.1:8677

# Generate an RSS feed from Hacker News
curl "http://127.0.0.1:8677/rss?url=https://news.ycombinator.com&item=.athing&link=.titleline>a"
```

## Docker Compose

```bash
docker compose up -d --build
```

The Compose service binds torss to `0.0.0.0:8677` and uses `restart: unless-stopped`, so it starts again when OrbStack/Docker starts after a computer restart. Other Tailscale nodes can reach it at `http://<tailscale-ip>:8677` when macOS firewall rules allow the connection.

For OrbStack, also enable launch at login:

```bash
orbctl config set app.start_at_login true
```

## Usage

### Endpoints

| Method | Path    | Description              |
|--------|---------|--------------------------|
| GET    | `/`     | Health check + usage guide (JSON) |
| GET    | `/rss`  | Generate RSS 2.0 feed    |
| GET    | `/atom` | Generate Atom 1.0 feed   |

### Query parameters

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `url`     | Yes      | -       | Target URL to scrape. `https://` auto-prepended if missing |
| `item`    | Yes      | -       | CSS selector for item containers |
| `link`    | Yes      | -       | CSS selector for `<a>` within each item (extracts `href`). Text is used as title when `title` is omitted |
| `title`   | No       | link text | CSS selector for title within each item |
| `desc`    | No       | -       | CSS selector for description (max 500 chars) |
| `limit`   | No       | `50`    | Max items. `0` = no limit |
| `ttl`     | No       | `300`   | Cache TTL in seconds. `0` = always fetch fresh |
| `lang`    | No       | `en`    | Accept-Language header sent to target |
| `debug`   | No       | -       | Set to `1` for JSON output instead of XML |

### Examples

**Basic -- title is the link text:**

```
/rss?url=https://example.com&item=.post&link=a
```

**Separate title, link, and description:**

```
/rss?url=https://example.com&item=.entry&link=a&title=h2&desc=p
```

**Atom format:**

```
/atom?url=https://example.com&item=.post&link=a
```

**With options:**

```
/rss?url=https://example.com/news&item=article&link=a&title=h2&limit=20&ttl=120&lang=ko
```

**URL without protocol (auto-prepends `https://`):**

```
/rss?url=example.com/news&item=.post&link=a
```

**Debug mode (JSON output):**

```
/rss?url=https://example.com&item=.post&link=a&debug=1
```

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
    { "title": "Breaking: New Discovery", "link": "https://example.com/article/123", "desc": null }
  ],
  "totalMatched": 2,
  "totalAfterDedup": 2,
  "totalAfterLimit": 2
}
```

## Environment variables

All configuration via environment variables. No config file.

| Variable        | Default     | Description |
|-----------------|-------------|-------------|
| `PORT`          | `8677`      | Server port |
| `HOST`          | `127.0.0.1` | Bind address. `0.0.0.0` for all interfaces |
| `TORSS_TTL`     | `300`       | Global default cache TTL in seconds |
| `TORSS_TIMEOUT` | `15000`     | Outbound fetch timeout in milliseconds |
| `TORSS_VERBOSE` | -           | Set to `1` for detailed request logging |

## Development

```bash
bun run dev        # Start with --watch
bun test           # Run tests
bun run typecheck  # Type check with tsgo
bun run lint       # Lint with Biome
bun run knip       # Dead code detection
bun run build      # Compile to single binary
```

## How it works

1. Receive request with target URL and CSS selectors
2. Fetch the target page (Chrome UA, charset auto-detection, 5MB limit)
3. Parse HTML with cheerio, extract items via scoped CSS selectors
4. Filter invalid links (`javascript:`, `mailto:`, `#fragment`), dedup by URL
5. Resolve empty titles by fetching linked pages (concurrent, max 5)
6. Resolve relative URLs against the target URL
7. Generate RSS 2.0 or Atom 1.0 XML with proper escaping
8. Cache with TTL, serve with ETag / `304 Not Modified` support

## Error responses

All errors return `application/json; charset=utf-8`:

| Condition | Status |
|-----------|--------|
| Missing required parameter | 400 |
| Invalid CSS selector | 400 |
| Invalid numeric parameter | 400 |
| Target unreachable / timeout | 502 |
| Access denied (403) | 502 |
| Response too large (>5MB) | 502 |
| Zero items matched | 502 |
| All items have invalid links | 502 |
| Unknown path | 404 |
| Non-GET method | 405 |

## License

MIT
