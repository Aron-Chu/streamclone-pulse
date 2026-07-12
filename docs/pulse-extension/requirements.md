# Streamclone Pulse Extension — Requirements

Status: **MVP shipped / in progress**. Canonical spec in this repo; implementation spans the **streamclone-pulse** extension and the streamclone backend.

> **2026-07 hosted default:** Production extension and StreamPulse portal use `https://api.streampulse.stream`. Public [`/analytics`](https://streampulse.stream/analytics) needs **no beta key** and **no local stack**. Local BFF debugging uses `http://localhost:8081` (**streampulse-backend** compose) via explicit opt-in in extension Options — not Streamclone `:8090` (watch-only after boundary split).

Related code: `@streampulse/pulse-core` (**streampulse-backend** `packages/pulse-core/`), **this repo** `src/` (content script, service worker, `ui/Overlay.tsx`), **streampulse-backend** `internal/analytics/extension_api.go` (BFF + Redis cache), `bookmarks.go`, `recap/`.

---

## TL;DR

The Chrome extension is a **thin, Twitch-native Pulse viewer**, not a second analytics system. Streamclone already does the valuable work — IRC collection, 7TV tokenization, minute rollups, stream/VOD linking, heatmap scoring, and moment ranking. The extension only needs to:

1. Detect the current Twitch channel.
2. Ask Streamclone to track it.
3. Render Pulse directly on the Twitch page.
4. Let the user jump to peaks, **save moments**, or open the full Streamclone analytics view.

**Design target:** *Native-feeling Twitch overlay, shared Streamclone logic, Streamclone backend as the source of truth.* The integration is **deep visually, light technically**.

**MVP = Level 2.5 (historical):** Twitch overlay + local backend (`http://localhost:8081` streampulse-backend) + shared `@streampulse/pulse-core`. **Current default (2026-07):** hosted API + public `/analytics`; local BFF remains explicit dev opt-in in extension Options.

### Core Pulse additions (shared — not extension-only)

Three capabilities below are **features of Pulse itself** (backend + `apps/web` + extension), surfaced *first* and *most usefully* in the extension because that is where users watch. They must not be re-implemented in the browser:

- **Moment memory / bookmarks (R10):** a private "Save Moment" queue. Not every useful moment becomes a public clip — some are just "remember this." Sticky because users build a personal/session library.
- **Per-signal lanes (R11):** render the composite Pulse score *and* its component lanes (chat, 7TV, optional viewers/keywords). A single score hides whether a moment was huge-chat / no-emote vs low-chat / huge-7TV — a distinction editors and streamers care about.
- **Session recap (R12):** when a live stream ends, Pulse transitions from "Most Reacted So Far" to a "Stream Recap" (top 10 moments, top emotes, biggest chat spike, best clip candidates, totals). Keeps the surface useful after the live session, not just an offline/error state.

### Explicitly out of scope (MVP)

- A second analytics engine, scraper, or chat collector running in the browser. The extension never scrapes Twitch chat from the page; it reads Streamclone's rollups.
- Embedding Grafana, duplicating the in-app `/analytics` dashboard, or re-implementing rollup/scoring math in the extension (it imports `pulse-core`).
- Public/hosted multi-tenant Pulse (accounts, device auth, rate limits) — that is V2/V3.
- Promising "jump anywhere" on a live stream — live seek is buffer-limited (see R7).

---

## Architecture

```text
Twitch page
  -> Chrome extension content script (isolated world)
  -> Streamclone Pulse overlay (shared pulse-ui)
  -> Extension service worker (MV3 API bridge)
  -> Streamclone analytics backend (Caddy :8090)
  -> IRC collector + 7TV rollups + heatmap scoring
```

MV3 constraints that shape this design:

- Background pages are replaced by a **service worker**; all network/API calls live there, not in the content script.
- Content scripts run in an **isolated world**, so overlay DOM/CSS must not collide with Twitch's page JS or styles (shadow DOM or scoped classes).
- Cross-origin fetches from a content script require host permissions; routing through the service worker via `chrome.runtime.sendMessage` is the safer, cleaner pattern:

```text
content script -> chrome.runtime.sendMessage -> service worker -> Streamclone API
```

### Layers

| Layer | Responsibility |
|-------|----------------|
| **Content script** | Parse `twitch.tv/{login}`, detect live/offline, mount overlay into Twitch DOM, watch SPA navigation, render heat strip / badges / peaks / errors, optionally control the `<video>` element for seeking. |
| **Service worker** | Stored backend URL, (later) auth token, `POST /watch`, poll `/pulse`, retry/backoff, error handling, cache latest result. |
| **Shared `pulse-core` / `pulse-ui`** | Reused scoring/formatting/rendering so the extension behaves identically to the web app. |

### Shared package extraction (the key engineering decision)

Do **not** copy-paste Pulse logic into the extension. Extract the existing, already-tested helpers into shared packages consumed by both `apps/web` and `apps/chrome-extension`:

```text
packages/pulse-core
  liveHeat.ts        # deriveLiveHeat, formatHeatOffset, LIVE_HEAT_* constants
  momentScoring.ts   # computeStreamBaselines, detectPickReason, fallbackMomentScore100
  momentScore.ts     # buildMomentScoreModel
  momentLanes.ts     # deriveSignalLanes (composite/chat/7TV/viewers/keywords) — R11
  vodDeepLink.ts     # buildMomentJumpLink, buildVodDeepLink, buildAnalyticsMomentLink
  bookmarks.ts       # Bookmark type + CRUD client, offset->deep-link resolution — R10
  recap.ts           # StreamRecap type + builder/formatter — R12
  heatmapTypes.ts    # ReplayHeatmapPoint and friends
  apiClient.ts       # typed fetch wrappers for analytics + bookmark + recap endpoints

packages/pulse-ui
  MiniHeatmapLane.tsx
  SignalLanes.tsx     # composite + per-signal lanes — R11
  PeakList.tsx        # rows with Save Moment / Jump / Open Full Analytics — R10
  SignalBadges.tsx
  SavedMoments.tsx    # session/personal bookmark library — R10
  StreamRecap.tsx     # post-stream recap surface — R12
  PulsePopover.tsx
```

These functions are currently pure and DOM-free in `frontend/src/utils/` (`liveHeat.ts`, `vodDeepLink.ts`, `momentScoring.ts`, `momentScore.ts`) precisely so they can be unit-tested without rendering — that makes them safe to lift into `pulse-core` with their existing tests (`frontend/tests/liveHeat.test.ts`, `frontend/tests/vodDeepLink.test.ts`).

---

## Backend changes (minimal)

The extension *could* call the existing endpoints directly:

```text
POST /v1/analytics/channels/{login}/watch
GET  /v1/analytics/channels/{login}/live
GET  /v1/analytics/streams/{streamID}/replay-heatmap
```

…but stitching three calls per poll is fragile. Add one BFF-style endpoint that returns a single compact payload the overlay can render directly:

```http
GET /v1/extension/pulse/channels/{login}
```

```json
{
  "login": "xqc",
  "isLive": true,
  "tracking": true,
  "streamId": "319...",
  "vodId": null,
  "startedAt": "2026-06-21T18:00:00Z",
  "currentOffsetSeconds": 18420,
  "rollups": [
    {
      "offsetSeconds": 18360,
      "chatCount": 912,
      "sevenTvEmoteCount": 220,
      "viewerCount": 64210,
      "keywordCount": 12,
      "topEmotes": ["KEKW", "OMEGALUL"]
    }
  ],
  "lanes": {
    "composite": [12, 18, 31, 92, 100, 64, 22],
    "chat":      [22, 24, 38, 88, 100, 71, 33],
    "seventv":   [8, 9, 19, 55, 100, 92, 21],
    "viewers":   [10, 11, 12, 22, 33, 41, 52],
    "keywords":  [0, 0, 2, 4, 1, 0, 0]
  },
  "peaks": [
    {
      "offsetSeconds": 18240,
      "score": 96,
      "reasons": ["chat_spike", "seventv_spike"],
      "dominantSignal": "seventv",
      "topEmotes": ["KEKW"]
    }
  ],
  "recap": null
}
```

The `peaks`/`reasons` contract must match the existing reason vocabulary (`chat_spike`, `emote_spike`, `seventv_spike`, `twitch_emote_spike`, `ffz_spike`, `viewer_spike`, `manual`) and the `>= 5 completed rollups` / `<= 10 points` gating already enforced by `deriveLiveHeat`.

`lanes` are normalized 0–100 series aligned 1:1 with `rollups` (per-signal), letting the overlay draw per-signal lanes (R11) without recomputing. `viewers`/`keywords` MAY be omitted when a signal is unavailable for the stream. `recap` is `null` while live and populated once the stream ends (see `/recap` below + R12).

```text
MVP endpoints:
  GET  /v1/extension/health
  GET  /v1/extension/pulse/channels/{login}
  POST /v1/analytics/channels/{login}/watch     (existing)

  # Moment memory / bookmarks (R10) — core Pulse, shared with apps/web
  GET    /v1/pulse/bookmarks                      (list; filter by streamId/vodId/login)
  POST   /v1/pulse/bookmarks                      (create)
  PATCH  /v1/pulse/bookmarks/{id}                 (edit label/notes)
  DELETE /v1/pulse/bookmarks/{id}                 (remove)

  # Session recap (R12)
  GET    /v1/pulse/streams/{streamID}/recap       (top moments, emotes, totals)

Later (hosted):
  POST /v1/extension/auth/device
  GET  /v1/extension/me
  GET  /v1/extension/channels/{login}/last-stream
```

### Bookmark record (R10)

Stored server-side (local DB in MVP; user-scoped once hosted). `source` distinguishes overlay-created bookmarks from web-app ones:

```json
{
  "id": "bk_01J...",
  "streamId": "319...",
  "vodId": null,
  "login": "xqc",
  "offsetSeconds": 4365,
  "label": "funny team wipe",
  "source": "extension",
  "score": 95,
  "notes": "maybe clip later",
  "createdAt": "2026-06-21T19:12:45Z"
}
```

`offsetSeconds` is the canonical anchor (resolves to a VOD deep link once the VOD exists, via the same `pulse-core` helpers as peaks). A bookmark is a *private* memory marker — it never auto-creates a public clip.

### Recap payload (R12)

```json
{
  "streamId": "319...",
  "login": "xqc",
  "durationSeconds": 21600,
  "totalMessages": 412903,
  "peakChatPerMin": 1840,
  "topMoments": [ { "offsetSeconds": 18240, "score": 96, "reasons": ["seventv_spike"] } ],
  "topEmotes": [ { "code": "KEKW", "count": 9123 } ],
  "biggestChatSpike": { "offsetSeconds": 12030, "chatPerMin": 1840 },
  "funniestEmoteBurst": { "offsetSeconds": 18240, "code": "KEKW", "count": 1290 },
  "clipCandidates": [ { "offsetSeconds": 18240, "score": 96 } ]
}
```

---

## Requirements

EARS-style. Priority: **P0** = MVP-critical, **P1** = quality/UX, **P2** = nice-to-have / hosted.

### R1 — Channel detection (P0)

The content script SHALL identify the active Twitch channel and its playback context.

- R1.1 The content script SHALL parse the login from `twitch.tv/{login}` URLs and re-detect on Twitch SPA navigation (no full reload), debounced to avoid duplicate work.
- R1.2 The system SHALL detect VOD pages (`twitch.tv/videos/{vodId}`) and capture the `vodId` for deep-link/seek behavior.
- R1.3 The content script SHALL distinguish live vs offline vs non-channel pages (directory, settings) and only mount the overlay on channel/VOD pages.
- R1.4 The system SHALL NOT mount more than one overlay instance per tab; navigation SHALL update the existing overlay in place.

### R2 — Track request (P0)

The extension SHALL ask Streamclone to begin tracking the detected channel.

- R2.1 The service worker SHALL call `POST /v1/analytics/channels/{login}/watch` when tracking is enabled for a channel.
- R2.2 Track requests SHALL be idempotent from the user's perspective (repeated mounts/navigation SHALL NOT spam the backend; de-dupe per login + short TTL).
- R2.3 The overlay SHALL reflect tracking state (`Tracking <login>` vs `Start tracking`) sourced from the backend response, not assumed.

### R3 — Pulse rendering (P0)

The overlay SHALL render Pulse directly on the Twitch page using shared `pulse-ui`.

- R3.1 The overlay SHALL render a heat strip (mini heatmap), `chat/min` and `7TV/min` signals, and a ranked Top Moments list. Each Top Moment row SHALL expose `Save Moment` / `Jump` / `Open Full Analytics` actions (see R10).
- R3.2 Scoring, reasons, offset formatting, and gating SHALL come from `pulse-core` (`deriveLiveHeat`, `formatHeatOffset`), so extension output matches the web app exactly.
- R3.3 The overlay SHALL honor the existing honesty rules: title "Most Reacted So Far" (never "Most Replayed"), the `based on chat and emote activity` subtitle, and the trailing incomplete minute shown muted as `Collecting`.
- R3.4 The overlay SHALL render in an isolated DOM/CSS scope (shadow DOM or namespaced classes) and visually match a Twitch-native side panel — without breaking Twitch's own layout/JS.
- R3.5 The overlay SHALL NOT block or overlap Twitch's player controls, chat input, or following bar.

### R4 — Overlay modes (P1)

The overlay SHALL support three docked display modes.

- R4.1 **Collapsed:** a small `Pulse ●` pill.
- R4.2 **Mini:** `Pulse ● Tracking` + a compact heat strip.
- R4.3 **Expanded:** channel title, tracking state, `chat/min`, `7TV/min`, the per-signal lanes (R11), Top Moments with `Save Moment` / `Jump` / `Open Full Analytics` actions (R10), and — after the stream ends — the Stream Recap (R12).
- R4.4 The selected mode and dock position SHALL persist across navigation and sessions.

### R5 — Service-worker API bridge (P0)

All backend communication SHALL go through the MV3 service worker.

- R5.1 The content script SHALL communicate with the backend only via `chrome.runtime.sendMessage` to the service worker (no direct cross-origin fetch from the page context).
- R5.2 The service worker SHALL poll `/v1/extension/pulse/channels/{login}` on a configurable interval (default 30s, matching `LIVE_HEAT_REFRESH_MS`) with retry/backoff and jitter.
- R5.3 The service worker SHALL cache the latest successful payload per login and serve it to the overlay on (re)mount before the next poll completes.
- R5.4 Backend host SHALL default to `https://api.streampulse.stream`; an explicit local override MAY use the StreamPulse BFF at `http://localhost:8081`. The worker SHALL request only the host permissions it needs.

### R6 — Settings (P1)

The extension SHALL expose user settings.

- R6.1 Backend URL (default `https://api.streampulse.stream`; explicit local BFF override `http://localhost:8081`).
- R6.2 Polling interval (15s / 30s / 60s).
- R6.3 Overlay placement (Bottom bar / Right dock / Hidden).
- R6.4 Auto-track policy (Off / Followed channels / Always ask).

### R7 — Click-to-peak / seeking (P0 for VOD, P1 for live)

Clicking a peak SHALL navigate to the moment using the safest available path.

- R7.1 For VODs, the overlay SHALL deep-link via `pulse-core` (`buildMomentJumpLink` / `buildVodDeepLink`) — Twitch supports `?t=1h2m3s`, and Streamclone supports `/c/{login}?vod={vodId}&offset=`.
- R7.2 For live streams, the overlay SHALL attempt an in-player seek by setting the player `currentTime` **only within the available DVR buffer**.
- R7.3 When a live moment is outside the seekable buffer, the overlay SHALL NOT silently fail; it SHALL show the timestamp with a clear next step. UI vocabulary:
  - `Jump if available` (seekable now)
  - `Replay after VOD` (out of buffer, VOD not yet resolved)
  - `Open in Streamclone` (open full analytics / VOD deep link)
- R7.4 The UI SHALL NOT promise "jump anywhere live."

### R8 — Errors & honesty (P0 guardrail)

The overlay SHALL surface failures honestly, never fake data.

- R8.1 Backend unreachable / wrong URL SHALL show an actionable error ("Can't reach Streamclone at <url>"), not an empty/zeroed chart.
- R8.2 Channel not yet collected or `< 5` completed rollups SHALL show a "warming up / collecting" state (consistent with `LIVE_HEAT_MIN_COMPLETED_ROLLUPS`), not an empty Top Moments list presented as final.
- R8.3 Offline channels SHALL clearly indicate offline + offer last-stream/VOD context where available. The overlay SHALL show a dense **Past streams** list (preview thumbnail + title + sync badge) below live Pulse content whenever the backend is reachable. The overlay SHALL also show a dense **Past streams** list (thumbnail + title rows) below live Pulse content whenever backend context is connected, sourced from metadata stream history + analytics stream list.

### R9 — Hosted-first with explicit local BFF (P2)

The extension SHALL use the hosted StreamPulse API by default. Local BFF work is
an explicit development mode.

- R9.1 Local development SHALL target the StreamPulse BFF at `localhost:8081`,
  never the Streamclone watch stack at `localhost:8090`.
- R9.2 Hosted access, device auth, rate limits, and multi-tenant privacy remain
  separately scoped; they SHALL NOT block explicit local BFF development.

### R10 — Moment memory / bookmarks (P1, core Pulse)

Users SHALL be able to privately save moments to a personal/session library. This is a feature of **Pulse itself**, shared with `apps/web` — not extension-only.

- R10.1 The system SHALL provide `Save Moment` from any Top Moment row, from the heat strip at the current playhead, and from a manual offset, persisting a bookmark record (`streamId`, `vodId`, `offsetSeconds`, `label`, `source`, `score`, `notes`).
- R10.2 Bookmarks SHALL be **private** memory markers and SHALL NOT auto-create or publish a clip.
- R10.3 The backend SHALL expose CRUD via `GET/POST/PATCH/DELETE /v1/pulse/bookmarks`, and `apps/web` analytics SHALL show the same library (single source of truth).
- R10.4 The overlay SHALL show a lightweight saved-moments list for the current stream/VOD and allow `Jump` to each (using the same `pulse-core` deep-link helpers as peaks).
- R10.5 `source` SHALL record origin (`extension` vs `web`); `offsetSeconds` is canonical and SHALL resolve to a VOD deep link once the VOD exists.
- R10.6 In local-only MVP, bookmarks SHALL persist server-side without accounts; hosted mode SHALL scope them per user (R9.2) — same record shape.

### R11 — Per-signal lanes (P1)

The overlay SHALL render the composite Pulse score **and** its component lanes, because a single score hides context (huge-chat/no-emote vs low-chat/huge-7TV).

- R11.1 The overlay SHALL render at minimum a `Pulse` (composite), `Chat`, and `7TV` lane, time-aligned to the same offsets.
- R11.2 The overlay SHALL render an optional `Viewers` lane when viewer data is available, and an optional `Keywords` lane when keyword tracking is configured (both MAY be hidden when unavailable — never faked).
- R11.3 Lane series SHALL come from the BFF `lanes` object (normalized 0–100, aligned 1:1 with `rollups`); the overlay SHALL NOT recompute scoring locally.
- R11.4 Each peak SHALL expose its `dominantSignal` / `reasons` so a moment can be read as "chat-driven" vs "7TV-driven" at a glance.
- R11.5 Lanes SHALL be visually compact (sparkline-style) to respect the "thin companion" constraint; Mini mode MAY show only the composite lane.

### R12 — Session recap (P1)

When a tracked live stream ends, Pulse SHALL transition from "Most Reacted So Far" to a **Stream Recap**.

- R12.1 On stream end (`isLive` false for a previously-live tracked stream), the overlay SHALL replace the live header with `Stream Recap` for that `streamId`.
- R12.2 The recap SHALL show: top 10 moments, most-used emotes (all providers), biggest chat spike, funniest emote burst, best clip candidates, total messages, and peak `chat/min`, sourced from `GET /v1/pulse/streams/{streamID}/recap`.
- R12.3 Recap is an **explicit Pulse feature**, distinct from the offline/error states (R8.3); offline-with-no-stream still shows last-stream/VOD context, but a just-ended tracked stream shows the full recap.
- R12.4 Recap moments and clip candidates SHALL support `Save Moment` (R10) and `Jump` / VOD deep link (R7) once the VOD resolves.
- R12.5 The recap SHALL be derived from the same rollups/scoring as live Pulse (`pulse-core`) so live ranking and recap ranking agree.

### R13 — Emote metadata readiness (P0)

Pulse analytics SHALL use backend-synced 7TV metadata for top-emote chips and spike inspection. The extension SHALL NOT become a chat emote renderer.

- R13.1 `POST /watch` SHALL trigger async emote ensure on the backend; IRC join and the watch response MUST NOT wait on 7TV API calls, image downloads, or Redis rebuilds.
- R13.2 The extension SHALL NOT call `emotes/ensure` directly in MVP; the backend owns correctness.
- R13.3 The BFF pulse payload SHALL include `emoteSync` (`state`, `provider`, `lastSyncedAt`, `eventApiActive`, `source`, `message`).
- R13.4 The overlay SHALL show honest status copy (`7TV synced`, `7TV syncing…`, `7TV stale — using cached set`, `7TV unavailable — showing aggregate emote spikes only`).
- R13.5 When emote identity is unavailable, Pulse SHALL still show chat/7TV spike counts and lanes; it MUST NOT hide spikes.
- R13.6 The MVP SHALL NOT mutate Twitch chat or render native 7TV emotes; Chat mode continues to defer to the official 7TV extension.
- R13.7 An Emote Spike Inspector SHOULD surface top 3–5 emotes for the leading spike moment using rollup `topEmotes` metadata.

---

## Integration levels

| Level | Integration | Verdict |
|-------|-------------|---------|
| Popup only | Low | Too weak; feels like a toy. |
| Twitch overlay + backend API | Medium-high | Best MVP. |
| Shared packages with web app | High | Best long-term design. |
| Hosted public Pulse network | Very high | Product/business step, not MVP. |

Build **Level 2.5 first**: Twitch overlay + local backend + shared `pulse-core`.

---

## Acceptance criteria

- On a live, tracked channel with `>= 5` completed rollups, the overlay renders the same Top Moments ranking and scores as the web app's "Most Reacted So Far" for the same stream (shared `pulse-core`).
- Navigating between channels in the Twitch SPA updates the overlay in place with no duplicate overlays and no orphaned pollers.
- Clicking a peak on a VOD lands within a few seconds of the moment via the existing deep-link contract; clicking a live moment either seeks (within buffer) or shows the correct `Replay after VOD` / `Open in Streamclone` affordance.
- With the backend stopped, the overlay shows an actionable "can't reach Streamclone" error rather than empty charts.
- No console errors attributable to the extension on a normal Twitch channel page; overlay does not break Twitch player/chat layout.
- `Save Moment` from the overlay creates a bookmark that is immediately visible in `apps/web` (same `/v1/pulse/bookmarks` source) and never produces a public clip; `Jump` from a saved moment lands at the bookmarked offset (VOD path once resolved).
- The Expanded overlay renders composite + chat + 7TV lanes aligned to the same offsets; the optional viewers/keywords lanes appear only when data exists (never zero-filled to look real).
- When a tracked live stream ends, the overlay switches to "Stream Recap" with top moments / top emotes / totals matching the web app for the same `streamId`.

---

## Risks / open questions

- **Twitch DOM volatility:** Twitch ships frequent DOM/class changes; overlay mount points and the `<video>` handle need resilient selectors and a fallback dock.
- **Live seek reliability:** DVR buffer availability varies per channel/stream; R7.2 may be a no-op on many live streams — keep the VOD path as the dependable experience.
- **CSS isolation:** prefer shadow DOM to avoid Twitch style bleed in both directions.
- **Shared package mechanics:** monorepo/workspace wiring (build tooling for `apps/web` + `apps/chrome-extension`) needs a spike before lifting `frontend/src/utils/*` into `packages/pulse-core` without breaking the existing Vite app and node test runner.
- **MV3 service-worker lifecycle:** the worker can be evicted; polling/cache must tolerate cold starts (re-hydrate from `chrome.storage`).

---

## Suggested checks

```sh
# Backend BFF endpoint (local explicit mode)
curl http://localhost:8081/v1/extension/health
curl http://localhost:8081/v1/extension/pulse/channels/xqc        # includes lanes + recap fields

# Moment memory / bookmarks (R10)
curl -X POST http://localhost:8081/v1/pulse/bookmarks \
  -H 'content-type: application/json' \
  -d '{"streamId":"319","offsetSeconds":4365,"label":"funny team wipe","source":"extension","score":95,"notes":"maybe clip later"}'
curl 'http://localhost:8081/v1/pulse/bookmarks?login=xqc'

# Session recap (R12)
curl http://localhost:8081/v1/pulse/streams/319/recap

# Shared logic parity (reuse existing tests after extraction)
cd frontend && npm test -- liveHeat vodDeepLink
go test ./internal/analytics/...
```
