# Streamclone Pulse Extension — Design

Companion to [`requirements.md`](./requirements.md) (R1–R12) and [`tasks.md`](./tasks.md). This is the architecture/decision document: repo strategy, data flow, schema, API contract, how the extension talks to the **streampulse-backend** BFF, what it takes to scale on the **hosted production stack**, edge cases, and performance.

**UI visuals:** [`figma-handoff.md`](./figma-handoff.md) and PNG exports in [`figma/`](./figma/) — use these for implementation parity (Codex-friendly; no Figma MCP required).

**Scope of the MVP:** a Twitch-native overlay (Chrome MV3) that reads Pulse from the **streampulse-backend** BFF (hosted default `https://api.streampulse.stream`; local dev opt-in `http://localhost:8081`). Backend stays the source of truth. The extension is thin: detect channel → ask to track → render Pulse → jump/save moments → recap on end. New product features (Moment memory R10, per-signal lanes R11, session recap R12) live in **core Pulse**, surfaced first in the extension.

---

## 1. Repo strategy — do we need a new repo?

**Decision (as shipped):** separate repo for the extension; BFF lives in **streampulse-backend** (not the public Streamclone main repo); share logic through a published package.

| Option | Verdict |
|--------|---------|
| Add the extension as a folder in `streamclone` (`apps/chrome-extension`) | Tightest sharing initially, but bloats the main repo's CI (Go + compose + scraper) with a JS build target, and couples the extension's fast release cadence to backend releases. Rejected. |
| **Separate repo `streamclone-pulse` + BFF in `streampulse-backend` + shared `@streampulse/pulse-core` package** | **Chosen (current).** Independent CI, store-release cadence, and permissions. Shared scoring/formatting logic is consumed as a versioned package, not copy-paste. BFF ownership is streampulse-backend, not public Streamclone. |
| Separate repo, copy-paste the helpers | Fast today, drift tomorrow. The whole point of R3.2/R11.3 is parity with the web app. Rejected. |

### How the shared code is shared

The core helpers are pure and DOM-free, extracted into a package published to **GitHub Packages** (private npm registry):

```
streampulse-backend (private repo — BFF owner)
  packages/pulse-core/         # extracted pure logic + types, published as @streampulse/pulse-core
  internal/analytics/          # BFF + bookmarks + recap (Go) lives here

streamclone-pulse (this repo)
  package.json                 # depends on @streampulse/pulse-core@^x
  src/...                      # extension + streampulse-web portal
```

- **`pulse-ui`** (React components) is extension/web-shared too, but ships **after** `pulse-core` — it has heavier deps (React/Tailwind) and the extension uses Shadow DOM, so keep it a separate publishable package and only extract once the extension's render layer stabilizes.

**Net:** this repo owns the extension app and portal UI; **streampulse-backend** owns the BFF and shared packages; public Streamclone (`twitch-7tv-clone`) is watch-only after boundary split.

---

## 2. System architecture

```text
┌─ twitch.tv (https) ─────────────────────────────┐
│  Content script (isolated world + Shadow DOM)    │
│   - detect login / VOD / live-offline            │
│   - mount overlay (pulse-ui)                     │
│   - control <video> for in-buffer seek           │
│            │ chrome.runtime.sendMessage          │
│            ▼                                      │
│  MV3 Service worker (extension origin)           │
│   - backend base URL + (later) device token      │
│   - poll BFF, retry/backoff, cache in storage    │
└────────────│─────────────────────────────────────┘
             │ fetch
             │  hosted (default): https://api.streampulse.stream
             │  local dev opt-in: http://localhost:8081 (streampulse-backend compose)
             ▼
┌─ streampulse-backend (BFF owner) ───────────────┐
│  analytics service (chi)                         │
│   /v1/extension/pulse/channels/{login}  (BFF)    │
│   /v1/extension/health                           │
│   /v1/pulse/bookmarks  (CRUD)                    │
│   /v1/pulse/streams/{id}/recap                   │
│   /v1/analytics/channels/{login}/watch           │
│            │                  │                   │
│   Redis (BFF cache,           Postgres            │
│    tracking pool)              (rollups, peaks,   │
│                                bookmarks, recap)  │
│  analytics-workers: IRC collector, 7TV tokenize, │
│   minute rollups, heatmap scoring, recap builder │
└──────────────────────────────────────────────────┘
  Note: public Streamclone (twitch-7tv-clone) watch stack
  uses http://localhost:8090 for HLS/chat/emotes only —
  not extension/portal BFF after boundary split.
```

