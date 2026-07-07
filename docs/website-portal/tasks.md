# StreamPulse — Public Website & Portal Implementation Tasks

> Ordered, checkable implementation plan derived from [`design.md`](./design.md). The design is the source of truth; this document converts it into concrete tasks with files, touch points, acceptance criteria, and tests. Do not re-decide architecture here.

## 1. Overview

This plan builds **StreamPulse**, the public website and user portal for the Streamclone Pulse Chrome extension, at `streampulse.stream` (hosted API `https://api.streampulse.stream`).

- **P0 — Infrastructure & backend readiness:** Cloudflare DNS/Tunnel/Pages, hosted-mode env, beta-key gating, public stats/status endpoints, rate limits, tracking-pool caps, `pulse_watchlist` migration, principal scoping.
- **P1 — Web app skeleton & marketing site:** Vite + React app, routing, theme, landing/setup/docs/status/login, `apiClient`, beta-key storage, health check, copy-config.
- **P2 — Dashboard core:** shell + guards, home, watchlist, channel, single stream, saved moments, past streams, connection, account, coverage + load-missed-moments + backfill stepper.
- **P3 — Admin/operator console:** Cloudflare Access, health/registry/jobs/abuse cards, evict/cancel/revoke.
- **V2 / V3 — Deferred:** device auth, D1 user state, clip queue, share pages, accounts, billing, Twitch Extension, scale.

Tasks are **ordered** and can be checked off. Each has an ID, area, priority, dependencies, files, notes, acceptance criteria, and tests. Follow IDs in dependency order; the recommended starting batch is in the final section.

Naming: **Streamclone** = backend engine · **Streamclone Pulse** = extension · **StreamPulse** = this website · Hosted API = `https://api.streampulse.stream`.

## 2. Status legend

| Status | Meaning |
|--------|---------|
| `pending` | Not started. |
| `in_progress` | Actively being worked. |
| `blocked` | Waiting on a dependency or external decision. |
| `done` | Complete and verified against acceptance criteria. |

Checkbox `- [ ]` = pending/in progress/blocked · `- [x]` = done. Annotate `blocked` with the blocking TASK-ID.

---

## 3. Phase P0 — Infrastructure and backend readiness

- [ ] INFRA-001: Cloudflare DNS + Tunnel for `api.streampulse.stream`
  - Area: infra
  - Priority: P0
  - Depends on: none
  - Files likely touched:
    - `deploy/cloudflared/config.yml` (from `config.yml.example`)
    - `deploy/Caddyfile.pulse-api` / `deploy/Caddyfile.bearhost`
    - `docs/pulse-extension/bearhost-tunnel.md`
  - Implementation notes:
    - Create the tunnel on **streampulse-vps** (`cloudflared`); route `api.streampulse.stream` → internal Caddy `:8090`. Operator runbook: private **streampulse-ops**.
    - Legacy filenames (`deploy/Caddyfile.bearhost`, `docs/pulse-extension/bearhost-tunnel.md`) are rollback references only.
    - No public open ports on the VPS; tunnel is outbound only.
    - TLS terminates at Cloudflare; Caddy serves plain HTTP internally to the tunnel.
  - Acceptance criteria:
    - `curl https://api.streampulse.stream/v1/extension/health` returns `{ok:true,...}` over Cloudflare with no direct VPS port exposed.
  - Tests:
    - manual: health curl from outside the VPS; confirm VPS firewall has no inbound API port open.

- [ ] INFRA-002: Cloudflare Pages project for `streampulse.stream`
  - Area: infra
  - Priority: P0
  - Depends on: WEB-001 (build output exists)
  - Files likely touched:
    - `streampulse-web/` (build output `dist/`)
    - Pages project config (Cloudflare dashboard / `wrangler.toml` if used)
  - Implementation notes:
    - Connect repo/CI to Pages; build command `npm run build`, output `dist/`.
    - SPA fallback: serve `index.html` for unknown dashboard routes (`/dashboard/*`), keep prerendered public routes static.
    - Set `VITE_BACKEND_URL=https://api.streampulse.stream` for production build.
  - Acceptance criteria:
    - Pushing to main deploys `streampulse.stream`; landing renders; `/dashboard/x` deep link does not 404.
  - Tests:
    - manual: visit landing + a deep dashboard route after deploy.

- [x] INFRA-003: Hosted-mode environment variables
  - Area: infra
  - Priority: P0
  - Depends on: INFRA-001
  - Files likely touched:
    - `deploy/env/profile-bearhost-pulse.env` (legacy example only)
    - `streampulse-ops/env/production.local.env` (authoritative production — private repo)
    - `.env.example`
  - Implementation notes:
    - Define: `PULSE_HOSTED_MODE=true`, `PULSE_BETA_KEYS=...`, `PULSE_MAX_ACTIVE_CHANNELS`, `PULSE_MAX_BACKFILLS`, `PULSE_MAX_CHANNELS_PER_PRINCIPAL`, `PULSE_WATCH_RATE_PER_MIN`, `PULSE_BACKFILL_RATE_PER_HOUR`, `SEVENTV_EVENTAPI_ENABLED=true`, `STREAMCLONE_VERSION`.
    - Document each in `.env.example` (values redacted); never commit real beta keys.
  - Acceptance criteria:
    - Backend boots in hosted mode reading all vars; missing keys log a clear warning.
  - Tests:
    - manual: `make validate-env`; boot with profile; confirm gating active.

- [x] API-001: Validate beta-key gating on extension endpoints
  - Area: backend
  - Priority: P0
  - Depends on: INFRA-003
  - Files likely touched:
    - `internal/analytics/pulse_hosted.go`
    - `internal/analytics/extension_api.go`
  - Implementation notes:
    - Confirm `BetaKeyRequired()` gates `/v1/extension/pulse/*` group when `PULSE_HOSTED_MODE=true` + keys set.
    - Ensure `POST /v1/analytics/channels/{login}/watch` is also gated in hosted mode (see API-006).
    - 401 returns `{error:"unauthorized", hint:"Set X-Streamclone-Beta-Key header (Pulse extension options)"}`.
  - Acceptance criteria:
    - Request without/with-bad key → 401 + hint; valid key → 200.
  - Tests:
    - backend: table test for `authorized()` (valid/invalid/missing); handler 401 shape.

- [ ] API-002: `GET /v1/public/stats` aggregate endpoint
  - Area: backend
  - Priority: P0
  - Depends on: none
  - Files likely touched:
    - `internal/analytics/api.go` (route registration)
    - `internal/analytics/pulse_hosted.go` or new `public_api.go`
  - Implementation notes:
    - Return `{streamsTracked, momentsDetected, chatMessagesProcessed, emotesIndexed, vodsAnalyzed, updatedAt}`.
    - Precompute via periodic job → cache in Redis `sp:public:stats` (TTL ≥ 60s); endpoint serves cache.
    - Aggregate-only, NO PII, no per-channel/per-principal data. Unauthenticated (public).
  - Acceptance criteria:
    - Returns cached aggregates; second call within TTL hits cache; payload contains no logins/ids.
  - Tests:
    - backend: response shape; assert no PII fields; cache hit path.

- [ ] API-003: `GET /v1/public/status` endpoint
  - Area: backend
  - Priority: P0
  - Depends on: none
  - Files likely touched:
    - `internal/analytics/public_api.go`
    - `internal/analytics/api.go`
  - Implementation notes:
    - Return `{status, api, degraded, incident, updatedAt}` — high-level only.
    - Must NOT expose queue sizes, tracked-channel counts, error rates, or anything revealing capacity/abuse surface.
  - Acceptance criteria:
    - Returns operational/degraded summary; no internals present.
  - Tests:
    - backend: assert absence of internal fields; degraded toggle path.

- [ ] API-004: Public route registration unauthenticated
  - Area: backend
  - Priority: P0
  - Depends on: API-002, API-003
  - Files likely touched:
    - `internal/analytics/api.go`
    - `internal/httpx/cors.go`
  - Implementation notes:
    - Register `/v1/public/*` OUTSIDE the beta-key middleware group.
    - CORS allows the site origin (header-based auth elsewhere keeps `*` valid).
  - Acceptance criteria:
    - `/v1/public/*` reachable without a beta key; gated routes still require one.
  - Tests:
    - backend: public routes 200 without key; gated routes 401 without key.

