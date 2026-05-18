# torss - 어떤 웹사이트든 RSS 피드로 변환

## 목표

- **Stateless**: 데이터베이스 없음, 설정 파일 없음. 모든 스크래핑 규칙이 URL에 인코딩됨
- **wachi의 동반자**: RSS가 없는 사이트의 빈틈을 채움. wachi는 torss URL을 일반 RSS 피드로 구독
- **Zero config**: 서버 시작, URL 구성, wachi에서 구독. 끝
- **범용**: HTML을 제공하는 모든 웹사이트에서 동작. CSS selector로 추출 대상 정의
- **최소한**: 단일 목적 도구. HTML 스크래핑, RSS 생성. 그 외에는 없음

## 개요

torss는 웹 페이지를 스크래핑해서 RSS/Atom 피드를 즉석에서 생성하는 로컬 HTTP 서버다. RSS 피드가 없는 웹사이트와 wachi 같은 RSS 리더 사이의 다리 역할을 한다.

**태그라인:** Turn any website into an RSS feed.

```
웹사이트 (RSS 없음)       torss                     wachi
                    GET /rss?url=...&item=...
https://example.com ──────────────────────────> RSS 2.0 XML
                         │                         │
                    1. HTML 가져오기                  │
                    2. cheerio로 파싱                 │
                    3. CSS selector로 아이템 추출      │
                    4. RSS XML 생성                   │
                    5. ETag과 함께 응답           wachi sub ...
                                               wachi check
                                               (일반 RSS 피드로 취급)
```

## 아키텍처

### 요청 흐름

```
wachi check
  │
  ▼
GET http://127.0.0.1:8677/rss?url=https://example.com/news&item=.article&link=a
  │
  ▼
torss가 요청 수신
  │
  ├─ GET이 아님? → 405 Method Not Allowed (Allow: GET)
  ├─ 알 수 없는 경로? → 404 JSON 에러 (사용 가능한 라우트 안내)
  │
  ├─ 캐시 히트 (TTL 만료 안 됨)?
  │    ├─ If-None-Match가 ETag과 일치? → 304 Not Modified
  │    └─ ETag 불일치 또는 If-None-Match 없음? → 200 + 캐시된 RSS XML
  │
  └─ 캐시 미스 또는 만료
       │
       ▼
  1. 필수 파라미터 검증 (url, item, link) → 없으면 400
  2. url 파라미터 정규화 (프로토콜 없으면 https:// 자동 추가)
  3. Chrome User-Agent로 대상 URL fetch (15초 타임아웃, 재시도 없음)
  4. Content-Type / <meta charset>에서 charset 감지, UTF-8로 디코딩
  5. 응답이 5MB 초과하면 거부
  6. cheerio로 HTML 파싱
  7. $(item).each() → link (href from <a>), title (text), desc (text) 추출
  8. 필터: 유효한 http(s) 링크가 없는 아이템 skip
  9. title이 빈 아이템: 링크 페이지의 <title> fetch (병렬, p-limit 5, 5초 타임아웃)
  10. 해석된 link URL 기준으로 중복 제거 (DOM 순서 첫 번째 우선)
  11. N개로 제한 (기본 50, limit=0이면 제한 없음)
  12. 상대 URL을 대상 URL 기준으로 해석
  13. RSS 2.0 또는 Atom 1.0 XML 생성
  14. ETag 계산: XML의 SHA-256 중 첫 16 hex 문자, RFC 7232 따옴표 형식
  15. 정규화된 캐시 키로 캐시에 저장
  16. Content-Type + ETag + Cache-Control 헤더와 함께 XML 반환
```

### 0건 매칭 = 에러

`item` selector가 0개의 엘리먼트를 매칭하면, torss는 **HTTP 502**를 반환한다 (빈 RSS가 아님). 이를 통해 wachi의 health tracking이 깨진 selector를 consecutive failure로 감지할 수 있다. "새 글이 없다"로 조용히 넘어가는 것을 방지.

## URL 프로토콜

### 엔드포인트

| 메소드 | 경로 | 설명 |
|--------|------|------|
| GET | `/` | 헬스체크 + 사용법 안내 (JSON) |
| GET | `/rss` | RSS 2.0 피드 생성 |
| GET | `/atom` | Atom 1.0 피드 생성 |

그 외의 경로는 **404** 반환: `{"error": "Not found", "routes": ["/", "/rss", "/atom"]}`.