### Why the service worker, not the content script (R5.1)

- MV3 replaces background pages with a service worker; network/secrets belong there.
- Cross-origin fetch from a content script is subject to the **page's** CSP and is fragile on Twitch. The service worker runs in the extension origin with declared `host_permissions`, so it's the clean, stable path.
- One poller per channel in the worker collapses N tabs → 1 request and survives tab churn.

---

## 3. Backend ↔ extension interaction (the part to get right)

### Transport & origin rules

| Concern | Local dev opt-in | Hosted (default) |
|---------|-----------------|------------------|
| Backend URL | http://localhost:8081 — streampulse-backend compose (mixed-content **exempt** for localhost) | https://api.streampulse.stream (**TLS required** — see §7) |
| Caller origin | `chrome-extension://<id>` | same |
| CORS | `httpx.CORS` (`Access-Control-Allow-Origin: *`) is fine because extension currently sends **no credentials** | If device tokens go in `Authorization` header (not cookies), `*` still works. If ever cookie-based, must echo the specific origin + `Allow-Credentials: true` (use `CORSForOrigin`). |
| Preflight | `OPTIONS` already handled by `httpx.CORS` (204) | same |

> **Hard constraint:** Chrome blocks fetching `http://` (non-localhost) from the extension's secure context. A public/hosted extension therefore **cannot** point at a bare IP-only HTTP endpoint — it needs HTTPS + a domain (e.g. `api.streampulse.stream` via Cloudflare Tunnel to hosted-production-vps). Pre-cutover legacy-rollback-host used IP-only HTTP; that path is rollback/archive only.

### Request lifecycle

1. Content script detects `login` (R1) → `sendMessage({type:'TRACK', login})`.
2. Worker debounces + de-dupes (R2.2), calls `POST /v1/analytics/channels/{login}/watch`, then starts a poll loop for `GET /v1/extension/pulse/channels/{login}` at the configured interval (R5.2).
3. Worker caches each successful payload in `chrome.storage.session` keyed by login (R5.3); answers overlay (re)mounts from cache instantly, then refreshes.
4. Overlay renders via `pulse-core` (R3.2). Save Moment → `POST /v1/pulse/bookmarks` (R10). Stream end (`isLive:false`) → fetch `/recap` and swap header (R12).

### Auth model

- **Local (non-hosted):** beta key optional; local stacks intentionally allow watch without a key for developer convenience.
- **Hosted default:** optional `X-Streamclone-Beta-Key`. Guest/wrong-key callers fall through to a guest principal and still hit always-track / top-roster gates. Arbitrary unauthenticated collector admission for non-tracked channels is blocked (`403 extension_watch_disabled`), not necessarily a blanket `401`.
- Bookmarks/watchlists remain principal-scoped when a beta key is present. No Twitch OAuth required for read/track; OAuth only if we later need "your followed channels".
- See [`../streampulse-sdlc/docs/guardrail-policy.md`](../../../streampulse-sdlc/docs/guardrail-policy.md) for honesty notes vs aspirational prose.

---

## 4. Folder structure (extension repo)