- [ ] SECURITY-001: Rate limits for `/watch` and `/backfill`
  - Area: security
  - Priority: P0
  - Depends on: API-001
  - Files likely touched:
    - `internal/analytics/pulse_hosted.go` (or new `pulse_ratelimit.go`)
    - `internal/analytics/extension_api.go`
    - `internal/analytics/pulse_backfill.go`
  - Implementation notes:
    - Redis token buckets per principal: `sp:rl:watch:{principalId}` (`PULSE_WATCH_RATE_PER_MIN`), `sp:rl:backfill:{principalId}` (`PULSE_BACKFILL_RATE_PER_HOUR`).
    - `principalId = sha256(betaKey)` server-side; fall back to IP when no key (but `/watch` requires key, see API-006).
    - Exceed → HTTP 429 with retry hint. Cloudflare per-IP limit is the edge backstop.
  - Acceptance criteria:
    - Bursting `/watch`/`/backfill` beyond cap returns 429; normal use unaffected.
  - Tests:
    - backend: bucket exhaustion → 429; refill after window.

- [ ] WATCH-001: Tracking pool caps and idle eviction
  - Area: backend
  - Priority: P0
  - Depends on: none
  - Files likely touched:
    - `internal/analytics/collector.go`
    - `internal/analytics/extension_api.go` (refcount on poll/watch)
  - Implementation notes:
    - One shared IRC session + one rollup pipeline per channel; refcount per principal; `lastViewedAt` on poll.
    - Global cap `PULSE_MAX_ACTIVE_CHANNELS`; evict when `refcount==0 && !alwaysTrack && idle>IDLE_TTL`.
    - Backpressure order: protect always-track, then live+viewed, then recently viewed; evict idle/offline first.
  - Acceptance criteria:
    - N principals tracking one channel → exactly one IRC join; idle untracked channels evicted; cap enforced.
  - Tests:
    - backend: refcount add/remove; eviction respects always-track; cap rejects beyond limit.

- [ ] API-005: Postgres migration `pulse_watchlist`
  - Area: backend
  - Priority: P0
  - Depends on: none
  - Files likely touched:
    - `migrations/000040_pulse_watchlist.up.sql`
    - `migrations/000040_pulse_watchlist.down.sql`
  - Implementation notes:
    - Columns: `id` (ULID), `principal_id`, `principal_kind` (`beta|device|user` default `beta`), `login`, `always_track` bool, `created_at`, `updated_at`; `UNIQUE(principal_id, login)`.
    - Indexes: `(principal_id, created_at DESC)`, partial `WHERE always_track`.
    - Forward-only; never edit applied migrations.
  - Acceptance criteria:
    - Migration applies cleanly up/down on a fresh DB; constraints enforced.
  - Tests:
    - backend: migration up/down in CI; unique violation on duplicate `(principal_id, login)`.

- [ ] WATCH-002: Watchlist CRUD API `/v1/pulse/watchlist`
  - Area: backend
  - Priority: P0
  - Depends on: API-005, API-001
  - Files likely touched:
    - `internal/analytics/pulse_watchlist.go` (new)
    - `internal/analytics/api.go`
  - Implementation notes:
    - `GET` (list for principal), `POST {login, alwaysTrack}` (validate login exists; enforce `PULSE_MAX_CHANNELS_PER_PRINCIPAL`), `DELETE /{login}`.
    - Stamp `principal_id = sha256(betaKey)` server-side from the header; never trust a client-sent principal.
    - `alwaysTrack=true` enqueues a shared `watch` (subject to SECURITY-001 + WATCH-001).
  - Acceptance criteria:
    - CRUD scoped to principal; cap enforced (cap reached → 409/422); add of unknown login rejected.
  - Tests:
    - backend: CRUD happy path; principal isolation (A cannot see B); cap rejection.

- [ ] API-006: Gate and principal-scope `/watch` + bookmarks
  - Area: backend / security
  - Priority: P0
  - Depends on: API-001, API-005
  - Files likely touched:
    - `internal/analytics/extension_api.go`
    - `internal/analytics/bookmarks.go`
  - Implementation notes:
    - In hosted mode `POST /v1/analytics/channels/{login}/watch` requires a valid beta key (no unauthenticated public watch).
    - Add `principal_id`/`principal_kind` to `pulse_bookmarks` (nullable local, set hosted); scope bookmark queries by principal.
    - Bookmarks remain Postgres-only (no D1).
  - Acceptance criteria:
    - `/watch` 401 without key; bookmarks list returns only the principal's rows in hosted mode.
  - Tests:
    - backend: `/watch` unauthenticated → 401; bookmark principal isolation.

- [ ] INFRA-004: Admin/Grafana private access decision
  - Area: infra / security
  - Priority: P0
  - Depends on: INFRA-001
  - Files likely touched:
    - `deploy/Caddyfile.bearhost` (legacy rollback filename)
    - `deploy/cloudflared/config.yml`
    - `docs/website-portal/design.md` (reference)
  - Implementation notes:
    - Put `/v1/admin/*` and `grafana.streampulse.stream` behind Cloudflare Access (operator identity); never public, never indexed.
    - Do not embed public Grafana anywhere in the site.
  - Acceptance criteria:
    - Anonymous request to admin/grafana hostnames is blocked by Access before reaching the app.
  - Tests:
    - security: anonymous admin/grafana → 403/redirect to Access; no app response leaks.

---

## 4. Phase P1 — Web app skeleton and marketing site

- [x] WEB-001: Scaffold Vite + React + TypeScript app
  - Area: frontend
  - Priority: P1
  - Depends on: none
  - Files likely touched:
    - `streampulse-web/package.json`
    - `streampulse-web/vite.config.ts`
    - `streampulse-web/tsconfig.json`
    - `streampulse-web/index.html`
    - `streampulse-web/src/main.tsx`
  - Implementation notes:
    - Vite + React + TS; add `@streamclone/pulse-core` (and later `pulse-ui`) as deps for shared types/format/coverage helpers.
    - `vite.config.ts`: env `VITE_BACKEND_URL`; prerender plugin for public routes (P1 landing critical path needs no live API).
    - Add `react-router` and `@tanstack/react-query`.
  - Acceptance criteria:
    - `npm run dev` serves a blank routed app; `npm run build` emits static `dist/`.
  - Tests:
    - tests: `npm run typecheck` passes; build succeeds in CI.

- [x] WEB-002: Routing + chunk split
  - Area: frontend
  - Priority: P1
  - Depends on: WEB-001
  - Files likely touched:
    - `streampulse-web/src/main.tsx`
    - `streampulse-web/src/routes/index.tsx`
  - Implementation notes:
    - Routes: `/`, `/setup`, `/docs`, `/docs/*`, `/status`, `/login` (public, prerendered); `/dashboard/*` (lazy chunk); `/admin/*` (lazy chunk).
    - Public routes prerendered; dashboard/admin are SPA, code-split.
  - Acceptance criteria:
    - Each route resolves; dashboard/admin load as separate chunks; public routes are static HTML.
  - Tests:
    - tests: route smoke test renders each top route.

- [x] WEB-003: Design tokens / theme
  - Area: frontend
  - Priority: P1
  - Depends on: WEB-001
  - Files likely touched:
    - `streampulse-web/src/ui/theme.ts`
    - `streampulse-web/src/ui/global.css`
  - Implementation notes:
    - Mirror the extension `src/ui/theme.ts`: near-black surfaces, violet primary, heatmap ramp (`#4c1d95→#a855f7→#f97316→#fbbf24`).
    - Orange/yellow reserved for intensity/peak/LIVE only — never generic buttons.
    - Respect `prefers-reduced-motion`.
  - Acceptance criteria:
    - Token set exported and applied; visual parity with extension dark theme.
  - Tests:
    - manual: visual check; tests: token export snapshot.

