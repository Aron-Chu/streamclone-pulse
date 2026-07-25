# Streamclone Pulse Extension — Tasks

Execution plan for [`requirements.md`](./requirements.md) per [`design.md`](./design.md).

**Active program:** Reliability / Public Release (`RPR-*`) — canonical plan
[`reliability-public-release-plan.md`](./reliability-public-release-plan.md).

**Historical:** `P0`–`P6` below are retained as the original MVP ledger. Do not treat
stale P6 hosted claims (`api.streamclone.app`, device-auth blockers) as current
product truth — hosted API is already `https://api.streampulse.stream`. Public
visibility + store submission are gated by `RPR-9`, not by marking P6 `[x]`.

**Requirement IDs:** `R13` remains **Emote metadata readiness**. New RPR acceptance
targets are `R14`–`R18`.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done.

---

## RPR — Reliability & public release (active)

See phase detail and irreversible checkpoints in the reliability plan.

- [x] **RPR-0** Authoritative baseline + documentation consistency. Repair design/requirements/CONTEXT; add `release.md` + `ui-design-guide.md`; obsolete locked CWS candidate for upload; keep Privacy/Support truthful to current code; interim `privacy@` contact only. _Check:_ verified master `69b3575`; docs cross-link; local + remote force-full CI green.
- [x] **RPR-1** Request contract + performance (R14): request matrix tests; chart migration v2; content-owned poller + `pulseGetCoordinator` coalesce; Full gated behind explicit load; soft stale refresh; route sync maxWait; bundle budgets; Vite content rebuild on `closeBundle`. _Check:_ master `cf2ef08` (PR #46); remote force-full CI green (`30138875909`).
- [x] **RPR-2** Manifest targets (dev/CWS/Edge/Firefox-later) without localhost on store builds (R18); yauzl ZIP byte validation; store DCE; exact permission allowlists; distinct CWS/Edge ZIP names; portal localhost scanners; RPR-6 readiness note for sibling `file:` deps. _Check:_ master `cf2ef08` (PRs #44/#47); remote force-full CI green (`30138875909`). Do **not** upload store ZIPs yet.
- [ ] **RPR-3** Server-generated correlation IDs + sanitized extension diagnostics path (R15); default-off diagnostics consent; cost-bearing routes fail closed.
- [ ] **RPR-4** Hosted support form + Turnstile + durable outbox (R16); tracker gets minimal fields only; no remote challenge script in MV3.
- [ ] **RPR-5** Aggregate product analytics only after diagnostics/support paths are stable (R15); separate default-off consent; fixed enum events.
- [ ] **RPR-6** Move `pulse-core` / `pulse-charts` / `analytics-console` into `streamclone-pulse/packages` (R17) after license/provenance audit.
- [ ] **RPR-7** Governance files (LICENSE Apache-2.0, SECURITY, CONTRIBUTING, CoC, SUPPORT, CODEOWNERS, templates); audit branches/Actions/history before any visibility change.
- [ ] **RPR-8** Branch protection ruleset after stable green CI.
- [ ] **RPR-9** Owner-authorized publication / store submission only after all release gates.

**CI gate:** Remote workflow runs must execute jobs successfully on the release SHA. Owner must restore CI execution before remote green can gate RPR-9. Never make the repo public merely for free Actions.

**Contact blockers (RPR-0):** Only `privacy@streampulse.stream` is verified for public use today. Dedicated product-support and security mailboxes / GitHub Private Vulnerability Reporting remain unconfirmed and must not be published as active until verified.

---

## Historical — P0–P6 (original MVP ledger)

> Preserved for traceability. Prefer `RPR-*` for new work.

### P0 — Repo & shared-logic bootstrap

Goal: a new extension repo that builds, and a shared package the web app + extension both consume.

- [x] **P0-1** Create new repo `streamclone-pulse` (Aron-Chu/streamclone-pulse). MV3 scaffold (Vite + TS + React), `manifest.json`, CI (typecheck/test/build/zip). _Check:_ `npm run build` emits a loadable unpacked extension.
- [x] **P0-2** Extract pure helpers from `frontend/src/utils/` into `streamclone/packages/pulse-core` (`liveHeat.ts`, `vodDeepLink.ts`, `momentScoring.ts`, `momentScore.ts`, types). Keep existing unit tests (`frontend/tests/liveHeat.test.ts`, `vodDeepLink.test.ts`) green against the new path. _Satisfies:_ R3.2, R11.3. _Check:_ `cd frontend && npm test -- liveHeat vodDeepLink` passes after re-pointing imports.
- [ ] **P0-3** Publish `@streamclone/pulse-core` to GitHub Packages from main-repo CI; extension consumes it. Day-1: vendor via git submodule until first publish. _Check:_ extension imports `@streamclone/pulse-core` and typechecks.
- [ ] **P0-4** Decide registry + versioning (see design §10). Document in extension `README`.

**Exit:** extension builds and imports shared core; web app still passes its tests using the same package.

---

### P1 — Backend: extension BFF + health

Goal: one compact endpoint the overlay can render directly, plus a reachability probe. All in the existing `analytics` service (chi).

- [x] **P1-1** `internal/analytics/extension_api.go`: register `/v1/extension` route group; `GET /v1/extension/health` → `{ok,version,time}`. _Satisfies:_ R8.1. _Check:_ `curl http://localhost:8081/v1/extension/health`.
- [x] **P1-2** `GET /v1/extension/pulse/channels/{login}` BFF: assemble `isLive/tracking/streamId/vodId/currentOffsetSeconds/rollups/peaks` from existing store + heatmap scoring (reuse `deriveLiveHeat` logic / `heatmap.Cache`). _Satisfies:_ R3.1, R3.3. _Check:_ payload matches web app's "Most Reacted So Far" for the same stream.
- [x] **P1-3** Add `lanes{composite,chat,seventv,viewers?,keywords?}` (normalized 0–100, 1:1 with rollups) + `dominantSignal` per peak. Omit optional lanes when unavailable (no zero-fill). _Satisfies:_ R11.1–R11.4. _Check:_ unit test on lane derivation; viewers/keywords absent when source missing.
- [x] **P1-4** Redis-cache BFF payload 10–15s keyed `ext:pulse:{login}`. Implemented in `internal/analytics/extension_api.go` (12s TTL, `X-Cache: HIT|MISS` headers). _Satisfies:_ design §9. _Check:_ second request within TTL is a cache hit (`X-Cache: HIT`).
- [x] **P1-5** Confirm CORS for `chrome-extension://` origin (existing `httpx.CORS` `*`, no credentials in MVP) + OPTIONS 204. _Satisfies:_ R5, design §3. _Check:_ preflight + GET from a loaded extension succeed.

**Exit:** `curl …/v1/extension/pulse/channels/<live-login>` returns a renderable payload; cache hits logged.

---

### P2 — Extension core: detect, track, render (the MVP spine)

Goal: overlay appears on a live Twitch channel and shows real Pulse.

- [x] **P2-1** Content script channel detection: parse `twitch.tv/{login}`, VOD `videos/{id}`, live/offline/non-channel; debounce SPA nav; single-instance guard. _Satisfies:_ R1.1–R1.4. _Check:_ navigating channels updates one overlay, no duplicates.
- [x] **P2-2** Service worker API bridge: `chrome.runtime.sendMessage` router, typed messages, `host_permissions`, no direct fetch from content script. _Satisfies:_ R5.1. _Check:_ content script never issues cross-origin fetch (CSP-clean).
- [ ] **P2-3** Track request: `POST /v1/analytics/channels/{login}/watch` on enable; per-login dedupe + TTL; reflect backend tracking state. _Satisfies:_ R2.1–R2.3. _Check:_ repeated mounts don't spam `watch`.
- [ ] **P2-4** Poll loop: BFF at configurable interval (default 30s) + jitter, retry/backoff, cache latest in `chrome.storage.session`, re-hydrate on worker cold start. _Satisfies:_ R5.2–R5.4. _Check:_ kill+restart worker → overlay restores from cache then refreshes.
- [x] **P2-5** Mount overlay in Shadow DOM (isolated CSS), render heat strip + chat/min + 7TV/min + Top Moments via `pulse-core`; honesty title "Most Reacted So Far" + warming/incomplete-minute rules. Don't block player/chat. _Satisfies:_ R3.1–R3.5. _Check:_ no Twitch layout breakage; values match web app.

**Exit:** install unpacked → open a live channel → overlay shows live Pulse matching the web app.

---

### P3 — Overlay UX: modes, settings, lanes, seeking

- [x] **P3-1** Display modes: collapsed pill / mini (strip) / expanded; persist mode + dock across nav & sessions. _Satisfies:_ R4.1–R4.4.
- [x] **P3-2** Settings (options + popup): backend URL, polling interval (15/30/60s), overlay placement, auto-track policy. _Satisfies:_ R6.1–R6.4. _Check:_ changing backend URL re-probes health.
- [x] **P3-3** Per-signal lanes UI (`SignalLanes`): composite + chat + 7TV always; viewers/keywords only when present; mini mode = composite only. _Satisfies:_ R11.1–R11.5.
- [x] **P3-4** Click-to-peak / seeking: VOD deep link via `pulse-core` (`buildMomentJumpLink`/`buildVodDeepLink`); live in-buffer `<video>.currentTime` seek; out-of-buffer → `Replay after VOD` / `Open in Streamclone`; never "jump anywhere". _Satisfies:_ R7.1–R7.4. _Check:_ VOD lands within seconds; live out-of-buffer shows correct affordance.
- [x] **P3-5** Error/empty/offline states (`states/`): unreachable backend, warming (< 5 rollups w/ progress), offline + last-stream context. _Satisfies:_ R8.1–R8.3.
- [x] **P3-6** Past streams section (`PastVodsSection`): dense thumbnail + title rows below live Pulse content; metadata history + analytics merge via service worker; Analytics / Play VOD actions. _Satisfies:_ R8.3 follow-up. _Check:_ section visible while live and offline; current live row excluded when tracking.

**Exit:** the overlay matches the Figma board's expanded panel, lanes, modes, settings, and seek states.

---

### P4 — Moment memory / bookmarks (core Pulse)

Goal: private save queue, shared backend with the web app.

- [x] **P4-1** Migration `000038_pulse_bookmarks` (+ down). _Satisfies:_ R10 schema. _Check:_ `make` migrate up/down clean.
- [x] **P4-2** `internal/analytics/bookmarks.go`: CRUD store + handlers `GET/POST/PATCH/DELETE /v1/pulse/bookmarks` (cursor pagination; `source` in {web,extension}; never creates a clip). _Satisfies:_ R10.1–R10.3, R10.6. _Check:_ curl create/list/patch/delete.
- [x] **P4-3** Overlay `SavedMoments` UI: Save Moment from Top Moment rows, from current playhead, and from manual offset; saved list for current stream/VOD with Jump. _Satisfies:_ R10.1, R10.4.
- [x] **P4-4** Web app parity: `apps/web` lists the same bookmarks (single source of truth); `source` distinguishes origin. _Satisfies:_ R10.3, R10.5. _Check:_ a bookmark saved in the extension appears in the web app.

**Exit:** Save Moment works from the overlay and shows up in the web app; jumping a saved moment lands at the offset (VOD path once resolved).

---

### P5 — Session recap (core Pulse)

- [x] **P5-1** `internal/analytics/recap/` pure aggregation (mirror of `pulse-core/recap.ts`): top 10 moments, top emotes, biggest chat spike, funniest burst, clip candidates, totals, peak chat/min — from existing rollups/peaks. _Satisfies:_ R12.2, R12.5.
- [x] **P5-2** `GET /v1/pulse/streams/{streamID}/recap`: compute-on-demand first; optional cache table `000039_pulse_stream_recap` when read volume warrants. _Satisfies:_ R12.2. _Check:_ recap matches web app for the same stream.
- [x] **P5-3** Overlay transition: on `isLive:false` for a previously-live tracked stream, swap header to "Stream Recap"; distinct from offline/error (R8.3). Recap rows support Save Moment + Jump/VOD deep link. _Satisfies:_ R12.1, R12.3, R12.4.

**Exit:** when a tracked stream ends, the overlay flips to a recap whose ranking/totals agree with the web app.

---

## P6 — Hosted / public (HISTORICAL — superseded by RPR)

> **Do not execute as written.** Hosted TLS at `api.streampulse.stream` already exists.
> Remaining public/store work is `RPR-7`–`RPR-9`. Stale references to `api.streamclone.app`
> and "device auth blocks MVP" are obsolete for the public-first extension.

Goal (original): anyone can install. Infra notes lived in design §7.

- [x] **P6-1** **TLS + domain:** `https://api.streampulse.stream` is live (historical blocker cleared).
- [ ] **P6-2** Device auth — **deferred / not required** for public-first extension (no beta key).
- [~] **P6-3** Shared tracking pool / caps — capacity work continues under backend/ops; not an extension store blocker by itself.
- [~] **P6-4** Rate limiting — hosted/ops concern; track under backend/ops, not as extension P6 exit.
- [ ] **P6-5** pgbouncer + replicas — ops scaling; not RPR store gate.
- [~] **P6-6** Observability — extension diagnostics / aggregate analytics redesign under **RPR-3** / **RPR-5**.
- [ ] **P6-7** Chrome Web Store submission — **RPR-2** + **RPR-9** (prior locked ZIP obsolete for upload after privacy/manifest program changes).

**Exit (historical wording obsolete):** use reliability plan release gates instead.


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
curl http://localhost:8081/v1/extension/health
curl http://localhost:8081/v1/extension/pulse/channels/<login>     # lanes + recap fields
curl -X POST http://localhost:8081/v1/pulse/bookmarks -H 'content-type: application/json' \
  -d '{"streamId":"319","offsetSeconds":4365,"label":"funny team wipe","source":"extension","score":95}'
curl http://localhost:8081/v1/pulse/streams/319/recap

# Shared logic parity
cd frontend && npm test -- liveHeat vodDeepLink
go test ./internal/analytics/...

# Extension
npm run typecheck && npm run test && npm run build   # in streamclone-pulse
```
