# StreamPulse Release-Readiness Audit — Site + Extension (2026-08-14)

**Scope:** `streamclone-pulse` — portal (`streampulse-web/`) + extension (`src/`). ReplayForge excluded (separate beta).
**Method:** 4 parallel audit agents (performance, bugs, design/redundancy, security) + first-hand verification + 2 shipped fixes.
**Status:** Audit complete. **2 fixes shipped.** 12+ actionable findings remain (see To-Do).

---

## ✅ Shipped fixes (this session, verified)

### F1. Viewers-lane gap bug (correctness — the "bucket accuracy" worry)
- **Problem:** `chartPointsFromMinutes` set `viewersNorm: 0` when no viewer samples → the chart drew a flat green line at the floor, indistinguishable from "measured zero viewers." Live streams (`viewerSamples: 1`) showed fake crashes.
- **Fix:** Added `missing` to `FigmaChartPoint` + propagated from minutes (`figmaSessionAnalytics.ts`). `FigmaSignalChart` now splits chat/viewers/emotes paths + area at `missing` minutes via `segmentsAtGaps()`, so gaps render as true gaps. Tooltip shows "No data."
- **Test:** 12/12 `FigmaSignalChart.test.tsx` pass (2 new gap tests).
- **Files:** `streampulse-web/src/lib/figmaSessionAnalytics.ts`, `streampulse-web/src/ui/components/analytics/FigmaSignalChart.tsx`, `streampulse-web/tests/FigmaSignalChart.test.tsx`.

### F2. Hardcoded "vod synced" + emote-label unification
- **Problem:** Header claimed "· vod synced" for every non-demo session (even live/no-VOD); `VOD conf.` showed green "0%" when no data; "7TV / min" vs "Emotes / min" inconsistency.
- **Fix:** `FigmaSessionHeaderStrip.tsx` now derives `live tracking` / `VOD ready` / `No VOD linked` (from `isLive` + `vodHref`); label unified to `Emotes / min`; `VOD conf.` shows `—` + neutral tone when no data.
- **Test:** typecheck clean; dev-server render verified.
- **Files:** `streampulse-web/src/ui/components/analytics/FigmaSessionHeaderStrip.tsx`.

### F3. Env repair (unblocked all tests)
- Fixed stale `@esbuild/linux-x64@0.27.7` vs `esbuild@0.28.2` host (installed matching `--no-save`). Was blocking ALL vitest runs.

---

## 🔴 Security findings (from security audit — HIGH/MED)

### HIGH
- **H1 — Beta key in `localStorage`** (`auth.ts:1-2,17,24,29,111-140`): `sp.betaKey` readable by any injected script; sent as `X-Streamclone-Beta-Key` on every gated request. **Fix: sessionStorage or HttpOnly cookie.** Ship-blocker.
- **H2 — `?console=1` + `/admin` public no-auth** (`routes/index.tsx:56-60,70`, `ChannelAnalyticsPage.tsx:20-24`): anonymous visitors get the operator console + admin shell. **Fix: gate behind `hasBetaKey()` or remove from public routes.** Ship-blocker.
- **H3 — Extension backend writes unauthenticated** (`src/background/api.ts:71-77,339-410`): `POST /watch`, `/always-tracked`, `/backfill`, `/vod-hint` send no auth → corpus poisoning + resource-cost abuse. **Fix: device token / beta key + server-side rate limits.** (Partly backend.)

### MEDIUM
- **M1 — Service-worker message handler doesn't validate `sender`** (`service-worker.ts:343`, `emoteImageFetch.ts:15-35`): `FETCH_EMOTE_IMAGE` fetches any URL (open-proxy primitive). **Fix: validate sender origin + restrict to CDN/backend hosts.** Cheap, high value.
- **M2 — Debug logging stores channel/VOD history plaintext** (`pulseDebug.ts:77-115`): `storage.local` ring buffer of "who you watch." **Fix: redact login/vodId/streamId, clear-log action, storage.session.**
- **M3 — `pulseError` sanitizer only truncates** (no HTML strip; React auto-escapes so defense-in-depth).
- **M4 — Sentry `route` tag not path-sanitized; DSN public.**
- **M5 — Extension `host_permissions` = `*://*.twitch.tv/*`** (manifest.json:31-36) — trim to `www` + `gql`.