GET이 아닌 메소드는 **405 Method Not Allowed** 반환 + `Allow: GET` 헤더.

**인식되지 않는 쿼리 파라미터는 조용히 무시된다.** 문서화된 파라미터만 처리됨.

### 쿼리 파라미터

| 파라미터 | 필수 | 기본값 | 설명 |
|---------|------|--------|------|
| `url` | Y | - | 스크래핑할 대상 URL. 프로토콜 없으면 `https://` 자동 추가 |
| `item` | Y | - | 아이템 컨테이너의 CSS selector |
| `link` | Y | - | 각 아이템 내의 링크 CSS selector. `<a>` 엘리먼트의 `href`를 추출. **`title` 생략 시 text content가 제목으로 사용됨** |
| `title` | N | link text | 각 아이템 내의 제목 CSS selector. text content를 추출. 생략 시 link 엘리먼트의 text content가 제목 |
| `desc` | N | - | 각 아이템 내의 설명 CSS selector. text content를 추출. 최대 500자 (`...`으로 잘림) |
| `limit` | N | `50` | 최대 아이템 수. `0`이면 제한 없음 (전체 반환) |
| `ttl` | N | 글로벌 기본값 | 이 피드의 캐시 TTL (초). `0`이면 캐시 비활성화 (항상 새로 fetch) |
| `lang` | N | `en` | 대상 사이트에 보내는 Accept-Language 헤더 |
| `debug` | N | - | `1`이면 RSS/Atom XML 대신 JSON 반환. `/rss`와 `/atom` 모두에서 동작 (동일한 JSON 출력). **문자열 `"1"`만 디버그 모드 활성화; 다른 모든 값은 무시.** 디버그 요청은 항상 캐시를 바이패스 |

### URL 정규화

`url` 파라미터에 프로토콜이 없으면 `https://`를 자동 추가 (wachi와 동일한 동작):

- `url=example.com/news` → `https://example.com/news`를 fetch
- `url=https://example.com` → 그대로 사용
- `url=http://example.com` → 그대로 사용 (명시적으로 지정된 http 유지)

### Selector 동작

- **link**: 각 아이템 내에서 첫 번째로 매칭되는 `<a>` 엘리먼트의 `href` 속성을 추출. 여러 개 매칭 시 첫 번째만 사용. 매칭된 엘리먼트가 `<a>`가 아니면 (href 없음) 해당 아이템은 **skip** (링크 없음으로 처리)
- **title**: 첫 번째 매칭 엘리먼트의 text content를 추출. 생략 시 link 엘리먼트의 text content를 제목으로 사용
- **desc**: 첫 번째 매칭 엘리먼트의 text content를 추출 (HTML 태그 제거). 500자 초과 시 `...`으로 잘림
- **모든 selector는 각 아이템 컨테이너 범위 내에서 동작** (전체 문서가 아님)

### 텍스트 추출

추출된 모든 텍스트 (title, desc, link text)는 다음 처리를 거침:

1. **Trim**: 양쪽 공백 제거
2. **Collapse**: 연속된 공백 문자 (`\n`, `\t`, 다중 스페이스)를 단일 스페이스로 치환

예시: `"  foo\n  bar  "` → `"foo bar"`

### 빈 제목 해결

title 추출 결과가 빈 문자열일 때 (trim + collapse 후), torss는 해당 link URL의 페이지를 fetch해서 `<title>` 태그를 추출:

1. 빈 title인 아이템 모두 수집
2. 해당 link URL들을 병렬로 fetch (최대 5개 동시, p-limit 사용, 요청당 5초 타임아웃)
3. 각 응답의 `<title>` 태그 파싱
4. fetch 실패 또는 `<title>`이 비어있거나 없으면, link URL 자체를 title로 사용

이를 통해 모든 RSS 아이템이 항상 의미 있는 제목을 가지도록 보장.

### 아이템 필터링 & 순서

- **링크 검증**: link selector가 `<a>` 엘리먼트를 매칭하지 못하거나 `href`가 없는 아이템은 **조용히 skip**
- **특수 URL scheme**: `javascript:`, `mailto:`, `#fragment`만 있는 링크, 기타 비-http(s) scheme은 skip. Protocol-relative URL (`//cdn.example.com/...`)은 `https:`를 붙여서 해석
- **중복 제거**: 동일한 해석된 link URL을 가진 아이템은 중복 제거. DOM 순서에서 첫 번째 것이 우선
- **순서**: DOM 순서 그대로 (정렬 없음)
- **제한**: 필터링과 중복 제거 후 적용. 기본 50. `limit=0`이면 전체 반환