- [x] WEB-004: `apiClient` with beta key, 401, retry, error normalization
  - Area: frontend
  - Priority: P1
  - Depends on: WEB-001, AUTH-001
  - Files likely touched:
    - `streampulse-web/src/lib/apiClient.ts`
    - `streampulse-web/src/lib/queryKeys.ts`
  - Implementation notes:
    - Base = `VITE_BACKEND_URL` (runtime override allowed for local dev).
    - Inject `X-Streamclone-Beta-Key` on gated calls; 8s timeout; 1 retry w/ jitter on network/5xx only (never 4xx).
    - 401 → emit `auth:rejected`. Normalize errors → `{kind:'unreachable'|'unauthorized'|'rate_limited'|'server'|'bad_request', message, hint?}`.
    - Parse `X-Cache` for observability. Enforce polling discipline via query keys/`staleTime` (live ≥30s; full timeline manual).
  - Acceptance criteria:
    - Gated calls carry the key; 401 routes to login; 429 surfaces rate_limited; network error surfaces unreachable.
  - Tests:
    - unit: error normalization for 401/429/500/timeout; retry only on 5xx/network; header injection.

- [x] AUTH-001: Beta-key storage + `principalId` + guards
  - Area: frontend / security
  - Priority: P1
  - Depends on: WEB-001
  - Files likely touched:
    - `streampulse-web/src/lib/auth.ts`
    - `streampulse-web/src/routes/guards.tsx`
  - Implementation notes:
    - Store key in `localStorage` `sp.betaKey` (not a cookie). `principalId = hash16(sha256(betaKey))` for local cache keys/UI only; server is the authority.
    - `currentPrincipal(): {id, kind:'beta'} | null`. Route guard redirects unauthenticated dashboard access to `/login`.
    - Mask key in UI; strict CSP forbids 3rd-party scripts (set in `index.html`/headers).
  - Acceptance criteria:
    - Key persists; guard blocks `/dashboard/*` without key; `principalId` stable for a given key.
  - Tests:
    - unit: principalId determinism; guard redirect; storage get/set/clear.

- [ ] WEB-005: Landing page sections
  - Area: frontend
  - Priority: P1
  - Depends on: WEB-002, WEB-003
  - Files likely touched:
    - `streampulse-web/src/routes/public/Landing.tsx`
    - `streampulse-web/src/ui/components/landing/*` (TopNav, Hero, ProductMockup, HowItWorks, StatsBand, FeatureCards, AudienceTiles, Resources, Footer)
  - Implementation notes:
    - Sections: TopNav, Hero (headline "Never miss the moment that mattered." + 3 CTAs), ProductMockup (static high-fidelity image, no live embed), HowItWorks (4 steps), StatsBand, FeatureCards (6), AudienceTiles (4), Resources (5 links), FooterCTA + Footer.
    - All copy per PRD §5; landing must not depend on live API for first paint.
  - Acceptance criteria:
    - Renders responsive 360–1440px with no layout shift; CTAs route to `/setup`, `/dashboard`, `/login`.
  - Tests:
    - tests: section render; e2e: CTA routing (TEST-010); perf (TEST-011).

- [ ] WEB-006: StatsBand wired to `/v1/public/stats`
  - Area: frontend
  - Priority: P1
  - Depends on: WEB-005, WEB-004, API-002
  - Files likely touched:
    - `streampulse-web/src/ui/components/landing/StatsBand.tsx`
  - Implementation notes:
    - Lazy fetch after first paint (off critical path); count-up on scroll; "updated <relative>".
    - On error → hide the band entirely (never zeros). Approximate formatting ("4.2M+").
  - Acceptance criteria:
    - Shows 5 counters from the endpoint; hides gracefully on failure; no CLS on the hero.
  - Tests:
    - unit: hide-on-error; integration: renders counts from mocked endpoint.

- [x] WEB-007: `/setup` install & connect page
  - Area: frontend
  - Priority: P1
  - Depends on: WEB-004, WEB-008
  - Files likely touched:
    - `streampulse-web/src/routes/public/Setup.tsx`
    - `streampulse-web/src/ui/components/setup/*`
  - Implementation notes:
    - Steps: Install (detect extension), Connect (backend URL + Copy-config + beta-key field), Verify (health check), Track.
    - Troubleshooting states: `not_installed`, `unreachable`, `unauthorized`, `mixed_content`, `version_mismatch`, `connected` (copy per PRD §7.3).
  - Acceptance criteria:
    - Renders all steps; health check + troubleshooting states display correct copy/actions.
  - Tests:
    - integration: health states; e2e first-run setup (TEST-009).

- [x] WEB-008: Health check + copy-config flow
  - Area: frontend
  - Priority: P1
  - Depends on: WEB-004
  - Files likely touched:
    - `streampulse-web/src/lib/health.ts`
    - `streampulse-web/src/ui/components/setup/CopyConfig.tsx`
  - Implementation notes:
    - `GET /v1/extension/health` → show ok/version/latency.
    - Copy-config copies `{backendUrl, betaKey, pollIntervalMs}` JSON matching the extension options schema.
    - Mixed-content guard: warn if backend URL is non-https and non-localhost.
  - Acceptance criteria:
    - Health shows version + round-trip ms; Copy-config writes valid JSON to clipboard.
  - Tests:
    - unit: config payload shape; integration: health ok/unreachable.

- [x] WEB-009: `/login` beta-key page
  - Area: frontend
  - Priority: P1
  - Depends on: AUTH-001, WEB-004
  - Files likely touched:
    - `streampulse-web/src/routes/public/Login.tsx`
  - Implementation notes:
    - Capture beta key, store, derive principal, redirect `/dashboard`.
    - Validate lazily on first gated dashboard call; surface 401 `hint` verbatim. "Request access" link to GitHub/Discord.
  - Acceptance criteria:
    - Valid key → dashboard; invalid → inline 401 message; no empty-dashboard flash.
  - Tests:
    - integration: 401 flow (TEST-008); e2e login → dashboard.

- [ ] WEB-010: `/docs` shell + `/status` page
  - Area: frontend / docs
  - Priority: P1
  - Depends on: WEB-002, WEB-004, API-003
  - Files likely touched:
    - `streampulse-web/src/routes/public/Docs.tsx`
    - `streampulse-web/src/routes/public/Status.tsx`
  - Implementation notes:
    - Docs: static index + article shell (setup, API, privacy). Status: shell static, data client-side from `/v1/public/status`.
    - Status shows operational/degraded/incident only; no internals; "Status temporarily unavailable" on error.
  - Acceptance criteria:
    - Docs index renders; Status reflects endpoint with no internal fields shown.
  - Tests:
    - integration: status render + error fallback.

- [ ] WEB-011: Motion and instrumentation interaction system
  - Area: frontend / design
  - Priority: P1
  - Depends on: WEB-003, WEB-005
  - Files likely touched:
    - `streampulse-web/src/ui/motion.ts`
    - `streampulse-web/src/ui/global.css`
    - `streampulse-web/src/ui/components/landing/ProductMockup.tsx`
    - `streampulse-web/src/ui/components/CoverageCard.tsx`
    - `streampulse-web/src/ui/components/BackfillStepper.tsx`
  - Implementation notes:
    - Add motion tokens for duration/easing.
    - Add only functional/data-state animations: hero pulse rail, product mockup live tick, stats count-up, moment-detected pulse, coverage/backfill shimmer, current-stream mini heat strip, emote-lane toggle.
    - Respect `prefers-reduced-motion`.
    - No particles, random blobs, scroll-jacking, fake progress, or excessive glowing borders.
  - Acceptance criteria:
    - Motion reinforces live data, system state, or user action.
    - Reduced-motion users see static equivalents.
    - No animation is required for understanding the page.
  - Tests:
    - unit/manual: reduced-motion fallback; visual review: no infinite decorative animation except subtle live indicators.

---

## 5. Phase P2 — Dashboard core

- [ ] DASH-001: Dashboard shell, layout, route guards
  - Area: frontend
  - Priority: P2
  - Depends on: AUTH-001, WEB-002
  - Files likely touched:
    - `streampulse-web/src/routes/dashboard/DashboardShell.tsx`
    - `streampulse-web/src/routes/guards.tsx`
  - Implementation notes:
    - Shell: nav, principal context provider, content outlet. Guard wraps all `/dashboard/*`; unauthenticated → `/login`.
    - `auth:rejected` event from apiClient clears cache + routes to login.
  - Acceptance criteria:
    - Authenticated user sees shell; unauthenticated redirected; mid-session 401 routes out cleanly.
  - Tests:
    - unit: guard behavior; integration: 401 mid-session.

