# StreamPulse — Public Website & Portal Technical Design

> Engineering design for the StreamPulse website/portal. Translates [`../pulse-extension/website-portal-requirements.md`](../pulse-extension/website-portal-requirements.md) into concrete architecture, contracts, state machines, and component boundaries. This document does **not** restate the PRD; it makes implementation-level decisions.

| | |
|---|---|
| **Status** | Draft v1 — design for build |
| **Owner** | Aron-Chu |
| **Source of truth** | **streampulse-backend** (`internal/analytics/*`) + Postgres |
| **Companion PRD** | [`website-portal-requirements.md`](../pulse-extension/website-portal-requirements.md) |
| **Backend specs** | [`../pulse-extension/design.md`](../pulse-extension/design.md), [`../pulse-extension/requirements.md`](../pulse-extension/requirements.md) |

### Naming (fixed)

| Term | Meaning |
|------|---------|
| **Streamclone** | Public desktop Twitch replica (watch / HLS / chat / emotes) — **not** StreamPulse BFF after boundary split. |
| **streampulse-backend** | Private StreamPulse Go API (extension BFF, portal BFF, ingest, hub). |
| **Streamclone Pulse** | Chrome MV3 extension — the live Twitch overlay. |
| **StreamPulse** | This product: public website + user portal at `streampulse.stream`. |
| **Hosted API** | `https://api.streampulse.stream` (Cloudflare Tunnel → **hosted-production-vps**; operator config in private **streampulse-ops**). |

### Decisions resolved in this design (the ambiguities)

| # | Decision | Resolution |
|---|----------|------------|
| D-1 | **MVP watchlist storage** | Beta-key-scoped, **server-side in Postgres** (`pulse_watchlist`, keyed by `principal_id = betaKeyHash`). Not browser-only. Migrates/mirrors to D1 in V2. (§10.1) |
| D-2 | **MVP identity** | `principalId = sha256(betaKey)` truncated. V2 = `deviceId`; V3 = account `userId`. Single `principalId` abstraction everywhere. (§7.4) |
| D-3 | **Framework** | **Vite + React + TypeScript**, static-prerendered landing, SPA dashboard, deployed on Cloudflare Pages. Reuses `@streampulse/pulse-core` / `@streampulse/pulse-charts`. (§5.1) |
| D-4 | **Dashboard URL** | Path-based `/dashboard` (single Pages app) for MVP; `app.` subdomain deferred. (§21) |
| D-5 | **Saved moments storage** | Stay **Postgres-only** (single source with extension `pulse_bookmarks`); never copied into D1. (§12) |

---

## 1. Overview

StreamPulse is the **management, review, and setup layer** for the Streamclone Pulse experience. It is not a second analytics engine and not a copy of the Twitch overlay. It is a thin client over the **StreamPulse backend** (`streampulse-backend`), plus a small amount of website-owned user state (watchlists).

### 1.1 Three surfaces, one engine

```text
┌────────────────────┬──────────────────────────────┬──────────────────────────────┐
│ Streamclone Pulse  │ StreamPulse (this document)   │ StreamPulse operator console  │
│ (Chrome extension) │ (website / portal)            │ (power-user / legacy analytics UI) │
├────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ Live Twitch overlay│ Landing, setup, dashboard,    │ Deep analytics, sync controls,│
│ on the page        │ watchlist, saved moments,     │ full heatmap tooling          │
│ "what did I miss?" │ channel/stream review, admin  │ (deep link target only)       │
│ in-context, live   │ off-Twitch, manage + review   │ source of truth UI            │
└────────────────────┴──────────────────────────────┴──────────────────────────────┘
                          all three read the same backend (peaks, coverage, rollups)
```

### 1.2 How StreamPulse differs

| Concern | Extension | StreamPulse website | Streamclone app |
|---------|-----------|---------------------|-----------------|
| Where it runs | Injected into twitch.tv | `streampulse.stream` | internal/operator |
| Primary job | Live, in-context Pulse | Manage + review across channels | Power analytics + sync |
| Tracking trigger | Auto on channel visit | Explicit add to watchlist | Manual ops |
| Auth | Beta key in options | Beta key in browser | Operator |
| Scope | One channel at a time | All watched channels | Everything |

**Architectural rule:** StreamPulse owns *presentation + watchlist state*. It owns **no** Pulse scoring, no rollup math, no chat. Backend `peaks`/`coverage`/`recap`/`backfill` are the contract.