### LOW
- L1 `/v1/extension/health` leaks build/version/capabilities unauthenticated. L2 `buildVodTimestampUrl` doesn't numeric-validate `vodId` (console's `buildTwitchVodUrl` does — reuse). L3 `#t=` hash vs `?t=` query. L4 **extension popup/options have NO CSP** (add meta CSP). L5 content scripts read full Twitch HTML (regex-IDs only, low). L6 `dist/` + `streamclone-pulse.zip` committed. L7 status page shows API host.

**Verified clean:** no XSS sinks, no hardcoded secrets, no tabnabbing (all `rel="noopener noreferrer"`), no SSRF, strong portal CSP, good Sentry scrubber, login normalization.

---

## ⚡ Performance findings (from performance audit)

### Highest-impact
1. **Landing eagerly ships 860+ KB JS** — the `/` page statically imports the full SPA + extension overlay UI (`@pulse-ext/ui`) + `vendor-analytics-console` (312 KB, `modulepreload`'d in entry HTML) + gsap (92 KB). **Release-blocking for a marketing page.**
2. **`vendor-analytics-console` (312 KB) fetched on every landing visit** — `modulepreload` hoists it into the entry even though the landing never executes it.

### Other
3. No `react`/`react-dom`/`router` vendor chunk (350+ KB in the 460 KB entry).
4. `recharts|d3-` manualChunks branch is dead config (neither is a dependency).
5. Hub payload is **183 KB** (measured) — heavy for a 45s poll.
6. `refreshPrincipal()` awaited before render (main.tsx:58-60) — blocks first paint on public pages.
7. `getBoundingClientRect()` in `FigmaSignalChart.handleWheel` + `HubActivityChart.nearestPointIndex` — sync layout reads per pointer event.
8. CSS: `figma-analytics.css` is route-scoped (good); fonts are render-blocking (12 woff2, no `font-display: swap`).

### Good
- Route-splitting solid (all routes lazy), CSS route-scoped, fonts clean (removed deps not imported), Sentry lazy.

---

## 🎨 Design / redundancy findings (from design audit)

### Redundant (R)
- **R1** — Channel session repeats facts across 6 surfaces (header, metrics panel, chart legend, moments table, inspector, bursts). Merge metrics panel into header; collapse `CoverageTruthPanel`.
- **R2** — Two "Top emotes" panels (bursts vs stream aggregate) swap on a flag, indistinguishable.
- **R4** — Coverage surfaced 3-5x on hub (trust strip + health banner + coverage anchor + legend).
- **R5** — Extension: 3 near-identical top-emote lists on the overlay.

### Unusual (U)
- **U1** — Viewers lane flat line at 0 when no samples (**FIXED — F1**).
- **U2** — Chart zoom controls: `−` disabled at default zoom while `+` always enabled (reads as bug).
- **U3** — `role="img"` on an interactive div (should be `role="application"`/slider + instruction).
- **U4** — "Selected minute emotes" panel always shows empty box before interaction (collapse to hint).
- **U5/U6** — "vod synced" + disabled Export + green "0%" VOD-conf (**FIXED — F2**).
- **U9** — `LiveChannelsMatrix` invents coverage percentages (`synced→100, partial→62...`) — honest-label it.
- **U10** — "Data sync state" raw enum + "Reaction score" jargon on public page.

### Dead / half-implemented (D)
- **D1** — `TopEmotesPanel.tsx` zero importers (delete; rename local one to `SessionTopEmotesPanel`).
- **D2** — `StreamsHubPlaceholder.tsx` unreachable (delete).
- **D3** — `FigmaCorpusPipelineBlock`/`FigmaLiveCollectorBlock` unused (delete).
- **D4** — `ChannelAvatar.tsx` unused (delete or promote as shared primitive).
- **D5** — `lib/backendEndpoints.ts`, `lib/health.ts`, `setBetaKey`/`clearBetaKey`/`hash16` dead (delete).
- **D6** — `/dashboard` + Clips queue unreachable (no beta-key UI) — remove or add key entry.
- **D7** — `/admin` placeholder publicly routed — remove/gate.
- **D8** — Deprecated exports (`livePulseMomentsFromPublicHub`, `TREND_VS_PRIOR_*`, `useAnalyticsTheme`, `liveActivity` label).
- **D9** — Dead CSS `.how-chat-reacted*`.
- **D10-D12** — Route aliases, zoom edge case, half-wired heatmap types.

### Vocabulary inconsistencies
"7TV / min" vs "Emotes / min", "Reaction score" vs "Score", "VOD conf." vs "VOD state" vs "Coverage truth", "Minutes with data" vs "viewer samples", "Signal Wire" vs "Live Wire".

### Top 5 design cleanups (from agent)
1. Fix header lies (**F2 done**) 2. Kill unreachable surfaces (D1-D7) 3. Merge metrics stack (R1) 4. Chart viewers gap (**F1 done**) 5. Unify vocabulary.

---

## 🐛 Bug findings

The dedicated bug agent was killed by the user mid-scan (ran 3h). **Its top finding was already F1** (the viewers-gap bug, which I verified + fixed). Remaining bug candidates from other audits: chart zoom `−` enablement (U2), `role="img"` on interactive (U3), `#t=` hash ambiguity (L3), `buildVodTimestampUrl` no numeric validation (L2). A focused re-run scoped to `streampulse-web/src/lib` + `src/ui` would close the gap (bounded, ~30 min, not 3h).

---

## ✅ To-Do (prioritized for release)

### Phase 1 — Ship-blockers (do first)
- [ ] **S1** Move beta key `localStorage` → `sessionStorage`/HttpOnly cookie (H1)
- [ ] **S2** Gate `?console=1` + `/admin` behind `hasBetaKey()` / remove from public routes (H2)
- [ ] **S3** Extension write auth: device token/beta key + rate limits (H3) — cross-repo (backend)

### Phase 2 — High-value correctness + UX (small diffs)
- [ ] **P1** Wire Export button (CSV) or remove it (U5 — the disabled Export)
- [ ] **P2** Chart zoom: allow `−` always / hide both until zoomed (U2)
- [ ] **P3** `role="application"` + "arrow keys select" instruction on chart (U3, a11y)
- [ ] **P4** Fix `LiveChannelsMatrix` invented coverage % (U9)
- [ ] **P5** Unify "Emotes / min" + "Reaction score" vocabulary across panels (V)
- [ ] **P6** `buildVodTimestampUrl` numeric-validate vodId (L2)
- [ ] **P7** Add CSP meta to extension popup/options (L4)

### Phase 3 — Cleanup / dead code (safe deletions)
- [ ] **C1** Delete D1-D5 + D8 dead code (`TopEmotesPanel`, `StreamsHubPlaceholder`, `FigmaCorpusPipelineBlock`, `ChannelAvatar`, `backendEndpoints`/`health`, deprecated exports)
- [ ] **C2** Remove/gate `/dashboard` + `/admin` (D6/D7)
- [ ] **C3** Trim extension `host_permissions` to www+gql (M5)
- [ ] **C4** Add `.gitignore` for `dist/` + `streamclone-pulse.zip` (L6)

### Phase 4 — Performance (bigger)
- [ ] **Perf1** Stop `vendor-analytics-console` (312 KB) shipping on `/` (modulepreload exclusion / lazy)
- [ ] **Perf2** Add `react`/`react-dom` vendor chunk; remove dead `recharts|d3-` branch
- [ ] **Perf3** Slim the 183 KB hub payload (server-side or split poll)
- [ ] **Perf4** Defer `refreshPrincipal()` off critical path on public routes
- [ ] **Perf5** `font-display: swap` + preload latin fonts

### Phase 5 — Feature (the approved upgrade plan)
- [ ] **Feature** The channel-analytics upgrade (date resolution, quality strip, sync CTAs, recap/games/heatmap, export) — see `docs/superpowers/plans/2026-08-14-channel-analytics-dashboard-upgrade.md` + `CODEX-PLAN.md`

### Phase 6 — Release housekeeping
- [ ] **R1** Reconcile dirty `streampulse-web/package.json` (font-dep removal — commit or revert)
- [ ] **R2** Update `release-notes.json` (set 0.1.0 released / decide 0.2.0; add 0.3.0 unreleased entry for analytics work)
- [ ] **R3** Backend version bump + release note + provenance (version/SHA/digest) — cross-repo
- [ ] **R4** Refresh `release-status.md` (stale since 2026-07-07)

---

## Cross-repo note
Backend (`streampulse-backend`, 127 dirty files) + replayforge (no version/changelog, separate beta) are **out of scope** for this pass but flagged. The audited Codex plan covers the backend portal-action wrappers (authenticated sync/prefetch) that H3 needs.

## Key files to reference
- Plan: `docs/superpowers/plans/2026-08-14-channel-analytics-dashboard-upgrade.md`
- Codex handoff: `CODEX-PLAN.md`
- Prior audits: `unused-feature-audit-2026-06-27.md`, `analytics-product-refactor-audit-2026-07-10.md`