## 예시

### 기본 사용법

```bash
# torss 시작
torss
# Listening on http://127.0.0.1:8677

# wachi에서 구독
wachi sub -n hn -a "slack://xoxb-.../channel" \
  "http://127.0.0.1:8677/rss?url=https://news.ycombinator.com&item=.athing&link=.titleline>a"

# wachi가 일반 RSS 피드로 취급
wachi check
```

### 제목이 링크 텍스트와 같은 경우 (흔한 케이스)

제목이 곧 링크 텍스트인 경우, `item`과 `link`만 있으면 충분:

```html
<!-- 대상 페이지 -->
<div class="post">
  <a href="/article/123">Breaking: New Discovery</a>
</div>
```

```
/rss?url=https://example.com&item=.post&link=a
```

결과: `title = "Breaking: New Discovery"`, `link = "https://example.com/article/123"`

### 제목과 링크가 분리된 경우

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

### 옵션 포함

```
/rss?url=https://example.com/news&item=article&link=a&title=h2&limit=20&ttl=120&lang=ko
```

### 프로토콜 없는 URL

```
/rss?url=example.com/news&item=.post&link=a
```

`https://example.com/news`를 fetch (자동 추가).

### Atom 형식

```
/atom?url=https://example.com&item=.post&link=a
```

### 디버그 모드

```
/rss?url=https://example.com&item=.post&link=a&debug=1
```

JSON 반환 (`/rss`, `/atom` 경로 무관하게 동일한 출력):

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

### 캐시 비활성화

```
/rss?url=https://example.com&item=.post&link=a&ttl=0
```

항상 대상 사이트를 새로 fetch (캐싱 안 함).

### 아이템 수 제한 없음

```
/rss?url=https://example.com&item=.post&link=a&limit=0
```

매칭된 모든 아이템 반환 (50개 제한 없음).

## RSS 출력

### RSS 2.0

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Example Site</title>
    <link>https://example.com</link>
    <description>Generated by torss</description>
    <atom:link href="http://127.0.0.1:8677/rss?url=..." rel="self" type="application/rss+xml"/>
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
  <link href="http://127.0.0.1:8677/atom?url=..." rel="self"/>
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

### 채널 메타데이터

| 필드 | 값 |
|------|-----|
| **title** | 대상 페이지의 `<title>` HTML 태그. 없거나 비어있으면 `url` 파라미터 값으로 대체 |
| **link** | `url` 파라미터 값 |
| **description** | 고정 문자열 `"Generated by torss"` (RSS만 해당; Atom에는 description 없음) |
| **guid** | 해석된 link URL, `isPermaLink="true"` |
| **updated** (Atom) | 대상 페이지를 fetch한 시각의 ISO 8601 타임스탬프. 캐시된 응답의 경우 원래 fetch 시각. `<feed>`와 각 `<entry>` 모두에 적용 (개별 아이템 날짜를 추출하지 않으므로 모두 동일한 타임스탬프) |

### Self-Link 생성

`<atom:link rel="self">` URL은 수신된 요청의 `Host` 헤더와 요청 경로 + 쿼리 스트링으로 구성:

```
<atom:link href="http://{request.host}{request.path}?{request.querystring}" rel="self" .../>
```

리버스 프록시 뒤에서도 올바른 self-link를 보장. scheme은 항상 `http://` (torss는 TLS를 제공하지 않음).

### XML 이스케이핑

XML에 삽입되는 모든 텍스트 콘텐츠는 엔티티 이스케이핑 적용. CDATA 섹션 사용 안 함.

| 문자 | 이스케이핑 |
|------|-----------|
| `&` | `&amp;` |
| `<` | `&lt;` |
| `>` | `&gt;` |
| `"` | `&quot;` |
| `'` | `&apos;` |

## 캐싱

### 인메모리 캐시