```text
streamclone-pulse/
  manifest.json                 # MV3
  src/
    background/
      service-worker.ts         # message router, poll scheduler, cache, backoff
      api.ts                    # typed BFF/bookmarks/recap client (wraps pulse-core/apiClient)
      tracking.ts               # per-login dedupe + TTL
    content/
      mount.ts                  # SPA-nav watcher, Shadow DOM host, single-instance guard
      twitch.ts                 # login/VOD/live detection, <video> handle, seek
      bridge.ts                 # sendMessage wrappers + typed responses
    ui/                         # consumes @streampulse/pulse-ui (or local until extracted)
      Overlay.tsx               # collapsed / mini / expanded modes (R4)
      SignalLanes.tsx           # R11
      SavedMoments.tsx          # R10
      StreamRecap.tsx           # R12
      states/                   # warming / offline / error (R8)
    popup/                      # toolbar action (status + open overlay)
    options/                    # settings (R6): backend URL, interval, placement, auto-track
    shared/
      messages.ts               # discriminated-union message contracts
      storage.ts                # typed chrome.storage wrappers
  tests/                        # vitest + @testing-library, playwright e2e on a Twitch fixture
  .github/workflows/ci.yml      # typecheck, test, build, zip artifact
```

Backend additions live in **streampulse-backend** (not public Streamclone):

```text
streampulse-backend/
  internal/analytics/
    extension_api.go            # BFF + health handlers
    bookmarks.go                # CRUD store + handlers
    recap.go                    # recap builder + cache read
  internal/analytics/recap/     # pure recap aggregation (mirrors pulse-core/recap.ts)
  migrations/000038_pulse_bookmarks.up.sql / .down.sql
  migrations/000039_pulse_stream_recap.up.sql / .down.sql   # optional cache table
  packages/pulse-core/          # extracted shared TS logic, published as @streampulse/pulse-core
```

---

## 5. Database schema

### 5.1 `pulse_bookmarks` (migration 000038) — R10

```sql
CREATE TABLE pulse_bookmarks (
  id              TEXT        PRIMARY KEY,             -- ULID
  user_id         TEXT        NULL,                    -- NULL in local MVP; set when hosted
  login           TEXT        NOT NULL,
  stream_id       TEXT        NULL,                    -- analytics stream id (text elsewhere)
  vod_id          TEXT        NULL,
  offset_seconds  INTEGER     NOT NULL CHECK (offset_seconds >= 0),  -- canonical anchor
  label           TEXT        NOT NULL,
  notes           TEXT        NOT NULL DEFAULT '',
  score           INTEGER     NULL CHECK (score IS NULL OR (score BETWEEN 0 AND 100)),
  source          TEXT        NOT NULL DEFAULT 'web' CHECK (source IN ('web','extension')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pulse_bookmarks_user_created ON pulse_bookmarks (user_id, created_at DESC);
CREATE INDEX idx_pulse_bookmarks_stream       ON pulse_bookmarks (stream_id);
CREATE INDEX idx_pulse_bookmarks_login        ON pulse_bookmarks (login);
```

- `offset_seconds` is canonical so a bookmark resolves to a VOD deep link once the VOD exists (R10.5), independent of when it was saved live.
- Forward-only migration (AGENTS rule: never edit applied migrations).

### 5.2 `pulse_stream_recap` (migration 000039, optional cache) — R12

Recap is **derivable** from existing rollups/peaks, but recomputing per request is wasteful. Cache the computed payload on stream end:

```sql
CREATE TABLE pulse_stream_recap (
  stream_id   TEXT        PRIMARY KEY,
  login       TEXT        NOT NULL,
  payload     JSONB       NOT NULL,        -- top moments, emotes, totals, clip candidates
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Built by a worker when a tracked stream transitions live→ended; the read endpoint serves the row, or computes-on-miss and backfills. No raw chat is stored beyond what rollups already keep — privacy stays as-is.

---

## 6. API design

All under the analytics service, behind Caddy. JSON, `snake_case` omitted in favor of the existing camelCase analytics convention.

### 6.1 BFF — `GET /v1/extension/pulse/channels/{login}`
Single compact payload (see `requirements.md` for the full shape): `isLive`, `tracking`, `streamId`, `vodId`, `currentOffsetSeconds`, `rollups[]`, `lanes{composite,chat,seventv,viewers?,keywords?}`, `peaks[]` (each with `dominantSignal`), `recap` (null while live).
- **Cached in Redis** 10–15s, keyed `ext:pulse:{login}` (§9). Collapses many pollers into one compute.
- 404 if non-channel; `tracking:false` + warming state if `< 5` completed rollups (R8.2).

### 6.2 Health — `GET /v1/extension/health`
`{ ok, version, time }`. Used by the worker to validate the configured backend URL and drive the "Can't reach Streamclone" state (R8.1).

### 6.3 Bookmarks — R10
| Method | Path | Body / Query | Notes |
|| Concern | Local dev opt-in | Hosted (default) |\r\n|---------|-------------|--------|\r\n| Backend URL | http://localhost:8081 � streampulse-backend compose (mixed-content **exempt** for localhost) ||------|| Concern | Local dev opt-in | Hosted (default) |\r\n|---------|-------------|--------|\r\n| Backend URL | http://localhost:8081 � streampulse-backend compose (mixed-content **exempt** for localhost) |-|-------|
| GET | `/v1/pulse/bookmarks` | `?login=&streamId=&vodId=&limit=50&cursor=` | Cursor pagination on `created_at`. User-scoped when hosted. |
| POST | `/v1/pulse/bookmarks` | `{streamId,vodId,offsetSeconds,label,notes,score,source}` | Returns created record w/ `id`. Server stamps `created_at`. |
| PATCH | `/v1/pulse/bookmarks/{id}` | `{label?,notes?}` | 404 if not owner. |
| DELETE | `/v1/pulse/bookmarks/{id}` | — | Idempotent 204. |

### 6.4 Recap — `GET /v1/pulse/streams/{streamID}/recap` — R12
Returns cached payload (top 10 moments, top emotes, biggest chat spike, funniest burst, clip candidates, totals, peak chat/min). 425/“not ready” shape while a stream is still live; compute-on-miss after end.

### 6.5 Later (hosted)
`POST /v1/extension/auth/device`, `GET /v1/extension/me`, `GET /v1/extension/channels/{login}/last-stream`.

---

## 7. Scaling on hosted production — what else is needed

Today **hosted-production-vps** runs the hosted compose stack (streampulse-backend images): Caddy (internal port behind Cloudflare Tunnel at `api.streampulse.stream`), `analytics` (API) + `analytics-workers` (IRC/rollups/scoring), `postgres`, `redis`, `scraper`, `metadata`, `video`, `emote`. Operator deploy and env live in private **streampulse-ops**. The extension default is already hosted — `https://api.streampulse.stream`. Local dev uses `http://localhost:8081` (streampulse-backend compose). To go **fully public / multi-tenant**, in priority order:

1. **TLS + domain — already done.** `api.streampulse.stream` terminates HTTPS at Cloudflare (Tunnel → internal Caddy). Chrome allows the extension's fetches. *(This requirement was the pre-cutover blocker; it is now resolved.)*
2. **BFF read caching (cheap, high-leverage).** Redis-cache the BFF payload 10–15s per login so 1,000 viewers of one channel = 1 compute every 15s, not 1,000. Already designed into §6.1.
3. **Shared tracking pool / fan-out caps.** "Who can track what" (R9.2): a channel tracked by many users must map to **one** IRC join + rollup pipeline, not one per user. Add a tracked-channel registry with refcounts + a global cap and an LRU eviction for idle channels. Protects `analytics-workers` and the scraper from a thundering herd.
4. **Rate limiting / abuse.** Per-IP and per-device-token limits at Caddy (`rate_limit`) or a Redis token bucket in the BFF. Cap `watch` requests hardest (they create load).
5. **Connection pooling.** pgbouncer in front of Postgres once concurrent pollers climb; tune `analytics` DB pool. Redis is already shared.
6. **Horizontal headroom.** The read path (BFF) is stateless + cache-backed → can run N `analytics` API replicas behind Caddy. Keep `analytics-workers` (collector) singletonish per channel (the tracking pool enforces this). This is the natural split the prod overlay already started (`analytics` vs `analytics-workers`).
7. **Observability.** Reuse the `pulse` profile (Prometheus/Grafana). Add: BFF cache hit ratio, poll RPS, tracked-channel count, `watch` rate, p95 BFF latency, IRC join count. Alert on tracked-channel cap and scraper saturation.
8. **Data growth.** Bookmarks are tiny. Rollups already exist. Recap cache is one row/stream. Add a retention/janitor job only if bookmark volume ever warrants it.
9. **Managed dependencies (when one VPS isn't enough).** Move Postgres to managed/replica, Redis to managed, put a real LB in front. Not MVP; note the path so the single-VPS design doesn't paint us into a corner.

**Summary:** hosted default is live — extension points at `https://api.streampulse.stream`. Local dev opt-in is `http://localhost:8081` (streampulse-backend compose). Full public / multi-tenant needs, minimally, **BFF cache + shared tracking pool + rate limits + device auth**; everything else is incremental.

---

## 8. Edge cases & error handling

| Case | Behavior |
|------|| Concern | Local dev opt-in | Hosted (default) |\r\n|---------|-------------|--------|\r\n| Backend URL | http://localhost:8081 � streampulse-backend compose (mixed-content **exempt** for localhost) |--|
| Twitch SPA navigation (no reload) | Re-detect debounced; update overlay in place; never double-mount (R1.1/R1.4). |
| Twitch DOM/class changes | Resilient selectors + fallback dock; overlay degrades to a floating panel rather than crashing. |
| Backend down / wrong URL | Health probe fails → actionable "Can't reach StreamPulse at <url>" with Retry + Open settings (R8.1). Never zeroed charts. |
| `< 5` completed rollups | Warming state with progress, not an empty Top Moments shown as final (R8.2). |
| Live seek outside DVR buffer | `Replay after VOD` / `Open in Streamclone`; never promise "jump anywhere live" (R7.3/R7.4). |
| VOD not yet resolved | Bookmark/peak keeps `offsetSeconds`; jump resolves once `vodId` exists (R10.5). |
| Optional lane unavailable (viewers/keywords) | Lane hidden, not zero-filled (R11.2). |
| Service worker eviction (MV3) | Re-hydrate poll state + cache from `chrome.storage` on cold start (R5.3). |
| Duplicate `watch` from many tabs/users | Worker de-dupes per login+TTL; backend tracking pool refcounts (R2.2, §7.3). |
| Mixed content (hosted http) | Worker validates backend URL is `https` (or localhost) and surfaces a config error instead of silent fetch failure. |
| CORS preflight | Handled by `httpx.CORS` (204 on OPTIONS). |
| Stream ends mid-session | Swap to recap header; fetch `/recap`; allow Save Moment on recap rows (R12). |

---

## 9. Performance notes

- **Polling, not streaming, in MVP.** 30s default (= `LIVE_HEAT_REFRESH_MS`) with jitter to avoid thundering herd; configurable 15/30/60s (R6.2). WebSockets are a later optimization, not needed for minute-granularity data.
- **Read amplification control.** BFF Redis cache (10–15s TTL keyed by login) is the single most important perf lever — it decouples viewer count from backend compute.
- **Payload size.** Cap `rollups`/`lanes` to a rolling window (e.g. last 60 completed minutes) so the payload stays a few KB; peaks ≤ 10 (existing gating).
- **Lanes are precomputed server-side** (normalized 0–100) so the extension does zero scoring math (R11.3) — keeps the content script light and parity guaranteed.
- **Render cost.** Shadow DOM + a compact sparkline lane set; mini mode renders only the composite lane (R11.5). Avoid re-render on every poll — diff by `currentOffsetSeconds`.
- **Cold cache:** BFF compute-on-miss must stay < ~150ms p95 (rollups+peaks are already cached by `heatmap.Cache`); recap compute-on-miss is bounded by one stream's rollups and is cached after first build.

---

## 10. Open decisions (resolve during P0)

- Package registry: GitHub Packages (private) vs public npm. Default: GitHub Packages.
- `pulse-ui` extraction timing: after `pulse-core` proves out (P3), or inline in the extension first.
- Device-token storage rotation policy (hosted only).
- Whether recap cache (000039) ships in MVP or recap computes on-demand first. Default: on-demand first, add cache when read volume warrants.