- [ ] DASH-002: Connection status badge
  - Area: frontend
  - Priority: P2
  - Depends on: DASH-001, WEB-008
  - Files likely touched:
    - `streampulse-web/src/ui/components/ConnectionStatusBadge.tsx`
  - Implementation notes:
    - Poll health + reflect beta-key validity: states reachable / unreachable / unauthorized / degraded.
  - Acceptance criteria:
    - Badge reflects live backend reachability and key validity.
  - Tests:
    - unit: state derivation from health + 401.

- [ ] DASH-003: Status badge derivation helper
  - Area: frontend
  - Priority: P2
  - Depends on: WEB-004
  - Files likely touched:
    - `streampulse-web/src/lib/statusBadge.ts`
  - Implementation notes:
    - Derive `LIVE | Offline | Warming | Synced | Partial | Not tracked` from pulse payload (`isLive`, `tracking`, completed rollups <5, `coverage.state`). No client scoring.
  - Acceptance criteria:
    - Each badge maps to the correct payload condition (design §10.4).
  - Tests:
    - unit: TEST-004 covers all six conditions.

- [ ] DASH-004: Dashboard home
  - Area: frontend
  - Priority: P2
  - Depends on: DASH-001, DASH-003, WATCH-003, MOMENT-001
  - Files likely touched:
    - `streampulse-web/src/routes/dashboard/Home.tsx`
    - `streampulse-web/src/ui/components/LiveNowBand.tsx`
  - Implementation notes:
    - LiveNowBand (CurrentStreamCard[]), WatchlistPanel, RecentStreamsPanel (ended only), SavedMomentsPanel (latest).
    - Per-channel pulse fetched recent-window, staggered; never `window=full` on load.
  - Acceptance criteria:
    - Live channels appear only in LiveNowBand; ended never in live band; empty state guides to add a channel.
  - Tests:
    - integration: live/ended separation; empty state.

- [ ] WATCH-003: Watchlist page
  - Area: frontend
  - Priority: P2
  - Depends on: DASH-001, WATCH-002, DASH-003
  - Files likely touched:
    - `streampulse-web/src/routes/dashboard/Watchlist.tsx`
    - `streampulse-web/src/ui/components/WatchlistTable.tsx`
  - Implementation notes:
    - Add channel (validates login), always-track toggle (enqueues shared watch), remove, status badges.
    - Cap reached → disable add + "Channel limit reached (N)".
  - Acceptance criteria:
    - CRUD against `/v1/pulse/watchlist`; status badges correct; cap enforced in UI.
  - Tests:
    - integration: add/remove + cap (TEST-007).

- [ ] DASH-005: Channel page
  - Area: frontend
  - Priority: P2
  - Depends on: DASH-003, MOMENT-002, BACKFILL-001, DASH-007
  - Files likely touched:
    - `streampulse-web/src/routes/dashboard/Channel.tsx`
  - Implementation notes:
    - CurrentStreamCard (live only), CoverageCard (+Load missed), MostReactedSection (peaks), EmoteLanes, PastStreamsSection (collapsible 3+View all), header Open Twitch / Open analytics.
    - Recent-window fetch; `window=full` only via explicit "Load full timeline".
  - Acceptance criteria:
    - Live and past correctly separated; coverage CTA only when partial + VOD; no full fetch on poll.
  - Tests:
    - integration: partial coverage + backfill (TEST-009); e2e offline channel.

- [ ] DASH-006: Single stream page (Analytics level, Layer 2)
  - Area: frontend
  - Priority: P2
  - Depends on: DASH-005, MOMENT-002, ANALYTICS-001, ANALYTICS-002, ANALYTICS-003, API-007
  - Files likely touched:
    - `streampulse-web/src/routes/dashboard/Stream.tsx`
  - Implementation notes:
    - Full Analytics level (design §13A). Compose: FullHeatmap, MomentsList (jump/save), EmoteSpikeInspector, GameSegments (ANALYTICS-004), CoverageBlock + SourceBadges (ANALYTICS-001) + AnalyticsQuality (ANALYTICS-002), RecapBlock, SyncStatus + Advanced drawer (ANALYTICS-003/005), saved moments for this stream.
    - **Prefer portal-safe endpoints** (`/v1/portal/analytics/streams/{id}[/summary|/sync/status]`, API-007) over raw `/v1/analytics/*`; fall back to raw only in operator context. **Layer 2 fetched only on explicit navigation here** (never on poll): plus `.../replay-heatmap`, `.../games`, `GET /v1/pulse/streams/{id}/recap`. react-query `staleTime: Infinity` + invalidate after sync CTAs.
    - Sync CTAs map to backend modes (ANALYTICS-006).
  - Acceptance criteria:
    - Layer 2 calls issued only on stream-page nav (not polling); uses portal-safe endpoints by default; heatmap + summary + games + recap render; source badges + quality + sync status shown; raw diagnostics only in Advanced drawer.
  - Tests:
    - integration: Layer 2 fetch only here (TEST-012 extends); portal-safe path used; recap present for ended; e2e Advanced drawer reveals sanitized status only.

- [ ] DASH-007: Current stream card + past-streams ended-only list + sync badges
  - Area: frontend
  - Priority: P2
  - Depends on: DASH-003
  - Files likely touched:
    - `streampulse-web/src/ui/components/CurrentStreamCard.tsx`
    - `streampulse-web/src/ui/components/PastStreamsSection.tsx`
  - Implementation notes:
    - CurrentStreamCard live-only (LIVE badge, coverage chip, mini heat). PastStreamsSection lists ENDED VODs only; sync badges `No pulse | Stats only | Chat synced | Full pulse`; collapsible 3 rows default.
    - A live stream is never in the past list; an ended stream never shown as current.
  - Acceptance criteria:
    - Mirrors extension hierarchy; sync badges derived from payload.
  - Tests:
    - unit: live exclusion from past list; badge derivation.

- [ ] MOMENT-002: Most Reacted / peaks rendering (backend peaks only)
  - Area: frontend
  - Priority: P2
  - Depends on: WEB-004
  - Files likely touched:
    - `streampulse-web/src/ui/components/MostReactedSection.tsx`
    - `streampulse-web/src/ui/components/SelectedMomentCard.tsx`
  - Implementation notes:
    - Use `payload.peaks` via `pulse-core` adapter; `peaks===[]` → Warming (never invent moments); `peaks===undefined` (legacy) → estimated fallback only.
    - Title "Most Reacted So Far" live, "Stream Recap" ended. No client scoring.
  - Acceptance criteria:
    - Real backend scores shown; empty peaks → Warming; estimated only when field absent.
  - Tests:
    - unit: three peaks paths (present/empty/undefined).

- [ ] DASH-008: Emote lanes / heatmap display
  - Area: frontend
  - Priority: P2
  - Depends on: WEB-004
  - Files likely touched:
    - `streampulse-web/src/ui/components/EmoteLanes.tsx`
    - `streampulse-web/src/ui/components/HeatmapLane.tsx`
  - Implementation notes:
    - Render lanes from BFF `lanes` (normalized 0–100, server-side); optional viewers/keywords lanes hidden when absent (never zero-filled).
    - Reuse `pulse-ui` `MiniHeatmapLane`/`SignalLanes` where possible.
  - Acceptance criteria:
    - Composite/chat/7TV lanes render aligned; optional lanes hidden when unavailable.
  - Tests:
    - unit: optional lane hidden when missing.

- [ ] ANALYTICS-001: Data-source badges
  - Area: frontend
  - Priority: P2
  - Depends on: DASH-003
  - Files likely touched:
    - `streampulse-web/src/lib/sourceBadge.ts`
    - `streampulse-web/src/ui/components/SourceBadges.tsx`
  - Implementation notes:
    - Map backend `viewerSource` (`live|tt|merged|restored|unknown`, see `session.go`) → `Live samples | TwitchTracker filled | Merged coverage | Restored from archive | Viewer data unavailable` (design §13A.3).
    - Render coverage block: chat %, viewer %, 7TV/emote, VOD, sync health.
  - Acceptance criteria:
    - Each `viewerSource` renders the correct badge + tone; coverage block shows all five facets.
  - Tests:
    - unit: source→badge mapping for all values (TEST-014).