- **캐시 키**: 정규화된 요청 경로 + 쿼리 파라미터를 **알파벳순으로 정렬**. `?url=x&item=y`와 `?item=y&url=x`는 동일한 캐시 키 생성
- **캐시 값**: 생성된 XML 문자열 + ETag 해시 + fetch 타임스탬프 (ISO 8601)
- **기본 TTL**: 300초 (5분), `TORSS_TTL` 환경변수로 설정 가능
- **피드별 오버라이드**: `?ttl=N` 쿼리 파라미터 (초 단위). `ttl=0`이면 캐싱 비활성화 (항상 새로 fetch)
- **메모리 전용**: 서버 재시작 시 캐시 소멸. 콜드 스타트 시 피드당 한 번의 캐시 미스 발생, 허용 가능

### ETag 지원

torss는 wachi의 ETag/If-Modified-Since 최적화를 위한 조건부 요청을 지원:

1. RSS/Atom XML 생성
2. XML 콘텐츠의 SHA-256 해시 계산
3. 해시의 **첫 16 hex 문자**를 취함
4. RFC 7232에 따라 **따옴표로 감싼** `ETag` 응답 헤더로 반환: `"a1b2c3d4e5f6a7b8"`
5. 후속 요청에서 `If-None-Match` 헤더가 현재 ETag과 일치하면 **304 Not Modified** 반환 (본문 없음)

대상 페이지 콘텐츠가 wachi 체크 사이에 변경되지 않았을 때 대역폭을 절약.

## HTTP

### 아웃바운드 요청 (torss -> 대상 사이트)

- **User-Agent**: Chrome 136 UA 문자열, `src/utils/ua.ts`에 하드코딩. 새 torss 릴리스 시 업데이트:

  ```
  Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36
  ```

- **Accept-Language**: 기본 `en`, `?lang=` 파라미터로 오버라이드
- **타임아웃**: 15초 (`TORSS_TIMEOUT` 환경변수로 설정 가능). wachi의 30초 타임아웃 내에 완료되어야 함
- **재시도**: 없음. wachi가 RSS 소비자 레벨에서 재시도 담당. 이중 재시도 증폭 방지
- **응답 크기 제한**: 5MB. 초과하는 응답은 HTTP 502로 거부
- **Charset 감지**: `Content-Type` 헤더의 charset 또는 `<meta charset>` 태그에서 자동 감지. UTF-8로 디코딩

### Title 페이지 Fetch (빈 제목용)

- **범위**: title 추출 결과가 빈 문자열인 아이템에만 트리거
- **동시성**: p-limit으로 최대 5개 동시 fetch
- **타임아웃**: 요청당 5초 (메인 fetch보다 짧음)
- **User-Agent**: 메인 fetch와 동일한 Chrome UA
- **실패 처리**: fetch 실패 또는 `<title>`이 비어있거나 없으면, link URL 자체를 title로 사용
- **크기 제한**: 동일한 5MB 제한 적용

### 인바운드 응답 (torss -> wachi)

| 응답 타입 | Content-Type |
|----------|-------------|
| RSS 2.0 | `application/rss+xml; charset=utf-8` |
| Atom 1.0 | `application/atom+xml; charset=utf-8` |
| JSON (디버그, 에러, 헬스체크) | `application/json; charset=utf-8` |

성공적인 피드 응답의 추가 헤더:

| 헤더 | 값 |
|------|-----|
| `ETag` | `"<SHA-256의 첫 16 hex 문자>"` |
| `Cache-Control` | `public, max-age=<ttl>` |

### 상대 URL 해석

페이지에서 추출된 모든 상대 URL은 `url` 파라미터 값을 기준으로 `new URL(relative, baseUrl)`로 해석:

- `/post/123` → `https://example.com/post/123`
- `post/123` → `https://example.com/post/123`
- `//cdn.example.com/img.png` → `https://cdn.example.com/img.png` (protocol-relative는 `https:` 추가)

## 에러 처리

