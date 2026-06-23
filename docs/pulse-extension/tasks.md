# Streamclone Pulse Extension — Tasks

Execution plan for [`requirements.md`](./requirements.md) (R1–R12) per [`design.md`](./design.md). Phases are ordered so each delivers something runnable. **MVP = P0–P5 (local-only).** P6 is hosted/public and is independently scoped.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done. Each task notes the requirement(s) it satisfies and a check to prove it.

---

## P0 — Repo & shared-logic bootstrap

Goal: a new extension repo that builds, and a shared package the web app + extension both consume.

- [x] **P0-1** Create new repo `streamclone-pulse` (Aron-Chu/streamclone-pulse). MV3 scaffold (Vite + TS + React), `manifest.json`, CI (typecheck/test/build/zip). _Check:_ `npm run build` emits a loadable unpacked extension.
- [x] **P0-2** Extract pure helpers from `frontend/src/utils/` into `streamclone/packages/pulse-core` (`liveHeat.ts`, `vodDeepLink.ts`, `momentScoring.ts`, `momentScore.ts`, types). Keep existing unit tests (`frontend/tests/liveHeat.test.ts`, `vodDeepLink.test.ts`) green against the new path. _Satisfies:_ R3.2, R11.3. _Check:_ `cd frontend && npm test -- liveHeat vodDeepLink` passes after re-pointing imports.
- [ ] **P0-3** Publish `@streamclone/pulse-core` to GitHub Packages from main-repo CI; extension consumes it. Day-1: vendor via git submodule until first publish. _Check:_ extension imports `@streamclone/pulse-core` and typechecks.
- [ ] **P0-4** Decide registry + versioning (see design §10). Document in extension `README`.

**Exit:** extension builds and imports shared core; web app still passes its tests using the same package.

---

## P1 — Backend: extension BFF + health

Goal: one compact endpoint the overlay can render directly, plus a reachability probe. All in the existing `analytics` service (chi).

- [x] **P1-1** `internal/analytics/extension_api.go`: register `/v1/extension` route group; `GET /v1/extension/health` → `{ok,version,time}`. _Satisfies:_ R8.1. _Check:_ `curl http://localhost:8090/v1/extension/health`.
- [x] **P1-2** `GET /v1/extension/pulse/channels/{login}` BFF: assemble `isLive/tracking/streamId/vodId/currentOffsetSeconds/rollups/peaks` from existing store + heatmap scoring (reuse `deriveLiveHeat` logic / `heatmap.Cache`). _Satisfies:_ R3.1, R3.3. _Check:_ payload matches web app's "Most Reacted So Far" for the same stream.
- [x] **P1-3** Add `lanes{composite,chat,seventv,viewers?,keywords?}` (normalized 0–100, 1:1 with rollups) + `dominantSignal` per peak. Omit optional lanes when unavailable (no zero-fill). _Satisfies:_ R11.1–R11.4. _Check:_ unit test on lane derivation; viewers/keywords absent when source missing.
- [x] **P1-4** Redis-cache BFF payload 10–15s keyed `ext:pulse:{login}`. Implemented in `internal/analytics/extension_api.go` (12s TTL, `X-Cache: HIT|MISS` headers). _Satisfies:_ design §9. _Check:_ second request within TTL is a cache hit (`X-Cache: HIT`).
- [x] **P1-5** Confirm CORS for `chrome-extension://` origin (existing `httpx.CORS` `*`, no credentials in MVP) + OPTIONS 204. _Satisfies:_ R5, design §3. _Check:_ preflight + GET from a loaded extension succeed.

**Exit:** `curl …/v1/extension/pulse/channels/<live-login>` returns a renderable payload; cache hits logged.

---

## P2 — Extension core: detect, track, render (the MVP spine)

Goal: overlay appears on a live Twitch channel and shows real Pulse.