- [ ] ANALYTICS-002: Analytics quality score
  - Area: frontend
  - Priority: P2
  - Depends on: ANALYTICS-001
  - Files likely touched:
    - `streampulse-web/src/lib/analyticsQuality.ts`
    - `streampulse-web/src/ui/components/AnalyticsQuality.tsx`
  - Implementation notes:
    - Pure `analyticsQuality(summary)` from `StreamSummaryMetrics` (`model.go`): `data_coverage_pct`, `sync_health_state`, `viewerSource`, rollup count, `vodId` present, chat count → label `Good|Partial|Limited|No data` + per-signal breakdown (chat/viewer/emotes/VOD). Document thresholds inline.
    - Coarse only — never a fabricated precise number.
  - Acceptance criteria:
    - Label + breakdown derive correctly from summary; thresholds documented.
    - `No data` ← never-synced / no rollups / no summary (never mislabel as `Limited`).
    - `Limited` ← partial rollups but weak coverage.
    - `Partial` ← some data with known gaps.
    - `Good` ← high coverage + healthy sync.
  - Tests:
    - unit: label boundaries + breakdown incl. no-data case (TEST-015).

- [ ] ANALYTICS-003: Sanitized sync status + Advanced drawer
  - Area: frontend / security
  - Priority: P2
  - Depends on: WEB-004
  - Files likely touched:
    - `streampulse-web/src/lib/syncStatus.ts`
    - `streampulse-web/src/ui/components/SyncStatus.tsx`
  - Implementation notes:
    - Map backend `SyncPhase` (`sync_status.go`) → user labels (design §13A.5); hide `exporting_archive`/`export_pending` and all GQL/scraper/concurrency/`Chat.IndexPhase` fields.
    - Raw (sanitized) summary only inside an **Advanced** drawer; never raw GQL/scraper internals or raw VOD chat.
  - Acceptance criteria:
    - User sees simplified phases; internal diagnostics absent from default view; Advanced drawer shows only sanitized read-only summary.
  - Tests:
    - unit: phase mapping + field stripping (TEST-016).

- [ ] ANALYTICS-004: Game / category segments
  - Area: frontend
  - Priority: P2
  - Depends on: DASH-006
  - Files likely touched:
    - `streampulse-web/src/ui/components/GameSegments.tsx`
  - Implementation notes:
    - Render category segments from `GET /v1/analytics/streams/{id}/games`; align to the heatmap timeline.
  - Acceptance criteria:
    - Segments render aligned to stream timeline; empty → hidden, not zero-filled.
  - Tests:
    - unit: segment render + empty hide.

- [ ] ANALYTICS-005: Operator-gate internal analytics surfaces
  - Area: security / frontend
  - Priority: P2
  - Depends on: INFRA-004, ANALYTICS-003
  - Files likely touched:
    - `streampulse-web/src/lib/apiClient.ts`
    - `internal/analytics/api.go`
  - Implementation notes:
    - Portal SHALL NOT call/render: archive/corpus controls, global stream picker, admin tracking snapshot, raw VOD chat, Grafana/Influx. These stay operator-only (Cloudflare Access / `/admin`).
    - If a Layer 2 response carries operator-only fields, strip them client-side AND ensure backend does not return them on the portal path.
  - Acceptance criteria:
    - No portal route exposes operator-only analytics; raw VOD chat never rendered.
  - Tests:
    - security: assert portal payloads exclude operator fields (TEST-017).

- [ ] ANALYTICS-006: Sync CTA → backend mode mapping
  - Area: frontend
  - Priority: P2
  - Depends on: DASH-006, BACKFILL-001
  - Files likely touched:
    - `streampulse-web/src/lib/syncActions.ts`
  - Implementation notes:
    - Map user CTAs → backend: Load missed moments → backfill; Upgrade this stream → `POST .../sync`; Refresh viewer chart → `POST .../prefetch-tracker`; Sync chat and emotes → `.../sync` (chat+emote); Retry failed sync → re-`POST .../sync` on `failed` (design §13A.6).
    - Never expose internal mode names to users; rate-limit + dedupe per stream.
  - Acceptance criteria:
    - Each CTA triggers the correct backend call; failed-sync shows Retry; actions rate-limited.
  - Tests:
    - integration: CTA→endpoint mapping; retry path.

- [ ] API-007: Portal-safe analytics response sanitization
  - Area: backend / security
  - Priority: P2
  - Depends on: ANALYTICS-005, API-006
  - Files likely touched:
    - `internal/analytics/api.go`
    - `internal/analytics/portal_analytics_api.go`
    - `internal/analytics/sync_status.go`
    - `internal/analytics/heatmap_handler.go`
  - Implementation notes:
    - Add portal-safe analytics response builders for StreamPulse website use.
    - Expose sanitized portal paths, for example:
      - `GET /v1/portal/analytics/streams/{streamId}`
      - `GET /v1/portal/analytics/streams/{streamId}/summary`
      - `GET /v1/portal/analytics/streams/{streamId}/sync/status`
    - Omit raw VOD chat, GQL diagnostics, scraper internals, archive/corpus fields, export status, queue internals, and operator-only fields server-side.
    - Keep full internal `/v1/analytics/*` available only for operator/internal use if needed.
  - Acceptance criteria:
    - StreamPulse portal endpoints return only user-safe analytics fields.
    - Frontend no longer depends on client-only stripping for security.
    - Operator-only fields cannot be observed from portal endpoints even with a valid beta key.
  - Tests:
    - backend security test: portal analytics responses exclude GQL/scraper/archive/raw-chat fields.

- [ ] API-008: Portal analytics cache and abuse limits
  - Area: backend / performance / security
  - Priority: P2
  - Depends on: API-007, SECURITY-001
  - Files likely touched:
    - `internal/analytics/portal_analytics_api.go`
    - `internal/analytics/heatmap_handler.go`
    - `internal/analytics/pulse_ratelimit.go`
    - `internal/analytics/sync.go`
  - Implementation notes:
    - Add short Redis/server-side caching for portal-safe analytics detail:
      - stream summary: 30–60s
      - replay heatmap: keyed by stream `updated_at` + window
      - games/segments: longer cache, e.g. 5–15m
      - sync status: low TTL while active, higher when terminal
    - Rate-limit expensive actions per principal: `POST /sync`, `POST /prefetch-tracker`, replay-heatmap detail refresh.
    - Deduplicate sync jobs per stream where possible.
    - Matters on a 4-core/8GB VPS — protect workers from stream-page refresh storms.
  - Acceptance criteria:
    - Repeated portal analytics requests hit cache.
    - Expensive sync/refresh actions return 429 or existing-job status when abused.
    - Normal stream-page navigation remains fast.
  - Tests:
    - backend: cache hit/miss path; rate-limit burst on sync actions.
    - integration: stream page does not trigger repeated heavy calls on refresh.

- [ ] ANALYTICS-007: Analytics deep-link contract and auth boundary
  - Area: frontend / backend / security
  - Priority: P2
  - Depends on: DASH-006, ADMIN-001
  - Files likely touched:
    - `streampulse-web/src/lib/analyticsLinks.ts`
    - `internal/analytics/extension_api.go`
    - `docs/website-portal/design.md`
  - Implementation notes:
    - Define two link behaviors:
      - public/beta link: `/dashboard/c/{login}/s/{streamId}?t={offset}`
      - operator link: `STREAMCLONE_ANALYTICS_BASE_URL` + internal analytics route
    - Only show "Open full Streamclone analytics" when operator/admin context is present.
    - For normal beta users, label the action "Open stream analytics" and keep them inside StreamPulse.
  - Acceptance criteria:
    - Beta users never deep-link into the internal/operator-only app.
    - Operators can open the internal analytics app when authenticated.
  - Tests:
    - unit: link builder; security: beta user does not see internal analytics URL.

- [ ] DASH-009: Coverage card + load-missed-moments UI
  - Area: frontend
  - Priority: P2
  - Depends on: WEB-004, BACKFILL-001
  - Files likely touched:
    - `streampulse-web/src/ui/components/CoverageCard.tsx`
    - `streampulse-web/src/lib/coverage.ts` (re-export pulse-core helpers)
  - Implementation notes:
    - Decision tree (design §11.1): full→no CTA; partial+VOD→Load; live+no VOD→Waiting for VOD (disabled); ended+no VOD→unavailable; data present→load full rollups (no new job).
    - Reuse `missedMomentsButtonState`/labels from `pulse-core`/extension.
  - Acceptance criteria:
    - CTA states + copy match the coverage state; honest disabled states for waiting/unavailable.
  - Tests:
    - unit: state machine over coverage states.