**Design lab (optional):** UI experiments live in the sibling repo [streampulse-inspire](https://github.com/Aron-Chu/streampulse-inspire) — Next.js on port `5180`, three themes, fixture + hosted modes. Winners port back to `streampulse-web` (Vite on Cloudflare Pages) via that repo's `PORTING.md`. Production portal code in this repo is unchanged by inspire work.

---

## 2. Goals and non-goals

### 2.1 Goals (MVP unless noted)

| Goal | Notes |
|------|-------|
| Public landing page | Static-first, no live API on first paint. |
| Extension setup / connection | Copy-config, health check, troubleshooting. |
| Beta-key gated dashboard | `principalId = betaKeyHash`. |
| Watchlist management | Server-side, beta-key scoped (D-1). |
| Saved moments review | Shared with extension bookmarks. |
| Past streams + single-stream analytics | Ended VODs; current live separate. |
| Load missed moments | Same endpoints/state machine as extension. |
| Public status + stats | Aggregate-only, cached. |
| Admin/operator console | Separate auth (Cloudflare Access). |
| Clip queue, share pages, device auth, D1 | **V2.** |

### 2.2 Non-goals

| Non-goal | Why |
|----------|-----|
| Billing / tiers | V3. |
| Public multi-tenant heavy backfill | Abuse surface; capped + gated only. |
| Raw chat browsing | Rollup-first; raw chat not stored by default. |
| Twitch OAuth / cookies in MVP | Privacy; not needed for read/track. |
| Replacing the extension overlay UI | Different surface, different job. |
| Replacing / embedding Grafana publicly | Operator-private only. |
| Client-side Pulse scoring | Backend peaks are source of truth. |
| D1 for rollups/chat/corpus | Wrong store; Postgres owns it. |

---

## 3. System architecture

### 3.1 Request topology

```text
   ┌──────────────────────────────────────────────────────────────────────┐
   │ Clients                                                                │
   │  • Browser → streampulse.stream (static site + dashboard SPA)          │
   │  • Streamclone Pulse extension → api.streampulse.stream                 │
   └───────────────┬───────────────────────────────────────┬───────────────┘
                   │ HTTPS                                   │ HTTPS
                   ▼                                         ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │ Cloudflare edge                                                        │
   │  DNS · TLS termination · WAF · per-IP rate limit · cache · Access      │
   │   streampulse.stream      → Cloudflare Pages (static site + SPA)       │
   │   api.streampulse.stream  → Cloudflare Tunnel (cloudflared)            │
   │   grafana.streampulse.stream → Cloudflare Access (operator only)       │
   │  [V2 optional] /v1/pulse/watchlist, /v1/pulse/clips → Worker + D1      │
   └───────────────┬──────────────────────────────────────────────────────┘
                   │ cloudflared tunnel (outbound from VPS; NO open ports)
                   ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │ hosted-production-vps (docker compose)                                 │
   │  Caddy :8090 (internal reverse proxy)                                  │
   │    └─ analytics API (chi)    → BFF, bookmarks, recap, backfill, watch  │
   │    └─ analytics-workers      → IRC collector, rollups, scoring,        │
   │                                emote sync, backfill workers            │
   │  Postgres  → streams, rollups, peaks, pulse_bookmarks, recap,          │
   │              backfill jobs, pulse_watchlist (NEW, MVP)                  │
   │  Redis     → BFF cache (12s), tracking pool + refcounts, rate buckets, │
   │              backfill job progress                                     │
   │  emote service · metadata · (video as needed)                          │
   │  pulse profile: Prometheus + Grafana (PRIVATE)                         │
   └──────────────────────────────────────────────────────────────────────┘
```

**Hub fanout (launch hardening):** portal poll cadence defaults to 45s; origin sends short `Cache-Control` on `/v1/public/hub`. Edge cache + WAF limits: [`hub-fanout-edge-cache.md`](hub-fanout-edge-cache.md).

### 3.2 V2 optional Cloudflare Worker / D1 path

```text
Browser ─▶ Cloudflare Worker (edge) ─▶ D1 (users, devices, watchlist, clip_candidate_state)
                  │
                  └─▶ proxies/augments api.streampulse.stream for user-state reads
   D1 holds ONLY tiny relational user state. Pulse data still comes from hosted-production-vps Postgres.
```

### 3.3 Why D1 is not used for rollups

| Property | Rollups/chat (Postgres) | User state (D1, V2) |
|----------|-------------------------|---------------------|
| Write rate | High (per-minute per tracked channel) | Tiny (user actions) |
| Volume | Large, growing corpus | Kilobytes per user |
| Query shape | Time-series, joins, scoring | Key lookups |
| Locality | Co-located with workers/IRC | Edge-friendly |
| Verdict | **Postgres on hosted-production-vps** | **D1 fine in V2** |

D1 is a small, edge-replicated SQLite — excellent for user/device/watchlist rows, wrong for high-write time-series. Rollups, raw/transient chat, peaks, recaps, and backfill state **never** go to D1.

---

## 4. Deployment topology

### 4.1 Hostnames

| Hostname | Target | Auth | Notes |
|----------|--------|------|-------|
| `streampulse.stream` | Cloudflare Pages (static + SPA) | public | landing + dashboard bundle |
| `api.streampulse.stream` | Cloudflare Tunnel → Caddy `:8090` | beta key (gated routes) | no open ports on VPS |
| `grafana.streampulse.stream` | Cloudflare Access → Grafana | operator | never public, never indexed |
| `app.streampulse.stream` | (deferred) | — | optional V2 split, see §21 |

### 4.2 Environment (hosted mode, hosted-production-vps)

Production values live in private **streampulse-ops** (never commit paths or values). Public repo examples below are illustrative only — not authoritative production config.

| Var | Example | Purpose |
|-----|---------|---------|
| `PULSE_HOSTED_MODE` | `true` | Enables beta-key middleware on `/v1/extension/*` gated group. |
| `PULSE_BETA_KEYS` | `KEY1,KEY2` | Comma-separated valid beta keys (`pulse_hosted.go`). |
| `PULSE_MAX_ACTIVE_CHANNELS` | `500` | Global tracked-channel cap (tracking pool). |
| `PULSE_MAX_BACKFILLS` | `10` | Global concurrent backfill cap. |
| `PULSE_MAX_CHANNELS_PER_PRINCIPAL` | `10` | Per-beta-key watchlist/track cap. |
| `PULSE_WATCH_RATE_PER_MIN` | `6` | Token-bucket limit for `/watch` per principal. |
| `PULSE_BACKFILL_RATE_PER_HOUR` | `5` | Backfill enqueues per principal/hour. |
| `SEVENTV_EVENTAPI_ENABLED` | `true` | Live 7TV EventAPI for emote freshness (server-side). |
| `STREAMCLONE_VERSION` | `v0.2.9` | Surfaced in `/v1/extension/health`. |

Cloudflare side (not in repo): tunnel credentials in `deploy/cloudflared/config.yml` (gitignored), `streampulse.stream` Pages project, Access policy for grafana/admin.

### 4.3 Run modes

| Mode | Backend URL | `PULSE_HOSTED_MODE` | Identity | Use |
|------|-------------|---------------------|----------|-----|
| **Portal dev (default)** | `https://api.streampulse.stream` | n/a (read-only public hub) | none | `npm run dev` in `streampulse-web` — no local stack required |
| **Local backend (opt-in)** | `http://localhost:8081` | unset/false | none | `npm run dev:local` + `VITE_ALLOW_LOCAL_BACKEND=1`; **streampulse-backend** compose — not Streamclone `:8090` |
| **Hosted beta** | `https://api.streampulse.stream` | `true` + beta keys | `betaKeyHash` | public beta on hosted-production-vps via Cloudflare |
| **Corpus / analytics** | internal | n/a | operator | full Streamclone app + sync tooling, not StreamPulse-gated |

Site build targets are switched via `VITE_BACKEND_URL` (default differs per mode); the dashboard also lets the user override at runtime for local dev.

**Portal local dev runbook:** [local-dev-runbook.md](./local-dev-runbook.md) — hosted-first checklist, stale-Vite troubleshooting, hub poll defaults (45s).

---

## 5. Frontend application architecture

### 5.1 Framework decision (D-3)

**Vite + React + TypeScript**, deployed to **Cloudflare Pages**.

| Option | Verdict |
|--------|---------|
| **Vite + React (chosen)** | Reuses `@streampulse/pulse-core` (scoring/format/types) and `pulse-ui` (lanes, peak list) shared with the extension; static-prerender the landing; SPA for the dashboard; trivial Pages deploy. Lowest drift with the extension. |
| Next.js / Remix | SSR is unnecessary (dashboard is auth-gated, landing is static); adds a server runtime we don't need on Pages. Reconsider only if SEO-heavy share pages (`/m/:id`, V2) demand SSR. |

- **Landing + docs + status**: prerendered to static HTML at build (`vite-plugin-ssg` or route-level prerender) so first paint needs **no** live API call.
- **Dashboard**: client-rendered SPA behind a beta-key gate, lazy-loaded chunk (not in the landing critical path).
- **Shared packages**: `@streampulse/pulse-core` for `formatHeatOffset`, coverage/backfill types, peak adapters; `pulse-ui` for `MiniHeatmapLane`, `SignalLanes`, `PeakList`. The website imports, never re-implements.

### 5.2 Bundle / route split

```text
streampulse-web/
  src/
    main.tsx                 # router root
    routes/
      public/                # prerendered: Landing, Setup, Docs, Status, Login
      dashboard/             # lazy chunk, beta-key gated
      admin/                 # lazy chunk, operator gated
    lib/
      apiClient.ts           # §8 — beta-key, 401, retry, error normalize
      auth.ts                # principalId, beta-key storage, guards
      coverage.ts            # re-export pulse-core coverage/backfill helpers
      queryKeys.ts           # react-query keys + TTL discipline
    ui/
      theme.ts               # tokens (mirror extension theme.ts)
      components/            # cards, badges, steppers, skeletons
  index.html
  vite.config.ts             # prerender public routes; env VITE_BACKEND_URL
```

### 5.3 Route tree

| Route | Chunk | Auth | Prerender |
|-------|-------|------|-----------|
| `/` | public | none | ✅ static |
| `/setup` | public | none | ✅ static |
| `/docs`, `/docs/*` | public | none | ✅ static |
| `/status` | public | none | shell static, data client-side |
| `/login` | public | none | ✅ static |
| `/dashboard` | dashboard | beta key | ❌ SPA |
| `/dashboard/watchlist` | dashboard | beta key | ❌ |
| `/dashboard/c/:login` | dashboard | beta key | ❌ |
| `/dashboard/c/:login/s/:streamId` | dashboard | beta key | ❌ |
| `/dashboard/moments` | dashboard | beta key | ❌ |
| `/dashboard/streams` | dashboard | beta key | ❌ |
| `/dashboard/connection` | dashboard | beta key | ❌ |
| `/dashboard/account` | dashboard | beta key | ❌ |
| `/admin`, `/admin/*` | admin | operator | ❌ |

### 5.4 Component trees

**Landing (static):**

```text
<LandingPage>
  <TopNav cta="Install / Open dashboard" />
  <Hero headline mockup ctas />
  <HowItWorks steps[4] />
  <StatsBand source="/v1/public/stats" hideOnError />   # only non-static block; lazy
  <FeatureCards cards[6] />
  <AudienceTiles tiles[4] />
  <Resources links[5] />
  <FooterCTA /> <Footer />
```

**Dashboard home (SPA):**

```text
<DashboardShell>                      # nav, connection status, principal context
  <ConnectionStatusBadge />           # health + beta-key validity
  <LiveNowBand>                       # tracked channels live now
    <CurrentStreamCard … />           # reuse extension hierarchy
  <WatchlistPanel>
    <WatchlistRow status=badge … />
  <RecentStreamsPanel>                # ended only
    <PastStreamRow syncBadge … />
  <SavedMomentsPanel latest>
    <MomentRow jump … />
```

### 5.5 Theme tokens

Mirror the extension's `src/ui/theme.ts` so all three surfaces share one visual language.

| Token | Value | Use |
|-------|-------|-----|
| `--bg-base` | `#0a0a0f` | app background |
| `--bg-surface` | `#14141c` | cards |
| `--bg-elevated` | `#1d1d28` | hover/elevated |
| `--violet-500` | `#8b5cf6` | primary/CTA |
| `--purple-600` | `#7c3aed` | pressed/accent |
| `--heat-ramp` | `#4c1d95 → #a855f7 → #f97316 → #fbbf24` | heatmap intensity only |
| `--live` | `#f97316` | LIVE badge |
| `--text-primary` | `#f4f4f7` | body |
| `--text-muted` | `#8b8b9e` | secondary / "Collecting" |

> Orange/yellow is **reserved** for intensity/peak scoring (heatmap ramp + LIVE). Never use it for generic buttons — it must stay semantically "hot".

---

## 6. Page designs and data dependencies

For each page: purpose · components · API calls · states (loading/empty/error/unauthorized).

### 6.1 Landing — `/`

- **Purpose:** explain product, drive install/dashboard/beta.
- **Components:** Hero, HowItWorks, StatsBand, FeatureCards, AudienceTiles, Resources, FooterCTA.
- **API:** `GET /v1/public/stats` (lazy, after first paint, cached). Nothing else.
- **States:** Loading → static content already painted; StatsBand shows count-up placeholders. Empty/Error → **StatsBand hidden** (never zeros). Unauthorized → n/a.

### 6.2 Setup / Connection — `/setup`, `/dashboard/connection`

- **Purpose:** install + connect extension to hosted backend.
- **Components:** InstallStep (detect installed), ConnectStep (backend URL + Copy-config + beta key), VerifyStep (health check), TrackStep.
- **API:** `GET /v1/extension/health`.
- **States:** Loading → "Checking…". Empty → "Not installed → Add to Chrome". Error → `unreachable`/`mixed_content` copy + Retry. Unauthorized → `unauthorized` + "paste beta key".

### 6.3 Login / beta key — `/login`

- **Purpose:** capture beta key, derive `principalId`, enter dashboard.
- **Components:** BetaKeyForm, "request access" link.
- **API:** validates by calling a cheap gated endpoint (`GET /v1/extension/pulse/channels/_probe` or `/v1/extension/me` in V2); MVP validates lazily on first dashboard call.
- **States:** Loading → submitting. Error → invalid key (401). Success → store + redirect `/dashboard`.

### 6.4 Dashboard home — `/dashboard`

- **Purpose:** overview of watched world.
- **Components:** ConnectionStatusBadge, LiveNowBand(CurrentStreamCard[]), WatchlistPanel, RecentStreamsPanel, SavedMomentsPanel.
- **API:** `GET /v1/pulse/watchlist`; per-channel `GET /v1/extension/pulse/channels/{login}` (recent window, batched/staggered); `GET /v1/pulse/bookmarks?limit=…`.
- **States:** Loading → skeleton cards. Empty → "Add your first channel". Error → "Can't reach StreamPulse" + Retry. Unauthorized → beta-key prompt.

### 6.5 Watchlist — `/dashboard/watchlist`

- **Purpose:** manage tracked channels.
- **Components:** AddChannelInput, WatchlistTable(rows + status badge + always-track toggle + remove).
- **API:** `GET/POST/DELETE /v1/pulse/watchlist`; `POST /v1/analytics/channels/{login}/watch` (gated, on add/always-track).
- **States:** Loading → skeleton rows. Empty → "No channels yet". Error → inline retry per action. Unauthorized → prompt. **Cap reached** → disable add + "Channel limit reached (10)".

### 6.6 Channel page — `/dashboard/c/:login`

- **Purpose:** live + recent + moments for one channel (Pulse level).
- **Components:** CurrentStreamCard (live only), CoverageCard (+Load missed), MostReactedSection (peaks), EmoteLanes, PastStreamsSection (collapsible), header actions (Open Twitch / Open analytics).
- **API:** **Layer 1** `GET /v1/extension/pulse/channels/{login}` (recent) + `GET /v1/analytics/channels/{login}/streams` for the past list; backfill endpoints on CTA; `window=full` only on explicit "Load full timeline".
- **States:** Loading → skeleton heatmap. Empty → "Not tracked yet — Start tracking". Partial → coverage chip + CTA. Warming (<5 rollups) → "Collecting moments…". Error/Unauthorized → standard.

### 6.7 Single stream — `/dashboard/c/:login/s/:streamId`

- **Purpose:** full **Analytics** level for one stream (§13A).
- **Components:** FullHeatmap(lanes), MomentsList(jump/save), EmoteSpikeInspector, GameSegments, CoverageBlock + SourceBadges + AnalyticsQuality, RecapBlock, SyncStatus (+Advanced drawer), saved moments.
- **API (Layer 2, on explicit nav only):** `GET /v1/analytics/streams/{streamId}`, `.../summary`, `.../replay-heatmap`, `.../games`, `.../sync/status`; `GET /v1/pulse/streams/{streamId}/recap`; bookmarks. Sync CTAs per §13A.6.
- **States:** as above; recap "not ready" while live → show live view; sync status drives Upgrade/Retry CTAs; raw diagnostics only in Advanced drawer.

### 6.8 Saved moments — `/dashboard/moments`

- **Purpose:** private moment library.
- **Components:** SearchFilterBar, MomentList(MomentRow: title/ts/score/reason/emotes/notes/tags + Jump/Open/Copy/Export), EditMomentModal.
- **API:** `GET/POST/PATCH/DELETE /v1/pulse/bookmarks`.
- **States:** Loading → skeleton. Empty → "No saved moments yet". Error/Unauthorized → standard.

### 6.9 Past streams — `/dashboard/streams`

- **Purpose:** ended streams across channels.
- **Components:** PastStreamsTable(thumbnail/title/ended/duration/syncBadge), filters.
- **API:** per-channel pulse payloads / a future `GET /v1/pulse/streams?logins=` aggregate (V2); MVP reuses channel payloads.
- **States:** standard; current-live never listed here.

### 6.10 Status — `/status`

- **Purpose:** public health.
- **Components:** StatusHeader (overall), ComponentList (API), IncidentNote.
- **API:** `GET /v1/public/status`.
- **States:** Loading → "Checking status…". Error → "Status temporarily unavailable" (no internals). Never shows queue sizes/PII.

### 6.11 Admin — `/admin`

- **Purpose:** operator monitoring + controls.
- **Components:** HealthCards, TrackedChannelTable(evict), BackfillJobsTable(cancel), AbuseTable(revoke).
- **API:** `GET /v1/admin/*` (behind Cloudflare Access).
- **States:** Loading → skeleton. Error → operator-facing detail. Unauthorized → 403 (Access blocks before app).

---

## 7. Auth and identity design

### 7.1 MVP beta-key flow

```text
/login  →  user pastes beta key K
        →  site stores K (localStorage: 'sp.betaKey')
        →  principalId = sha256(K).slice(0,16)   (client-derived, for UI keying only)
        →  every gated request sends header: X-Streamclone-Beta-Key: K
backend →  pulse_hosted.go validates K against PULSE_BETA_KEYS
        →  401 {error:"unauthorized", hint:"Set X-Streamclone-Beta-Key header"} if invalid
```

- The **server** is the authority on validity; the client-side `principalId` is only for local cache keys and optimistic UI. Server stamps the canonical `principal_id = betaKeyHash` on writes (watchlist/bookmarks).

### 7.2 401 handling

| Trigger | Client behavior |
|---------|-----------------|
| Any gated 200→401 mid-session | Clear cached data, route to `/login` with "Your key was rejected. Re-enter it." |
| First dashboard call 401 | Show beta-key prompt inline; do not flash empty dashboard. |
| 401 with `hint` | Surface the backend `hint` verbatim. |

### 7.3 Storage + hardening

- Store beta key in `localStorage` (`sp.betaKey`), **not** a cookie (avoids CSRF; CORS `*` stays valid since it's a header, not credentials — design.md §3).
- Strict CSP (§16) forbids third-party scripts → no script can read the key.
- Never embed the key in prerendered HTML or query strings.
- Key is masked in UI (`PULSE-••••-••••-XXXX`); copy reveals on demand.

### 7.4 `principalId` abstraction (D-2)

A single resolver so storage/rate-limit/ownership code never special-cases the auth phase.

```ts
// lib/auth.ts
type Principal = { id: string; kind: 'beta' | 'device' | 'user' }

function currentPrincipal(): Principal | null {
  const key = localStorage.getItem('sp.betaKey')
  if (key) return { id: hash16(key), kind: 'beta' }    // MVP
  // V2: const dev = deviceToken(); if (dev) return { id: dev.sub, kind:'device' }
  // V3: account session → { id: user.id, kind:'user' }
  return null
}
```

Backend mirror: `principal_id` column + a `principal_kind` enum on website-owned rows.

| Phase | `principalId` source | Header |
|-------|----------------------|--------|
| MVP | `sha256(betaKey)` | `X-Streamclone-Beta-Key` |
| V2 | device token subject | `Authorization: Bearer` |
| V3 | account user id | session/Bearer |

### 7.5 V2/V3

- **V2 device token:** `POST /v1/extension/auth/device` mints an opaque token bound to a beta key; `principal_kind` flips to `device`. Migration §9.5.
- **V3 accounts:** email or Twitch OAuth; OAuth **only** if "your followed channels" is built. Not before.

---

## 8. API client design

### 8.1 `apiClient` responsibilities

```text
apiClient(path, opts)
  • base = VITE_BACKEND_URL (runtime-overridable for local dev)
  • inject X-Streamclone-Beta-Key when gated
  • timeout (8s) + 1 retry w/ jitter on network/5xx (never on 4xx)
  • 401 → emit 'auth:rejected' event (router clears + routes /login)
  • normalize errors → { kind: 'unreachable'|'unauthorized'|'rate_limited'|'server'|'bad_request', message, hint? }
  • parse X-Cache header for observability (HIT/MISS)
```

### 8.2 Polling discipline (hard rules)

| Data | Interval | Window | Rule |
|------|----------|--------|------|
| Live channel pulse | ≥ 30s (jittered) | recent | Never faster than Redis BFF TTL (12s). |
| Dashboard live band | 30s, staggered across channels | recent | Stagger to avoid burst; cap concurrent in-flight. |
| Full timeline | on demand only | `window=full` | Explicit user action; never on poll. |
| Backfill status | 2–3s while running | — | Stop at terminal status. |
| Public stats/status | 60s | — | Cached server-side; client may cache longer. |

> Implemented via react-query with per-key `staleTime ≥ 30000` for live data and `staleTime = Infinity` + manual invalidation for full-timeline.

### 8.3 Endpoint map (contract)

| Call | Method · Path | Gated | Notes |
|------|---------------|-------|-------|
| Health | `GET /v1/extension/health` | no | `{ok,version,time}` |
| Public stats | `GET /v1/public/stats` | no | aggregate, cached |
| Public status | `GET /v1/public/status` | no | high-level only |
| Channel pulse | `GET /v1/extension/pulse/channels/{login}` | yes (hosted) | recent; `?window=full` explicit |
| Start tracking | `POST /v1/analytics/channels/{login}/watch` | yes | rate-limited strictest |
| Enqueue backfill | `POST /v1/extension/pulse/channels/{login}/backfill` | yes | rate-limited; dedupe per stream |
| Backfill status | `GET /v1/extension/pulse/backfill/{jobId}` | yes | poll 2–3s |
| Bookmarks | `GET/POST/PATCH/DELETE /v1/pulse/bookmarks` | yes | shared with extension |
| Watchlist (MVP) | `GET/POST/DELETE /v1/pulse/watchlist` | yes | **new**, Postgres, principal-scoped (§10) |
| Recap | `GET /v1/pulse/streams/{streamId}/recap` | yes | ended streams |
| Channel streams (L2) | `GET /v1/analytics/channels/{login}/streams[/ranked]` | yes | past-streams list |
| Stream detail (L2) | `GET /v1/analytics/streams/{streamId}` | yes | stream-page nav only |
| Stream summary (L2) | `GET /v1/analytics/streams/{streamId}/summary` | yes | metrics + source + quality |
| Replay heatmap (L2) | `GET /v1/analytics/streams/{streamId}/replay-heatmap` | yes | full heatmap |
| Stream games (L2) | `GET /v1/analytics/streams/{streamId}/games` | yes | category segments |
| Sync status (L2) | `GET /v1/analytics/streams/{streamId}/sync/status` | yes | sanitized for users |
| Upgrade stream (L2) | `POST /v1/analytics/streams/{streamId}/sync` | yes | rate-limited |
| **Portal-safe (preferred)** | `GET /v1/portal/analytics/streams/{streamId}[/summary\|/sync/status]` | yes | server-side sanitized + cached (API-007/008); use instead of raw `/v1/analytics/*` |
| Admin | `GET /v1/admin/*` | operator | Cloudflare Access |

---

## 9. Data model

### 9.1 Existing Postgres (source of truth — read, do not duplicate)

| Table | Holds |
|-------|-------|
| `streams` | stream/VOD records, live/ended, `vod_id`, `started_at`/`ended_at` |
| minute rollups | per-minute chat/7TV/viewer counts, top emotes |
| heatmap peaks | scored moments, reasons, dominant signal |
| `pulse_bookmarks` | saved moments (see design.md §5.1) |
| `pulse_stream_recap` | cached recap payload per stream (optional) |
| backfill jobs | in `pulse_backfill.go` (Redis-backed job state + Postgres rollup writes) |

### 9.2 New MVP website table (Postgres) — `pulse_watchlist`

```sql
CREATE TABLE pulse_watchlist (
  id            TEXT        PRIMARY KEY,            -- ULID
  principal_id  TEXT        NOT NULL,               -- sha256(betaKey) in MVP
  principal_kind TEXT       NOT NULL DEFAULT 'beta' CHECK (principal_kind IN ('beta','device','user')),
  login         TEXT        NOT NULL,
  always_track  BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (principal_id, login)
);
CREATE INDEX idx_pulse_watchlist_principal ON pulse_watchlist (principal_id, created_at DESC);
CREATE INDEX idx_pulse_watchlist_always    ON pulse_watchlist (always_track) WHERE always_track;
```

- Forward-only migration (e.g. `000040_pulse_watchlist.up.sql`); never edit applied migrations (AGENTS rule).
- `pulse_bookmarks` gains the same `principal_id`/`principal_kind` (nullable in local, set when hosted) so ownership is consistent across both website-owned tables.

### 9.3 Optional MVP session table

Not required: MVP is stateless (key in header → principal derived per request). A `principal_last_seen` lightweight table MAY be added for admin "active principals" metrics, but Redis (`sp:seen:{principalId}` TTL) is preferred to avoid write churn.

### 9.4 V2 D1 tables (edge, tiny user state)

```sql
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, tier TEXT DEFAULT 'beta', created_at TEXT);
CREATE TABLE devices (id TEXT PRIMARY KEY, user_id TEXT, beta_key TEXT, label TEXT, created_at TEXT, last_seen TEXT, revoked_at TEXT);
CREATE TABLE watchlist (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, login TEXT NOT NULL, always_track INTEGER DEFAULT 0, created_at TEXT, UNIQUE(user_id, login));
CREATE TABLE clip_candidate_state (id TEXT PRIMARY KEY, user_id TEXT, stream_id TEXT, offset_seconds INTEGER, status TEXT DEFAULT 'new', title TEXT, start_seconds INTEGER, end_seconds INTEGER, updated_at TEXT);
```

> `pulse_bookmarks` stays in Postgres even in V2 (D-5): it is the single source shared with the extension. D1 holds users/devices/watchlist/clip-state only.

### 9.5 Redis keys

| Key | Purpose | TTL |
|-----|---------|-----|
| `ext:pulse:v2:{login}` | BFF payload cache | 12s (existing) |
| `sp:track:pool` (+ per-channel refcount) | shared tracking pool | until idle eviction |
| `sp:rl:watch:{principalId}` | `/watch` token bucket | rolling |
| `sp:rl:backfill:{principalId}` | backfill token bucket | rolling |
| `sp:backfill:{jobId}` | job progress | job lifetime |
| `sp:seen:{principalId}` | active-principal metric | 1h |

### 9.6 Identity migration path (MVP → V2)

```text
MVP rows:  pulse_watchlist.principal_id = sha256(betaKey), principal_kind='beta'
V2 step 1: user mints device token bound to same betaKey
V2 step 2: backend maps betaKeyHash → deviceId; UPDATE pulse_watchlist
           SET principal_id = :deviceId, principal_kind = 'device'
           WHERE principal_id = :betaKeyHash
V2 step 3: D1 watchlist seeded from Postgres for that device (mirror or move)
Bookmarks: same re-stamp; Postgres stays source of truth.
```

---

## 10. Watchlist and shared tracking pool design

### 10.1 MVP watchlist storage decision (D-1)

**Watchlists are server-side in Postgres (`pulse_watchlist`), scoped by `principal_id = betaKeyHash`.** Not browser-only.

| Considered | Verdict |
|------------|---------|
| Browser-only (localStorage) | ❌ Dashboard needs server-visible lists; lost on device change; can't drive always-track on the server. |
| Redis-config | ⚠️ Works but watchlist is durable user intent, not transient — Postgres is the right home. |
| **Postgres `pulse_watchlist` (chosen)** | ✅ Durable, principal-scoped, same DB as bookmarks, simple `UNIQUE(principal_id, login)`. |
| D1 | ⏭ V2 — edge user store; mirror/migrate from Postgres (§9.6). |

The watchlist is **preferences**; actual tracking is the **shared pool** below. Adding a row optionally enqueues a `watch` (always-track), but never creates per-user IRC.

### 10.2 Shared tracking pool

```text
principal A adds xqc ─┐
principal B adds xqc ─┼─▶ tracking pool entry "xqc":
principal C adds xqc ─┘     { refcount: 3, lastViewedAt, irc: ONE join, workers: ONE pipeline }

  → exactly ONE IRC session + ONE rollup pipeline per channel, regardless of N principals.
```

| Field | Meaning |
|-------|---------|
| `refcount` | number of principals watching / actively viewing |
| `lastViewedAt` | last pulse poll for the channel (any principal) |
| `alwaysTrack` | sticky flag (kept even at refcount 0, subject to cap) |

### 10.3 Eviction + caps

```text
on add/poll:        refcount++ (or set lastViewedAt); ensure single watch
on remove/idle:     refcount-- ; if refcount==0 && !alwaysTrack && idle>IDLE_TTL → evict (leave IRC)
global cap:         active channels ≤ PULSE_MAX_ACTIVE_CHANNELS
per-principal cap:  watchlist size ≤ PULSE_MAX_CHANNELS_PER_PRINCIPAL
backpressure order: protect (1) always-track, (2) currently-live + viewed, (3) recently viewed;
                    evict idle/offline/no-refcount first
```

### 10.4 Status badge derivation

Computed from the pulse payload (`tracking`, `isLive`, completed rollups, `coverage.state`) — never assumed client-side.

| Badge | Condition |
|-------|-----------|
| `LIVE` | `isLive && tracking` |
| `Offline` | `!isLive` |
| `Warming` | `tracking && completedRollups < 5` (`extPulseMinCompleted`) |
| `Synced` | `coverage.hasFullStreamCoverage` |
| `Partial` | `coverage.state ∈ {partial_tracking, missing_ranges_detected}` |
| `Not tracked` | `!tracking` |

---

## 11. Load missed moments design

Shared concept + endpoints with the extension. The website reuses `missedMoments.ts` logic from `pulse-core`/extension where possible (state derivation, labels) so behavior is identical.

### 11.1 Decision tree

```text
coverage.hasFullStreamCoverage              → no CTA ("Full stream tracked")
canBackfill (gaps/partial + vodId present)  → "Load missed moments"  → POST .../backfill
state == waiting_for_vod (live, no VOD yet) → "Waiting for VOD" (disabled)
state == vod_unavailable (ended, no VOD)    → "Chat replay unavailable" (disabled)
data already present for range              → load full-stream rollups (window=full), NO new job
```

### 11.2 Backfill state machine (from `pulse_backfill.go`)

```text
queued ─▶ resolving_vod ─▶ (waiting_for_vod) ─▶ ensuring_emotes ─▶ fetching_chat
        ─▶ tokenizing ─▶ writing_rollups ─▶ refreshing_moments ─▶ done
   any ─▶ failed | cancelled
   short-circuit ─▶ already_available
```

| Status | Stepper label | UI |
|--------|---------------|-----|
| `queued` | Queued | step 1 active |
| `resolving_vod` | Resolving VOD | step 2 |
| `waiting_for_vod` | Waiting for VOD | paused/info |
| `ensuring_emotes` | Ensuring emotes | step |
| `fetching_chat` | Fetching chat | step (may have percent) |
| `tokenizing` | Tokenizing | step |
| `writing_rollups` | Writing rollups | step |
| `refreshing_moments` | Refreshing moments | step |
| `done` | Moments refreshed | success |
| `already_available` | Already loaded | success (no job ran) |
| `failed` | Couldn't backfill | error + Retry |
| `cancelled` | Cancelled | neutral |

### 11.3 Progress honesty

- Show numeric percent **only** when `job.progress.percent > 0`; otherwise indeterminate shimmer.
- Never advance the stepper past the backend status.
- On `done`/`already_available`: refresh coverage + moments; classify `full | partial | none` via the shared `evaluateBackfillRefresh` helper; surface "earlier minutes are now in the graph."

### 11.4 Rate limit + dedupe

- One active job per `streamId` (and per requested range): a second enqueue returns the existing job id (backend `ActiveJobForStream`).
- Per-principal backfill bucket (`PULSE_BACKFILL_RATE_PER_HOUR`); 429 → "Too many backfills, try later."

---

## 12. Saved moments design

- **Single source of truth:** `pulse_bookmarks` (Postgres), shared with the extension. No D1 copy (D-5).
- **CRUD:** `GET/POST/PATCH/DELETE /v1/pulse/bookmarks`; principal-scoped when hosted (`principal_id`).
- **Search/filter:** by channel, stream, tag, date; client-side over a paged fetch (cursor on `created_at`).
- **VOD deep-link:** `offsetSeconds` is canonical; resolve to VOD link once `vodId` exists via `pulse-core` `buildMomentJumpLink` / `buildVodDeepLink`.
- **Copy link:** copies a StreamPulse internal link (`/dashboard/c/{login}/s/{streamId}?t={offset}`); a public `/m/{id}` share page is **V2 opt-in** (private by default).
- **Export:** CSV + JSON of the filtered set; **no raw chat** included (only moment metadata).

```text
MomentRow:  "team wipe"  xQc · 00:52:14  score 95  7TV spike  [KEKW ×214]
            tags: clipworthy   notes: "maybe clip later"
            [Jump] [Open analytics] [Copy link] [Export]
```

---

## 13. Past streams and current stream hierarchy

Mirror the extension's model exactly (`CurrentStreamCard` vs `PastVodsSection`).

```text
Channel page / dashboard:
  ┌ Current stream (live only) ──────────────┐   ← CurrentStreamCard, LIVE badge, separate
  │  coverage chip · mini heat · Open         │
  └───────────────────────────────────────────┘
  ┌ Past streams (ended VODs ONLY) ───────────┐   ← collapsible, 3 rows default
  │  thumb · title · ended · duration · [sync] │
  └───────────────────────────────────────────┘
```

| Sync badge | Meaning |
|-----------|---------|
| `No pulse` | stream exists, no rollups |
| `Stats only` | viewer/metadata only |
| `Chat synced` | chat rollups present, partial Pulse |
| `Full pulse` | full rollups + peaks + recap |

**Rule:** a currently-live stream is **never** rendered in the past list, and an ended stream is never shown as current.

---

## 13A. Analytics integration design (Analytics-Lite)

StreamPulse incorporates Streamclone Analytics as a **curated layer**, not by embedding the internal console. Same Postgres/Redis source of truth; two presentation levels; layered endpoints; a hidden operator surface.

### 13A.1 Pulse vs Analytics levels

| Level | Data | Surface | Layer |
|-------|------|---------|-------|
| **Pulse** | top moments, heatmap, emote spikes, coverage, recap summary | channel page + compact cards | Layer 1 BFF |
| **Analytics** | viewer lines, game segments, source detail, sync health, summary metrics | single-stream page | Layer 2 detail |

### 13A.2 Layered endpoint usage (which call, when)

```text
poll / cards / live          → Layer 1   GET /v1/extension/pulse/channels/{login}        (compact, 12s cache)
explicit stream navigation   → Layer 2   GET /v1/analytics/streams/{id}                  (detail)
                                         GET /v1/analytics/streams/{id}/summary
                                         GET /v1/analytics/streams/{id}/replay-heatmap
                                         GET /v1/analytics/streams/{id}/games
                                         GET /v1/analytics/streams/{id}/sync/status
                                         GET /v1/analytics/channels/{login}/streams[/ranked]
stitching hurts (V2 only)    → Layer 3   GET /v1/portal/streams/{id}  (curated BFF, build only if needed)
```

- Layer 2 is **never** fetched on polling — only on navigation to `/dashboard/c/:login/s/:streamId` (explicit action).
- react-query keys for Layer 2 use `staleTime: Infinity` + manual invalidation (e.g. after "Upgrade this stream" completes).
- **Portal-safe variants:** the portal SHOULD call sanitized `/v1/portal/analytics/streams/{id}[/summary|/sync/status]` (server-side stripped, cached + rate-limited — tasks API-007/008) rather than raw `/v1/analytics/*`. Raw internal paths are reserved for operator context. Security must not rely on client-side stripping alone.

### 13A.3 Data-source badge mapping

Backend `viewerSource` (`session.go`: `live|tt|merged|restored`, else unknown) → user badge. Map server-side or in a `lib/sourceBadge.ts` helper.

| `viewerSource` | Badge | Tone |
|----------------|-------|------|
| `live` | Live samples | strong |
| `tt` | TwitchTracker filled | info |
| `merged` | Merged coverage | info |
| `restored` | Restored from archive | muted |
| `unknown`/empty | Viewer data unavailable | muted |

### 13A.4 Coverage block + Analytics-quality derivation

Coverage block on every stream page (first-class):

```text
Chat coverage 82% · Viewer coverage 64% · 7TV/emote Ready · VOD Resolved · Sync health Partial
```

Quality label derived from `StreamSummaryMetrics` (`model.go`) — coarse, never a fake precise number:

```text
inputs:  data_coverage_pct, sync_health_state, viewerSource, rollup count, vodId present, chat message count
label:   Good     ← coverage ≥ ~80% & sync healthy & chat+emotes synced & VOD resolved
         Partial  ← coverage ~40–80% or one signal missing/tt-filled
         Limited  ← coverage < ~40% or sync degraded
         No data  ← no rollups / not collected
breakdown: Chat: synced · Viewer: partial · Emotes: synced · VOD: resolved
```

Implement as a pure `analyticsQuality(summary)` in `lib/` (unit-tested); thresholds documented inline.

### 13A.5 Sync phase mapping (internal → user-facing)

Backend `SyncPhase` (`sync_status.go`) is detailed; the portal shows simplified labels and hides GQL/scraper internals unless an **Advanced** drawer is opened.

| Backend `SyncPhase` | User-facing label |
|---------------------|-------------------|
| `starting` | Queued |
| `scraping_tracker` / `parsing_tracker` | Refreshing viewer chart |
| `resolving_vod` | Resolving VOD |
| (no VOD yet) | Waiting for VOD |
| `fetching_comments` | Fetching chat |
| `writing_rollups` | Writing rollups |
| (post-write peaks) | Refreshing moments |
| `exporting_archive` / `export_pending` | (hidden — operator only) |
| `completed` | Done |
| `failed` | Failed (Retry) |

Pulse backfill phases (`pulse_backfill.go`) map to the same user labels (§11) so "Load missed moments" and "Upgrade this stream" read consistently.

### 13A.6 Sync CTA → backend mode

| User CTA | Backend call |
|----------|--------------|
| Load missed moments | `POST /v1/extension/pulse/channels/{login}/backfill` |
| Upgrade this stream | `POST /v1/analytics/streams/{streamID}/sync` |
| Refresh viewer chart | `POST /v1/analytics/streams/{streamID}/prefetch-tracker` |
| Sync chat and emotes | `POST .../sync` (chat+emote mode) |
| Retry failed sync | re-`POST .../sync` when phase `failed` |

### 13A.7 Do-not-expose (operator-gate or hide)

`raw sync diagnostics` · `scraper internals` · `GQL concurrency/debug` · `archive export controls` · `silver/gold corpus controls` · `Grafana/Influx` · `global stream picker` · `admin tracking snapshot` · `raw VOD chat messages`.

- The portal's sanitized `sync/status` view strips `Chat.IndexPhase`, tracker GQL fields, concurrency/cleanup phases, and export phases before render.
- Advanced drawer shows only a read-only, sanitized summary; operator-only fields require Cloudflare Access (§15).
- **Defense in depth:** stripping happens **server-side** on the `/v1/portal/analytics/*` builders (task API-007); the client never receives operator-only fields, even with a valid beta key.

### 13A.8 "Open analytics" deep-link & auth boundary (task ANALYTICS-007)

| Caller | Action label | Target |
|--------|--------------|--------|
| Beta user | **Open stream analytics** | `/dashboard/c/{login}/s/{streamId}?t={offset}` (stays in StreamPulse) |
| Operator | **Open full Streamclone analytics** | `STREAMCLONE_ANALYTICS_BASE_URL` + internal route |

- The "full Streamclone analytics" link is shown **only** when operator/admin context is present. Beta users never see or resolve the internal app URL. Implement via a `lib/analyticsLinks.ts` builder that takes principal kind.

### 13A.9 Shared `momentRef` (task MOMENT-004)

One moment object across extension, portal, saved moments, and the future clip queue:

```ts
type MomentRef = {
  login: string; streamId: string; vodId?: string;
  offsetSeconds: number;            // canonical anchor
  source: 'extension' | 'web';
  reason?: string; score?: number; createdAt?: string;
}
```

- Lives in `@streampulse/pulse-core` (`momentRef.ts`), consumed by both the extension and the website. `offsetSeconds` is canonical; `vodId` resolves later. A moment saved in the extension opens the same moment on the website and vice versa.

---

## 14. Public status and public stats

### 14.1 `GET /v1/public/stats`

```json
{
  "streamsTracked": 4231,
  "momentsDetected": 1820433,
  "chatMessagesProcessed": 982133421,
  "emotesIndexed": 51233,
  "vodsAnalyzed": 3120,
  "updatedAt": "2026-06-23T18:00:00Z"
}
```

- Aggregate-only, **no PII**, no per-channel/per-principal data.
- Precomputed by a periodic job → cached in Redis (`sp:public:stats`, ≥ 60s); endpoint serves cache.
- Client hides the StatsBand entirely on error (never zeros).
- Numbers presented as approximate ("4.2K+", "982M+").

### 14.2 `GET /v1/public/status`

```json
{ "status": "operational", "api": "up", "degraded": false, "incident": null, "updatedAt": "…" }
```

- High-level only: overall status, API up/degraded, optional incident copy.
- **Must not** expose queue sizes, backfill counts, tracked-channel counts, error rates, or anything that reveals capacity/abuse surface (those live in `/admin`).

---

## 15. Admin / operator design

- **Auth:** Cloudflare Access in front of `/admin` and `grafana.streampulse.stream`; app also checks an operator role. Distinct from beta keys.
- **Cards:**

| Card | Shows | Source |
|------|-------|--------|
| Health | API up, version, p95 latency, BFF cache hit ratio | metrics |
| Tracking | active channels / cap, live count, evictable idle | tracking pool |
| Backfill | running / cap, queued, recent failures | job registry |
| Abuse | top principals/IPs by RPS, throttled keys | rate buckets |

- **Controls:** evict idle channel, cancel backfill job, revoke beta key (takes effect next request).
- **Grafana:** link out behind Access only; **never embed public Grafana** (workspace rule).

```text
HEALTH    ● up · v0.2.9 · p95 138ms · cache 94%
TRACKING  312/500 · 28 live · 4 evictable     [evict idle]
BACKFILL  3/10 running · 1 queued · 0 failed(1h) [cancel]
ABUSE     2 keys throttled                      [revoke]
```

---

## 16. Security and privacy design

| Area | Design |
|------|--------|
| `/watch` exposure | Never unauthenticated public; gated by beta key in hosted mode; strict per-principal + per-IP rate limit. |
| Backfill | Gated; per-principal hourly bucket; dedupe per stream; global concurrent cap. |
| Rate limiting | Cloudflare per-IP (edge) + Redis token buckets per principal (`/watch`, `/backfill` strictest). |
| CORS | `Access-Control-Allow-Origin: *` is fine — auth is a header, not cookies (design.md §3). If ever cookie-based, echo specific origin + credentials. |
| CSP | `default-src 'self'; script-src 'self'; connect-src 'self' https://api.streampulse.stream; img-src 'self' https: data:; no third-party scripts.` |
| Transport | TLS at Cloudflare; HSTS; extension/site refuse non-https non-localhost backend (mixed-content guard). |
| Twitch auth | No cookies/OAuth in MVP. |
| Raw chat | Not stored by default; backfill chat is transient (tokenize → rollups → discard). |
| Public endpoints | Aggregate-only; no PII. |
| Secrets | Beta keys/tokens never committed, never in prerendered HTML/bundle; `PULSE_BETA_KEYS` server-side only. |

### 16.1 Abuse cases + mitigations

| Abuse | Mitigation |
|-------|------------|
| Repeated `watch` spam | Per-principal token bucket + dedupe (shared pool refcount, single IRC). |
| Repeated backfill spam | Per-principal hourly bucket + one-job-per-stream dedupe + global cap. |
| Polling too fast | Server BFF cache (12s) absorbs; client honors ≥30s; edge rate limit backstop. |
| Beta key leak | Revoke key in `/admin`; rotate `PULSE_BETA_KEYS`; per-key rate caps limit blast radius. |
| Channel-tracking flood | Per-principal channel cap + global active-channel cap + idle eviction. |

---

## 17. Performance design

| Lever | Design |
|-------|--------|
| Landing | Static-prerendered; **no** live API on first paint; StatsBand lazy + hideable. |
| Loading | Skeletons everywhere; cached payload rendered before refresh completes. |
| BFF cache | Respect 12s TTL; never poll faster; rely on `X-Cache`. |
| Live payload | A few KB (recent ~60 rollups, ≤10 peaks); lanes precomputed 0–100 server-side. |
| Full timeline | `window=full` only on explicit action; cached as `staleTime: Infinity` until invalidated. |
| No client scoring | Peaks/coverage from backend; zero scoring math in the browser. |
| Dashboard polling | 30s jittered, staggered per channel, cap concurrent in-flight. |
| Backfill polling | 2–3s while running; stop at terminal. |
| Targets | Landing Lighthouse ≥ 90; dashboard FMP < 2s; BFF cache-miss p95 < 150ms. |

---

## 18. UX state model

Per page: **loading · empty · partial · error · unauthorized** (see §6). Cross-cutting honesty rules (carried from extension):

1. Never zero-fill as if real data.
2. Never invent moments when `peaks` is empty → show **Warming/Collecting**.
3. Current live ≠ past stream (separate surfaces).
4. "Most Reacted So Far" (live) ≠ "Stream Recap" (ended).
5. Optional lanes (viewers/keywords) hidden when unavailable, never zero-filled.
6. "Load missed moments" only when a backfill can actually run; otherwise explain why.
7. Backfill progress is real or indeterminate — never fake.
8. `prefers-reduced-motion` respected (shimmer, count-up, stepper).

---

## 19. Testing strategy

| Layer | Tests |
|-------|-------|
| **Unit** | coverage copy + `missedMomentsButtonState`, status-badge derivation, `apiClient` error normalization, beta-key storage/`principalId`, route guards, `evaluateBackfillRefresh`. |
| **Integration** | health check happy/`unreachable`, 401 → login flow, backfill stepper across all statuses (mocked), watchlist add/remove + cap, bookmark CRUD. |
| **E2E (Playwright)** | first-run setup (install detect → connect → health), dashboard with a live channel, partial-coverage → backfill → refreshed, offline channel → past streams only. |
| **Security** | `/watch` rejects without key (401+hint), rate-limit returns 429, `/admin` blocked without Access, public endpoints contain no PII. |
| **Performance** | landing Lighthouse ≥ 90 (CI), dashboard payload size assertions (recent window few KB, no `window=full` on poll). |

Reuse `pulse-core` existing tests where logic is shared (coverage/backfill/format).

---

## 20. Implementation phases

| Phase | Deliverables | Backend work |
|-------|--------------|--------------|
| **P0 — Infra** | Cloudflare DNS/Tunnel → hosted-production-vps; `api.streampulse.stream` TLS; turn on beta-key gating; `/v1/public/stats` + `/v1/public/status`; edge + Redis rate limits; tracking-pool caps + idle eviction. | new public endpoints; rate buckets; pool caps; env (§4.2) |
| **P1 — Marketing** | Vite+React app skeleton; prerendered `/`, `/setup`, `/docs`, `/status`, `/login`; hero/stats/feature cards; install detection + health check; `apiClient` + auth/`principalId`. | none (reads health/public) |
| **P2 — Dashboard core** | `/dashboard`, `/dashboard/watchlist`, `/dashboard/c/:login`, `/dashboard/c/:login/s/:streamId`, `/dashboard/moments`, `/dashboard/streams`, `/dashboard/connection`; load-missed-moments reuse; status badges; coverage cards. | `pulse_watchlist` table + `GET/POST/DELETE /v1/pulse/watchlist`; bookmark principal scoping |
| **P3 — Admin** | `/admin` health/registry/jobs/abuse; evict/cancel/revoke; Cloudflare Access. | `/v1/admin/*`; metrics surface |
| **V2** | device auth (`/auth/device`, `/me`), D1 watchlists/settings, clip queue (`/v1/pulse/clips`), share pages (`/m/:id`). | device tokens; D1; clip candidate compute |
| **V3** | accounts + Twitch OAuth (if needed), billing/tiers, streamer dashboards, official Twitch Extension, multi-worker ingest scaling. | accounts, billing, scale-out |

---

## 21. Open decisions

| # | Decision | Current direction |
|---|----------|-------------------|
| 1 | Website framework | **Vite + React** on Cloudflare Pages (D-3); revisit if SSR share pages needed. |
| 2 | MVP watchlist storage | **Postgres `pulse_watchlist`**, principal-scoped (D-1); D1 in V2. |
| 3 | Beta key vs device token timing | Beta key for MVP (already built); device tokens V2. |
| 4 | Public status detail level | Minimal (operational/degraded/incident); no internals. |
| 5 | Saved moments storage | **Postgres-only**, shared with extension (D-5); no D1 mirror. |
| 6 | `/dashboard` path vs `app.` subdomain | **Path-based** `/dashboard` for MVP (D-4); subdomain optional later. |
| 7 | Public `/m/:id` share pages | V2, opt-in per moment; may force SSR reconsideration (decision 1). |
| 8 | Aggregate stats source | Precomputed periodic job → Redis cache. |

---

## Appendix A — Page → API → store map

| Page | Calls | Store |
|------|-------|-------|
| `/` | `/v1/public/stats` | Redis cache |
| `/setup`,`/dashboard/connection` | `/v1/extension/health` | — |
| `/status` | `/v1/public/status` | Redis cache |
| `/login` | (validate on first gated call) | localStorage `sp.betaKey` |
| `/dashboard` | watchlist + per-channel pulse + bookmarks | Postgres + Redis BFF |
| `/dashboard/watchlist` | watchlist CRUD + `watch` | Postgres + tracking pool |
| `/dashboard/c/:login` | channel pulse + backfill | Postgres + Redis + jobs |
| `/dashboard/c/:login/s/:id` | pulse `window=full` + recap | Postgres |
| `/dashboard/moments` | bookmarks CRUD | Postgres |
| `/dashboard/streams` | per-channel pulse (MVP) | Postgres |
| `/admin` | `/v1/admin/*` | metrics/Redis |

## Appendix B — Honesty rules (must not regress)

Same set as the extension and PRD Appendix B: warming-not-estimated, live-vs-recap, explicit coverage, backfill-only-when-possible, no fake progress, current-vs-past separation, hide-unavailable-lanes.

---

*End of document.*