- [x] **P2-1** Content script channel detection: parse `twitch.tv/{login}`, VOD `videos/{id}`, live/offline/non-channel; debounce SPA nav; single-instance guard. _Satisfies:_ R1.1–R1.4. _Check:_ navigating channels updates one overlay, no duplicates.
- [x] **P2-2** Service worker API bridge: `chrome.runtime.sendMessage` router, typed messages, `host_permissions`, no direct fetch from content script. _Satisfies:_ R5.1. _Check:_ content script never issues cross-origin fetch (CSP-clean).
- [ ] **P2-3** Track request: `POST /v1/analytics/channels/{login}/watch` on enable; per-login dedupe + TTL; reflect backend tracking state. _Satisfies:_ R2.1–R2.3. _Check:_ repeated mounts don't spam `watch`.
- [ ] **P2-4** Poll loop: BFF at configurable interval (default 30s) + jitter, retry/backoff, cache latest in `chrome.storage.session`, re-hydrate on worker cold start. _Satisfies:_ R5.2–R5.4. _Check:_ kill+restart worker → overlay restores from cache then refreshes.
- [x] **P2-5** Mount overlay in Shadow DOM (isolated CSS), render heat strip + chat/min + 7TV/min + Top Moments via `pulse-core`; honesty title "Most Reacted So Far" + warming/incomplete-minute rules. Don't block player/chat. _Satisfies:_ R3.1–R3.5. _Check:_ no Twitch layout breakage; values match web app.

**Exit:** install unpacked → open a live channel → overlay shows live Pulse matching the web app.

---

## P3 — Overlay UX: modes, settings, lanes, seeking

- [x] **P3-1** Display modes: collapsed pill / mini (strip) / expanded; persist mode + dock across nav & sessions. _Satisfies:_ R4.1–R4.4.
- [x] **P3-2** Settings (options + popup): backend URL, polling interval (15/30/60s), overlay placement, auto-track policy. _Satisfies:_ R6.1–R6.4. _Check:_ changing backend URL re-probes health.
- [x] **P3-3** Per-signal lanes UI (`SignalLanes`): composite + chat + 7TV always; viewers/keywords only when present; mini mode = composite only. _Satisfies:_ R11.1–R11.5.
- [x] **P3-4** Click-to-peak / seeking: VOD deep link via `pulse-core` (`buildMomentJumpLink`/`buildVodDeepLink`); live in-buffer `<video>.currentTime` seek; out-of-buffer → `Replay after VOD` / `Open in Streamclone`; never "jump anywhere". _Satisfies:_ R7.1–R7.4. _Check:_ VOD lands within seconds; live out-of-buffer shows correct affordance.
- [x] **P3-5** Error/empty/offline states (`states/`): unreachable backend, warming (< 5 rollups w/ progress), offline + last-stream context. _Satisfies:_ R8.1–R8.3.
- [x] **P3-6** Past streams section (`PastVodsSection`): dense thumbnail + title rows below live Pulse content; metadata history + analytics merge via service worker; Analytics / Play VOD actions. _Satisfies:_ R8.3 follow-up. _Check:_ section visible while live and offline; current live row excluded when tracking.

**Exit:** the overlay matches the Figma board's expanded panel, lanes, modes, settings, and seek states.

---

## P4 — Moment memory / bookmarks (core Pulse)

Goal: private save queue, shared backend with the web app.

- [x] **P4-1** Migration `000038_pulse_bookmarks` (+ down). _Satisfies:_ R10 schema. _Check:_ `make` migrate up/down clean.
- [x] **P4-2** `internal/analytics/bookmarks.go`: CRUD store + handlers `GET/POST/PATCH/DELETE /v1/pulse/bookmarks` (cursor pagination; `source` in {web,extension}; never creates a clip). _Satisfies:_ R10.1–R10.3, R10.6. _Check:_ curl create/list/patch/delete.
- [x] **P4-3** Overlay `SavedMoments` UI: Save Moment from Top Moment rows, from current playhead, and from manual offset; saved list for current stream/VOD with Jump. _Satisfies:_ R10.1, R10.4.
- [x] **P4-4** Web app parity: `apps/web` lists the same bookmarks (single source of truth); `source` distinguishes origin. _Satisfies:_ R10.3, R10.5. _Check:_ a bookmark saved in the extension appears in the web app.

**Exit:** Save Moment works from the overlay and shows up in the web app; jumping a saved moment lands at the offset (VOD path once resolved).