- [ ] BACKFILL-001: Backfill status stepper
  - Area: frontend
  - Priority: P2
  - Depends on: WEB-004
  - Files likely touched:
    - `streampulse-web/src/ui/components/BackfillStepper.tsx`
    - `streampulse-web/src/lib/backfill.ts`
  - Implementation notes:
    - Enqueue `POST .../backfill`; poll `GET .../backfill/{jobId}` at 2–3s until terminal.
    - Steps: `queued, resolving_vod, waiting_for_vod, ensuring_emotes, fetching_chat, tokenizing, writing_rollups, refreshing_moments, done, already_available, failed, cancelled`.
    - Percent only when `progress.percent>0`, else indeterminate; never advance past backend status; on done refresh coverage + moments (`evaluateBackfillRefresh`).
  - Acceptance criteria:
    - Stepper labels match backend statuses exactly; no fake progress; terminal stops polling.
  - Tests:
    - integration: stepper across all statuses (TEST-009 mock).

- [ ] MOMENT-001: Saved moments page + CRUD
  - Area: frontend
  - Priority: P2
  - Depends on: DASH-001, API-006
  - Files likely touched:
    - `streampulse-web/src/routes/dashboard/Moments.tsx`
    - `streampulse-web/src/ui/components/MomentRow.tsx`
  - Implementation notes:
    - `GET/POST/PATCH/DELETE /v1/pulse/bookmarks`; search/filter (channel/stream/tag/date) client-side over paged fetch.
    - Row: title/timestamp/score/reason/top emotes/notes/tags + Jump/Open analytics/Copy link/Export.
    - Jump resolves VOD deep link via `pulse-core` once `vodId` exists. Copy link = internal `/dashboard/c/{login}/s/{streamId}?t={offset}` (public `/m/:id` is V2).
  - Acceptance criteria:
    - CRUD works; search/filter functional; jump lands at offset (VOD path once resolved).
  - Tests:
    - integration: bookmark CRUD (TEST-006).

- [ ] MOMENT-003: Export saved moments CSV/JSON
  - Area: frontend
  - Priority: P2
  - Depends on: MOMENT-001
  - Files likely touched:
    - `streampulse-web/src/lib/exportMoments.ts`
  - Implementation notes:
    - Export the filtered set as CSV + JSON; moment metadata only — NO raw chat.
  - Acceptance criteria:
    - Export produces valid CSV/JSON of the current filter; no chat content present.
  - Tests:
    - unit: export format + absence of chat fields.

- [ ] MOMENT-004: Shared `momentRef` contract across extension, portal, and clip queue
  - Area: frontend / backend
  - Priority: P2
  - Depends on: MOMENT-001, MOMENT-002
  - Files likely touched:
    - `packages/pulse-core/src/momentRef.ts`
    - `streampulse-web/src/lib/momentRef.ts`
    - `internal/analytics/bookmarks.go`
  - Implementation notes:
    - Define a shared moment reference: `{ login, streamId, vodId?, offsetSeconds, source, reason?, score?, createdAt? }`.
    - Use for: extension selected moment, saved bookmarks, StreamPulse stream-page selected moment, copy link, future clip candidate queue.
    - `offsetSeconds` remains canonical; `vodId` is optional and resolved later.
  - Acceptance criteria:
    - A moment saved from the extension opens the same moment on the website.
    - A moment copied from the website resolves to the same stream/offset.
    - Future clip candidates can reference the same object shape.
  - Tests:
    - unit: serialize/parse `momentRef`; integration: extension-style bookmark → website route.

- [ ] DASH-010: Extension connection page (authed)
  - Area: frontend
  - Priority: P2
  - Depends on: WEB-007, WEB-008
  - Files likely touched:
    - `streampulse-web/src/routes/dashboard/Connection.tsx`
  - Implementation notes:
    - Authed variant of `/setup`: show backend URL, beta key (masked), copy-config, health check, troubleshooting.
  - Acceptance criteria:
    - Shows current config + live health; copy-config matches extension schema.
  - Tests:
    - integration: health + copy-config reuse.

- [ ] DASH-011: Account page (basic)
  - Area: frontend
  - Priority: P2
  - Depends on: AUTH-001
  - Files likely touched:
    - `streampulse-web/src/routes/dashboard/Account.tsx`
  - Implementation notes:
    - Show active key/device, connected extension status, data export, "forget my data" (clears local key + requests deletion later).
    - No accounts/OAuth in MVP.
  - Acceptance criteria:
    - Displays principal info; forget clears local state.
  - Tests:
    - unit: forget clears storage.

---

## 6. Phase P3 — Admin / operator console

- [ ] ADMIN-001: Cloudflare Access requirement + admin route guard
  - Area: infra / security
  - Priority: P3
  - Depends on: INFRA-004
  - Files likely touched:
    - `deploy/cloudflared/config.yml`
    - `streampulse-web/src/routes/admin/guards.tsx`
  - Implementation notes:
    - `/admin/*` behind Cloudflare Access (operator identity); app also checks operator role on `/v1/admin/*` responses.
    - Distinct from beta keys. Never indexed.
  - Acceptance criteria:
    - Anonymous → blocked by Access; only operator identities reach the console.
  - Tests:
    - security: anonymous admin blocked (TEST-013).

- [ ] ADMIN-002: Admin metrics endpoints `/v1/admin/*`
  - Area: backend
  - Priority: P3
  - Depends on: WATCH-001, SECURITY-001
  - Files likely touched:
    - `internal/analytics/admin_api.go` (new)
    - `internal/analytics/api.go`
  - Implementation notes:
    - Expose health (version, p95, cache hit), tracking registry (refcounts, idle), backfill jobs, abuse counters. Operator-gated.
  - Acceptance criteria:
    - Endpoints return operator metrics; not reachable without Access/operator role.
  - Tests:
    - backend: operator gate; payload shape.

- [ ] ADMIN-003: Health + tracking registry + backfill + abuse cards
  - Area: frontend
  - Priority: P3
  - Depends on: ADMIN-001, ADMIN-002
  - Files likely touched:
    - `streampulse-web/src/routes/admin/Console.tsx`
    - `streampulse-web/src/ui/components/admin/*`
  - Implementation notes:
    - Cards: Health (up/version/p95/cache), Tracking (active/cap/live/evictable), Backfill (running/cap/queued/failed), Abuse (top principals/IPs, throttled).
    - Grafana link out behind Access only; never embed public Grafana.
  - Acceptance criteria:
    - Four cards render from `/v1/admin/*`; Grafana is a private link, not embedded.
  - Tests:
    - integration: cards render from mocked admin endpoints.

- [ ] ADMIN-004: Evict idle channel / cancel backfill / revoke beta key actions
  - Area: backend / frontend
  - Priority: P3
  - Depends on: ADMIN-002, ADMIN-003
  - Files likely touched:
    - `internal/analytics/admin_api.go`
    - `internal/analytics/collector.go`
    - `internal/analytics/pulse_backfill.go`
    - `internal/analytics/pulse_hosted.go`
  - Implementation notes:
    - Evict idle channel (pool), cancel backfill job, revoke beta key (effective next request).
  - Acceptance criteria:
    - Each action takes effect; revoked key → 401 on next call; cancelled job → terminal.
  - Tests:
    - backend: revoke → 401; cancel → cancelled; evict decrements pool.

---

## 7. Phase V2 — Later product layer (deferred, non-blocking)

- [ ] AUTH-100: Device auth `/v1/extension/auth/device`
  - Area: backend
  - Priority: V2
  - Depends on: API-006
  - Files likely touched:
    - `internal/analytics/extension_api.go`
  - Implementation notes:
    - Mint opaque device token bound to a beta key; sent as `Authorization: Bearer`. `principal_kind` flips to `device`.
  - Acceptance criteria:
    - Token mint + validate; principal resolves to device.
  - Tests:
    - backend: mint/validate/expire.

- [ ] AUTH-101: `/v1/extension/me`
  - Area: backend
  - Priority: V2
  - Depends on: AUTH-100
  - Files likely touched:
    - `internal/analytics/extension_api.go`
  - Implementation notes:
    - Return current principal context (kind, caps, watchlist count).
  - Acceptance criteria:
    - Returns principal context for a valid key/token.
  - Tests:
    - backend: response shape per principal kind.