| 조건 | HTTP 상태 | 응답 본문 |
|------|-----------|----------|
| `url`, `item`, `link` 파라미터 누락 | 400 | `{"error": "Missing required parameter: <param>", "usage": "GET /rss?url=<url>&item=<selector>&link=<selector>"}` |
| 유효하지 않은 CSS selector 문법 | 400 | `{"error": "Invalid CSS selector", "selector": "<selector>", "param": "<param_name>"}` |
| 유효하지 않은 숫자 파라미터 (`limit=abc`, `ttl=-1`) | 400 | `{"error": "Invalid parameter value", "param": "<param_name>", "detail": "Expected a non-negative integer"}` |
| 대상 사이트 접속 불가 / 타임아웃 | 502 | `{"error": "Failed to fetch <url>", "detail": "<reason>"}` |
| 대상이 403 / bot 차단 반환 | 502 | `{"error": "Access denied by <url>", "detail": "The site may be blocking automated requests"}` |
| 응답이 5MB 초과 | 502 | `{"error": "Response too large", "detail": "Exceeded 5MB limit from <url>"}` |
| `item` selector가 0개 매칭 | 502 | `{"error": "No items matched", "selector": "<item_selector>", "url": "<url>"}` |
| 모든 매칭된 아이템에 유효한 링크 없음 | 502 | `{"error": "No valid items", "detail": "All matched items were missing http(s) links"}` |
| 알 수 없는 경로 | 404 | `{"error": "Not found", "routes": ["/", "/rss", "/atom"]}` |
| GET이 아닌 메소드 | 405 | `{"error": "Method not allowed"}` + `Allow: GET` 헤더 |
| 포트 이미 사용 중 | - | `Error: Port <port> already in use` stdout 출력 후 exit code 1로 종료 |

모든 에러 응답은 `Content-Type: application/json; charset=utf-8` 사용.

Bot 보호 사이트 (Cloudflare Turnstile, CAPTCHA 등)는 명확한 메시지와 함께 빠르게 실패. torss는 bot 보호를 우회하지 않음.

## 서버 설정

모든 설정은 환경변수로. 설정 파일 없음.

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `8677` | 서버 포트 |
| `HOST` | `127.0.0.1` | 바인드 주소. 모든 인터페이스는 `0.0.0.0` |
| `TORSS_TTL` | `300` | 글로벌 기본 캐시 TTL (초) |
| `TORSS_TIMEOUT` | `15000` | 아웃바운드 fetch 타임아웃 (밀리초) |
| `TORSS_VERBOSE` | - | `1`로 설정하면 상세 요청 로깅 |

### 로깅

모든 로그 출력은 **stdout**으로.

- **기본**: 에러 + 시작 메시지만
- **Verbose** (`TORSS_VERBOSE=1`): 모든 요청을 URL, 응답 시간, 캐시 히트/미스, 매칭된 아이템 수와 함께 로깅

```
# 기본
Listening on http://127.0.0.1:8677

# Verbose
Listening on http://127.0.0.1:8677
[req] GET /rss?url=https://example.com&item=.post&link=a (cache miss, 342ms, 12 items)
[req] GET /rss?url=https://example.com&item=.post&link=a (cache hit, etag match, 304)
[err] GET /rss?url=https://down.example.com&item=.x&link=a (fetch failed, timeout 15000ms)
```

### 종료

SIGINT/SIGTERM (Ctrl+C) 시: 즉시 종료. Graceful drain 없음. 짧은 요청을 처리하는 로컬 서버에는 커넥션 드레이닝 불필요.

### 헬스체크 (GET /)