---

## P5 — Session recap (core Pulse)

- [x] **P5-1** `internal/analytics/recap/` pure aggregation (mirror of `pulse-core/recap.ts`): top 10 moments, top emotes, biggest chat spike, funniest burst, clip candidates, totals, peak chat/min — from existing rollups/peaks. _Satisfies:_ R12.2, R12.5.
- [x] **P5-2** `GET /v1/pulse/streams/{streamID}/recap`: compute-on-demand first; optional cache table `000039_pulse_stream_recap` when read volume warrants. _Satisfies:_ R12.2. _Check:_ recap matches web app for the same stream.
- [x] **P5-3** Overlay transition: on `isLive:false` for a previously-live tracked stream, swap header to "Stream Recap"; distinct from offline/error (R8.3). Recap rows support Save Moment + Jump/VOD deep link. _Satisfies:_ R12.1, R12.3, R12.4.

**Exit:** when a tracked stream ends, the overlay flips to a recap whose ranking/totals agree with the web app.

---

## P6 — Hosted / public (independently scoped; do NOT block MVP)

Goal: anyone can install. Requires the infra from design §7.

- [ ] **P6-1** **TLS + domain (blocker):** terminate HTTPS at Caddy for `api.streamclone.app` (Let's Encrypt) so the extension's secure-context fetches aren't mixed-content blocked. _Satisfies:_ design §7.1.
- [ ] **P6-2** Device auth: `POST /v1/extension/auth/device` (opaque token in `chrome.storage.local`, `Authorization: Bearer`); scope bookmarks by `user_id`; `GET /v1/extension/me`. _Satisfies:_ R9.2.
- [ ] **P6-3** Shared tracking pool: refcounted tracked-channel registry, global cap, idle LRU eviction — many users of one channel = one IRC join/pipeline. _Satisfies:_ R9.2, design §7.3.
- [ ] **P6-4** Rate limiting: per-IP + per-device-token (Caddy `rate_limit` or Redis token bucket), hardest cap on `watch`. _Satisfies:_ design §7.4.
- [ ] **P6-5** pgbouncer + `analytics` API replicas behind Caddy (read path is stateless + cache-backed). _Satisfies:_ design §7.5–§7.6.
- [ ] **P6-6** Observability: BFF cache-hit ratio, poll RPS, tracked-channel count, `watch` rate, p95 BFF latency, IRC join count on the existing `pulse` Grafana profile; alerts on tracking cap + scraper saturation. _Satisfies:_ design §7.7.
- [ ] **P6-7** Chrome Web Store submission: privacy policy, permission justification (host_permissions, storage), screenshots from the Figma board.

**Exit:** an external user installs from the store, points at the hosted API over HTTPS, and the backend stays healthy under fan-out.

---

## Cross-cutting / Definition of Done

- [ ] Parity tests: extension Top Moments == web app for the same stream (shared `pulse-core`).
- [x] No console errors attributable to the extension on a normal channel page; no Twitch layout breakage.
- [ ] Honesty guardrails verified: backend-down shows error (not zeros); `< 5` rollups shows warming; optional lanes hide (not zero-fill); no "jump anywhere live"; Save Moment never auto-clips.
- [ ] `make check-quick` green in main repo for backend changes; extension CI green.
- [ ] Docs updated: `requirements.md`/`design.md`/`tasks.md` kept in sync; main-repo steering note if endpoints/symbols move (`make codegraph`).

---

## Suggested checks

```sh
# Backend
curl http://localhost:8090/v1/extension/health
curl http://localhost:8090/v1/extension/pulse/channels/<login>     # lanes + recap fields
curl -X POST http://localhost:8090/v1/pulse/bookmarks -H 'content-type: application/json' \
  -d '{"streamId":"319","offsetSeconds":4365,"label":"funny team wipe","source":"extension","score":95}'
curl http://localhost:8090/v1/pulse/streams/319/recap

# Shared logic parity
cd frontend && npm test -- liveHeat vodDeepLink
go test ./internal/analytics/...

# Extension
npm run typecheck && npm run test && npm run build   # in streamclone-pulse
```