- [ ] WATCH-100: D1 schema + Worker for user state
  - Area: infra / backend
  - Priority: V2
  - Depends on: AUTH-100
  - Files likely touched:
    - `streampulse-web/workers/` (new)
    - D1 migrations
  - Implementation notes:
    - D1 tables: `users`, `devices`, `watchlist`, `clip_candidate_state`. ONLY tiny user state — never rollups/raw chat/VOD chat/TwitchTracker/analytics corpus.
  - Acceptance criteria:
    - D1 holds user/device/watchlist/clip-state only; no Pulse data.
  - Tests:
    - schema check; guard test asserting no rollup tables.

- [ ] WATCH-101: D1-backed watchlists/settings + migration
  - Area: backend
  - Priority: V2
  - Depends on: WATCH-100, AUTH-100
  - Files likely touched:
    - `streampulse-web/workers/watchlist.ts`
    - `internal/analytics/pulse_watchlist.go`
  - Implementation notes:
    - Migrate/mirror Postgres `pulse_watchlist` rows: `UPDATE ... SET principal_id=:deviceId, principal_kind='device' WHERE principal_id=:betaKeyHash`; seed D1. Bookmarks stay Postgres-only.
  - Acceptance criteria:
    - Existing beta-key watchlists migrate to device principal without loss.
  - Tests:
    - integration: migration idempotency; principal re-stamp.

- [ ] MOMENT-100: Clip candidate queue
  - Area: backend / frontend
  - Priority: V2
  - Depends on: WATCH-100
  - Files likely touched:
    - `internal/analytics/clips.go` (new)
    - `streampulse-web/src/routes/dashboard/Clips.tsx`
  - Implementation notes:
    - `GET /v1/pulse/clips`, `PATCH /v1/pulse/clips/{id}`. Confidence + reason + suggested title + start/end; status new/saved/dismissed/exported. Derived from peaks (`pulse-core`), not re-scored client-side.
  - Acceptance criteria:
    - Queue renders with explainable scores; per-user status persists in D1.
  - Tests:
    - integration: status transitions; isolation per principal.

- [ ] MOMENT-101: Shareable moment pages `/m/:id`
  - Area: frontend / backend
  - Priority: V2
  - Depends on: MOMENT-001
  - Files likely touched:
    - `streampulse-web/src/routes/public/Moment.tsx`
    - `internal/analytics/bookmarks.go`
  - Implementation notes:
    - Opt-in per moment (private by default). `GET /v1/pulse/moments/{id}` read-only public for shared moments. May require SSR reconsideration.
  - Acceptance criteria:
    - Only opt-in moments are public; others 404 for non-owners.
  - Tests:
    - security: private moment not publicly readable.

- [ ] DOCS-100: Public API docs
  - Area: docs
  - Priority: V2
  - Depends on: none
  - Files likely touched:
    - `streampulse-web/src/routes/public/Docs.tsx`
    - `docs/website-portal/api.md`
  - Implementation notes:
    - Document public + gated endpoints, auth header, rate limits, coverage/backfill vocabulary.
  - Acceptance criteria:
    - Docs cover all MVP endpoints with examples.
  - Tests:
    - manual review.

- [ ] MOMENT-102: Stream recap improvements
  - Area: backend / frontend
  - Priority: V2
  - Depends on: DASH-006
  - Files likely touched:
    - `internal/analytics/recap/`
    - `streampulse-web/src/ui/components/RecapBlock.tsx`
  - Implementation notes:
    - Richer recap (clip candidates, funniest burst, narrative); same rollups/scoring source.
  - Acceptance criteria:
    - Recap parity with extension; derived, not recomputed client-side.
  - Tests:
    - integration: recap fields present.

- [ ] AUTH-102: Migrate beta-key principal → device/user principal
  - Area: backend
  - Priority: V2
  - Depends on: AUTH-100, WATCH-101
  - Files likely touched:
    - `internal/analytics/pulse_watchlist.go`
    - `internal/analytics/bookmarks.go`
  - Implementation notes:
    - Re-stamp `principal_id`/`principal_kind` on watchlist + bookmarks; document path (design §9.6).
  - Acceptance criteria:
    - All website-owned rows migrate cleanly; no orphaned principals.
  - Tests:
    - integration: end-to-end principal migration.

---

## 8. Phase V3 — Scale and monetization (deferred, non-blocking)

- [ ] AUTH-200: Accounts (email / optional Twitch OAuth)
  - Area: backend
  - Priority: V3
  - Depends on: AUTH-102
  - Implementation notes:
    - Account `userId` principal; Twitch OAuth ONLY if "your followed channels" is built.
  - Acceptance criteria:
    - Account principal supported end-to-end.
  - Tests:
    - integration: account auth.

- [ ] BILLING-200: Billing / tiers
  - Area: backend / frontend
  - Priority: V3
  - Depends on: AUTH-200
  - Implementation notes:
    - Tiered hosted Pulse; gate caps/features by tier.
  - Acceptance criteria:
    - Tier gating enforced.
  - Tests:
    - integration: tier limits.

- [ ] DASH-200: Streamer-owned dashboards
  - Area: frontend / backend
  - Priority: V3
  - Depends on: AUTH-200
  - Implementation notes:
    - Verified streamer view of own channel analytics.
  - Acceptance criteria:
    - Ownership-gated streamer dashboard.
  - Tests:
    - integration: ownership checks.

- [ ] EXT-200: Official Twitch Extension version
  - Area: frontend
  - Priority: V3
  - Depends on: none
  - Implementation notes:
    - Twitch Extension surface reusing pulse-core.
  - Acceptance criteria:
    - Passes Twitch Extension review constraints.
  - Tests:
    - manual review.

- [ ] MOMENT-200: Advanced AI clip scoring
  - Area: backend
  - Priority: V3
  - Depends on: MOMENT-100
  - Implementation notes:
    - ML scoring augmenting heatmap peaks (still server-side; website never scores).
  - Acceptance criteria:
    - Improved candidate ranking; source of truth stays backend.
  - Tests:
    - offline eval.

- [ ] INFRA-200: Multi-worker ingest scaling
  - Area: infra
  - Priority: V3
  - Depends on: WATCH-001
  - Implementation notes:
    - Horizontal analytics-workers; managed Postgres/Redis; LB. Read path (BFF) already stateless + cache-backed.
  - Acceptance criteria:
    - Sustained higher tracked-channel counts within SLOs.
  - Tests:
    - load test.

---

## 9. Testing tasks

- [ ] TEST-001: Backend — watchlist CRUD + principal scoping
  - Area: tests
  - Priority: P0
  - Depends on: WATCH-002
  - Files likely touched:
    - `internal/analytics/pulse_watchlist_test.go`
  - Acceptance criteria:
    - CRUD happy path; principal A cannot read/delete B's rows; cap rejection covered.
  - Tests: backend unit/integration.

- [ ] TEST-002: Backend — public stats/status contain no PII
  - Area: tests / security
  - Priority: P0
  - Depends on: API-002, API-003
  - Files likely touched:
    - `internal/analytics/public_api_test.go`
  - Acceptance criteria:
    - Asserts response fields are aggregate-only; no logins/ids/queue sizes.
  - Tests: backend unit.

- [ ] TEST-003: Backend — `/watch` auth + rate limiting
  - Area: tests / security
  - Priority: P0
  - Depends on: API-006, SECURITY-001
  - Files likely touched:
    - `internal/analytics/extension_api_test.go`
  - Acceptance criteria:
    - Unauthenticated `/watch` → 401; burst beyond cap → 429; refill works.
  - Tests: backend integration.

- [ ] TEST-004: Frontend — status badge derivation
  - Area: tests
  - Priority: P2
  - Depends on: DASH-003
  - Files likely touched:
    - `streampulse-web/tests/statusBadge.test.ts`
  - Acceptance criteria:
    - All six badges map to correct payload conditions.
  - Tests: vitest unit.

- [x] TEST-005: Frontend — beta-key auth + apiClient errors
  - Area: tests
  - Priority: P1
  - Depends on: WEB-004, AUTH-001
  - Files likely touched:
    - `streampulse-web/tests/apiClient.test.ts`
    - `streampulse-web/tests/auth.test.ts`
  - Acceptance criteria:
    - principalId determinism; header injection; 401/429/500/timeout normalization; retry only on 5xx/network.
  - Tests: vitest unit.