서버 정보와 사용법 안내를 JSON으로 반환:

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
      "url": "스크래핑할 대상 URL (필수, https:// 자동 추가)",
      "item": "아이템 컨테이너 CSS selector (필수)",
      "link": "각 아이템 내의 링크 CSS selector (필수)",
      "title": "제목 CSS selector (선택, 기본: link 텍스트)",
      "desc": "설명 CSS selector (선택, 최대 500자)",
      "limit": "최대 아이템 수, 0 = 제한 없음 (기본: 50)",
      "ttl": "캐시 TTL 초, 0 = 캐시 안 함 (기본: 300)",
      "lang": "대상 요청의 Accept-Language (기본: en)",
      "debug": "1로 설정하면 XML 대신 JSON 출력"
    }
  }
}
```

## 기술 스택

| 구성 요소 | 선택 | 이유 |
|----------|------|------|
| 언어 | TypeScript | 타입 안전성, wachi 생태계와 일치 |
| 타입 체커 | tsgo (`@typescript/native-preview`) | tsc보다 10배 빠른 타입 체킹, wachi와 동일 |
| 런타임 | Bun | `Bun.serve()` 내장 HTTP 서버, 빠른 시작, `bun build --compile` |
| HTML 파싱 | cheerio | 빠름, jQuery 스타일 CSS selector API, 브라우저 불필요 |
| HTTP 클라이언트 | ofetch | 타임아웃 지원, wachi와 일관성. 재시도 설정 없음 |
| 동시성 | p-limit | title 페이지 fetch의 동시성 제한. wachi와 동일 |
| 린터/포매터 | Biome v2 | wachi와 동일. 린팅 + 포매팅 단일 도구 |
| 데드 코드 탐지 | knip | wachi와 동일. 미사용 의존성/export 탐지 |
| 테스트 러너 | bun test | 네이티브 Bun 테스트 러너, wachi와 동일 |

### 의존성

**런타임:**

| 패키지 | 용도 |
|--------|------|
| `cheerio` | HTML 파싱 + CSS selector 엔진 |
| `ofetch` | 대상 페이지 fetch용 HTTP 클라이언트 |
| `p-limit` | title 페이지 fetch의 동시성 제한 |

**개발:**

| 패키지 | 용도 |
|--------|------|
| `@typescript/native-preview` | 타입 체킹 (tsgo) |
| `@biomejs/biome` | 린팅 + 포매팅 |
| `knip` | 데드 코드 / 미사용 의존성 탐지 |
| `@types/bun` | Bun 타입 정의 |

## 프로젝트 구조

```
torss/
  src/
    index.ts                    # Bun.serve() 엔트리포인트, 라우팅, 405/404 처리
    version.ts                  # 빌드 시 주입되는 버전 상수
    lib/
      scrape.ts                 # URL fetch + cheerio 파싱 + 아이템 추출
      resolve-titles.ts         # 빈 제목용 링크 페이지 fetch (p-limit 5, 5초 타임아웃)
      generate-rss.ts           # 아이템 → RSS 2.0 XML 생성
      generate-atom.ts          # 아이템 → Atom 1.0 XML 생성
      cache.ts                  # TTL, ETag, 정규화된 키를 가진 인메모리 캐시
      validate.ts               # 쿼리 파라미터 검증 + 파싱
      charset.ts                # 헤더/meta에서 charset 감지 + 디코딩
    utils/
      escape-xml.ts             # XML 엔티티 이스케이핑 (& < > " ')
      resolve-url.ts            # 상대 URL을 기준 URL로 해석, 비-http(s) 필터링
      normalize-url.ts          # 프로토콜 없으면 https:// 자동 추가
      ua.ts                     # Chrome 136 User-Agent 문자열 상수
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
      server.test.ts            # 전체 HTTP 서버 테스트 (라우팅, 404, 405)
      etag.test.ts              # 조건부 요청 테스트 (304, ETag 형식)
      debug.test.ts             # 디버그 모드 테스트 (JSON 출력, /rss와 /atom 모두)
      error.test.ts             # 에러 응답 테스트 (400, 502, 파라미터 누락)
      cache.test.ts             # 캐시 동작 (TTL, ttl=0, 키 정규화)
  docs/
    SPEC.en.md                  # 영문 스펙
    SPEC.ko.md                  # 이 파일
  biome.json
  knip.json
  package.json
  tsconfig.json
  .github/
    workflows/
      release.yml               # 테스트 + 린트 + 빌드 + npm 배포 + GitHub Release