- [ ] TEST-006: Integration — saved moment CRUD
  - Area: tests
  - Priority: P2
  - Depends on: MOMENT-001
  - Files likely touched:
    - `streampulse-web/tests/moments.integration.test.ts`
  - Acceptance criteria:
    - Create/edit/delete + jump deep-link resolution against mocked backend.
  - Tests: integration.

- [ ] TEST-007: Integration — watchlist add/remove + cap
  - Area: tests
  - Priority: P2
  - Depends on: WATCH-003
  - Files likely touched:
    - `streampulse-web/tests/watchlist.integration.test.ts`
  - Acceptance criteria:
    - Add/remove flow; cap reached disables add.
  - Tests: integration.

- [ ] TEST-008: Integration — health check + 401 flow
  - Area: tests
  - Priority: P1
  - Depends on: WEB-008, WEB-009
  - Files likely touched:
    - `streampulse-web/tests/health.integration.test.ts`
  - Acceptance criteria:
    - Health ok/unreachable states; 401 routes to login with hint.
  - Tests: integration.

- [ ] TEST-009: E2E (Playwright) — setup, dashboard, backfill stepper
  - Area: tests
  - Priority: P2
  - Depends on: WEB-007, DASH-005, BACKFILL-001
  - Files likely touched:
    - `streampulse-web/tests/e2e/*.spec.ts`
  - Acceptance criteria:
    - First-run setup; dashboard with live channel; partial coverage → backfill stepper across statuses → refreshed; offline channel shows past streams only.
  - Tests: e2e.

- [ ] TEST-010: E2E — landing CTA routing + watchlist + saved moments
  - Area: tests
  - Priority: P2
  - Depends on: WEB-005, WATCH-003, MOMENT-001
  - Files likely touched:
    - `streampulse-web/tests/e2e/landing.spec.ts`
  - Acceptance criteria:
    - CTAs route correctly; watchlist add/remove; save + view moment.
  - Tests: e2e.

- [ ] TEST-011: Performance — landing Lighthouse
  - Area: tests / performance
  - Priority: P1
  - Depends on: WEB-005, WEB-006
  - Files likely touched:
    - `streampulse-web/tests/lighthouse.config.js`
  - Acceptance criteria:
    - Landing Lighthouse performance ≥ 90; no live API on first paint; StatsBand off critical path.
  - Tests: CI Lighthouse.

- [ ] TEST-012: Performance — dashboard payload discipline
  - Area: tests / performance
  - Priority: P2
  - Depends on: DASH-005
  - Files likely touched:
    - `streampulse-web/tests/payload.test.ts`
  - Acceptance criteria:
    - Live polling uses recent window (few KB); no `window=full` request issued on poll; never polls faster than 12s BFF TTL.
  - Tests: integration assertion on request params.

- [ ] TEST-013: Security — `/watch` rejects without key + admin not public
  - Area: tests / security
  - Priority: P0
  - Depends on: API-006, INFRA-004, ADMIN-001
  - Files likely touched:
    - `internal/analytics/extension_api_test.go`
    - `streampulse-web/tests/e2e/security.spec.ts`
  - Acceptance criteria:
    - Unauthenticated `/watch` → 401; anonymous `/admin` + `grafana.*` blocked by Access (no app response).
  - Tests: backend + e2e/security.

- [ ] TEST-014: Frontend — data-source badge mapping
  - Area: tests
  - Priority: P2
  - Depends on: ANALYTICS-001
  - Files likely touched:
    - `streampulse-web/tests/sourceBadge.test.ts`
  - Acceptance criteria:
    - `live|tt|merged|restored|unknown` each map to the correct badge.
  - Tests: vitest unit.

- [ ] TEST-015: Frontend — analytics quality derivation
  - Area: tests
  - Priority: P2
  - Depends on: ANALYTICS-002
  - Files likely touched:
    - `streampulse-web/tests/analyticsQuality.test.ts`
  - Acceptance criteria:
    - Good/Partial/Limited/No-data boundaries + per-signal breakdown correct from summary fixtures.
  - Tests: vitest unit.

- [ ] TEST-016: Frontend — sync phase mapping + diagnostic stripping
  - Area: tests / security
  - Priority: P2
  - Depends on: ANALYTICS-003
  - Files likely touched:
    - `streampulse-web/tests/syncStatus.test.ts`
  - Acceptance criteria:
    - Backend phases map to user labels; GQL/scraper/export/IndexPhase fields stripped from default view.
  - Tests: vitest unit.

- [ ] TEST-017: Security — portal payloads exclude operator-only analytics
  - Area: tests / security
  - Priority: P2
  - Depends on: ANALYTICS-005
  - Files likely touched:
    - `streampulse-web/tests/e2e/analytics-privacy.spec.ts`
  - Acceptance criteria:
    - Portal routes never render archive/corpus/global-picker/admin-snapshot/raw-VOD-chat; Layer 2 portal responses carry no operator-only fields.
  - Tests: e2e/security + backend payload assertion.

---

## 10. Plan guardrails (must hold for every task)

| Guardrail | Enforced by |
|-----------|-------------|
| No rollups/raw chat/VOD chat/TwitchTracker/corpus in D1 | WATCH-100 (D1 = user state only); Postgres remains source of truth |
| Grafana never public | INFRA-004, ADMIN-001/003, TEST-013 |
| No Twitch OAuth in MVP | AUTH-* MVP uses beta key; OAuth only AUTH-200 (V3, conditional) |
| Website never computes Pulse scores | MOMENT-002, DASH-008 use backend `peaks`/`lanes` |
| No full-timeline fetch on normal polling | WEB-004/TEST-012; `window=full`/Layer 2 only on stream-page nav (DASH-006) |
| No unauthenticated public `/watch` | API-006, TEST-003/013 |
| One shared tracking session per channel | WATCH-001 |
| Layer 2 analytics fetched only on explicit nav | DASH-006, API7 (requirements), TEST-012 |
| Internal analytics surfaces operator-only/hidden | ANALYTICS-003/005, **API-007 (server-side sanitized portal endpoints)**, TEST-016/017 (no raw GQL/scraper/corpus/archive/global-picker/raw VOD chat) |
| Security never depends on client-only field stripping | API-007 (portal-safe shape server-side) |
| Heavy Layer 2 / sync actions cached + rate-limited | API-008 (cache + per-principal limits on `/sync`, `/prefetch-tracker`, heatmap) |
| Beta users never deep-link into operator analytics app | ANALYTICS-007 (auth-bounded link builder) |
| One shared moment object across surfaces | MOMENT-004 (`momentRef`) |
| Motion is functional, never decorative/fake | WEB-011 (reduced-motion fallbacks, no fake progress) |
| Sync status sanitized for users | ANALYTICS-003; Advanced drawer is read-only sanitized |
| Analytics quality/source are honest, not fabricated | ANALYTICS-001/002 (coarse labels from real summary fields) |
| V2/V3 never block MVP | Phases isolated; MVP = P0–P2 (+P3 ops) |

---

## 11. Recommended first implementation batch

Get the **hosted surface real first** (infra + skeleton + auth + health) before any dashboard pages. Exact order:

1. **INFRA-001** — Cloudflare DNS/Tunnel for `api.streampulse.stream` (health reachable end-to-end).
2. **INFRA-003** — Hosted-mode environment variables on streampulse-vps (operator env in streampulse-ops).
3. **API-001** — Validate beta-key gating (401 + hint).
4. **WEB-001** — Scaffold Vite + React + TS app.
5. **WEB-002** — Routing + chunk split.
6. **WEB-003** — Design tokens / theme.
7. **AUTH-001** — Beta-key storage + `principalId` + route guards.
8. **WEB-004** — `apiClient` (beta key, 401, retry, error normalization, polling discipline).
9. **WEB-008** — Health check + copy-config flow.
10. **WEB-007** — `/setup` page (install → connect → verify → track).
11. **WEB-009** — `/login` beta-key page.
12. **TEST-005** — Frontend unit tests for beta-key auth + apiClient errors.

After this batch the hosted API is reachable, the app deploys to Pages, a beta user can connect the extension and sign in — then build P1 landing polish (WEB-005/006/010), the P0 data backend (API-002/003/005, WATCH-001/002, SECURITY-001, API-006), and finally P2 dashboard pages on top.

---

*End of document.*