```

## 코드 컨벤션

wachi의 컨벤션을 따름:

| 규칙 | 상세 |
|------|------|
| 1 파일 = 1 export 함수 | 각 파일은 하나의 주요 함수를 export |
| 파일당 최대 200줄 | 테스트 파일 제외 |
| 타입 단언 금지 | `as` 키워드 사용 안 함. zod 파싱 또는 타입 가드 사용 |
| bun i로 설치 | package.json 수동 편집 금지 |

## 배포

### npm (주요)

`torss`로 npm에 배포, 플랫폼별 바이너리 패키지 포함:

```
torss/                          # 메인 패키지 (엔트리포인트 스크립트)
@torss/darwin-arm64/            # macOS ARM64 바이너리
@torss/darwin-x64/              # macOS x64 바이너리
@torss/linux-arm64/             # Linux ARM64 바이너리
@torss/linux-x64/               # Linux x64 바이너리
@torss/win32-x64/               # Windows x64 바이너리
```

wachi (그리고 esbuild, turbo, biome)와 동일한 패턴:

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

매 릴리스마다 5개 플랫폼/아키텍처 조합의 `bun build --compile` 바이너리를 배포.

### 버전 관리

wachi와 동일하게 빌드 시 소스에 버전 주입:

```typescript
// src/version.ts
export const VERSION = "0.1.0"
```

## CI/CD

wachi의 파이프라인을 미러링. main에 push 시 하나의 GitHub Actions 워크플로우:

1. 테스트 실행 (`bun test`)
2. 타입 체크 (`tsgo`)
3. 린트 (`biome check`)
4. 데드 코드 탐지 (`knip`)
5. 5개 플랫폼/아키텍처 타깃으로 `bun build --compile`
6. npm에 배포 (메인 패키지 + 5개 플랫폼 패키지)
7. 바이너리와 함께 GitHub Release 생성

## 테스트

### 테스트 레이어

| 레이어 | 범위 |
|--------|------|
| **Unit** | `scrape`, `resolve-titles`, `generate-rss`, `generate-atom`, `cache`, `validate`, `charset`, `escape-xml`, `resolve-url`, `normalize-url`, `text` |
| **Integration** | 전체 HTTP 서버: 라우팅 (404, 405), 피드 생성, ETag/304, 디버그 모드, 에러 응답, 캐시 동작 |

### 테스트 철학

- **결정론적**: 테스트에서 네트워크 호출 없음. 모든 HTML fixture는 로컬 파일. 유닛 테스트에서 HTTP는 mock
- **현실적인 fixture**: 실제 사이트에서 캡처한 HTML (블로그, 뉴스, EUC-KR 한국어 사이트, 광고가 섞인 페이지, 빈 제목 시나리오, 특수 URL scheme)
- **에러 경로 테스트**: 에러 처리 테이블의 모든 에러 조건에 대응하는 테스트 존재

## 비목표 (명시적으로 범위 밖)

- JavaScript 렌더링 (Playwright/Puppeteer)
- 인증/쿠키 기반 사이트
- SSRF 보호 (신뢰할 수 있는 로컬 환경)
- 디스크 기반 캐시 영속화
- URL 단축 / 등록
- 날짜 추출 / 파싱
- href 외 속성 추출 (`data-*`, `src`, `datetime` 등 불가)
- 인터랙티브 설정
- 웹 UI / 대시보드
- 페이지네이션 / 무한 스크롤 지원
- 요청 병합 (thundering herd)

## 구현 계획

1. 프로젝트 스캐폴딩 (`bun i`, tsconfig.json, biome.json, knip.json, 디렉토리 구조)
2. Utils 레이어 (XML 이스케이핑, URL 해석, URL 정규화, Chrome UA 상수, 텍스트 trim+collapse)
3. 쿼리 파라미터 검증 (모든 파라미터의 zod 스키마, limit/ttl/debug 타입 변환)
4. Charset 감지 (Content-Type 헤더 charset + `<meta charset>` 파싱 + UTF-8 디코딩)
5. HTML 스크래핑 (ofetch + cheerio: fetch, 파싱, CSS selector로 아이템 추출, 유효하지 않은 링크 필터링)
6. 빈 제목 해결 (p-limit 5, 5초 타임아웃, 링크 페이지 `<title>` fetch, URL로 fallback)
7. RSS 2.0 생성 (아이템 → XML 문자열, `<title>`에서 채널 메타데이터, 엔티티 이스케이핑, Host 헤더에서 self-link)
8. Atom 1.0 생성 (아이템 → XML 문자열, fetch 타임스탬프에서 `<updated>`)
9. 인메모리 캐시 (정렬된 파라미터로 정규화된 키, TTL, ttl=0 바이패스)
10. ETag 계산 (SHA-256, 첫 16 hex 문자, RFC 7232 따옴표 형식)
11. HTTP 서버 (`Bun.serve()` 라우팅: `/` 헬스, `/rss`, `/atom`, 404 catch-all, 비-GET 405)
12. 조건부 요청 지원 (If-None-Match → 304 Not Modified)
13. 디버그 모드 (`?debug=1` → JSON 응답, 양쪽 엔드포인트에서 동작)
14. 에러 처리 (400/404/405/502 응답, JSON 에러 본문)
15. Verbose 로깅 (`TORSS_VERBOSE=1`, 모든 출력 stdout으로)
16. 포트 충돌 처리 (감지, 에러 출력, exit 1)
17. 버전 주입 (package.json → src/version.ts)
18. 테스트 스위트 (HTML fixture와 함께 유닛 + 통합 테스트)
19. 빌드 파이프라인 (5개 타깃으로 `bun build --compile`)
20. GitHub Actions 워크플로우 (테스트 + 린트 + knip + 빌드 + 배포)
21. npm 패키지 설정 (메인 + optionalDependencies로 5개 플랫폼 패키지)
