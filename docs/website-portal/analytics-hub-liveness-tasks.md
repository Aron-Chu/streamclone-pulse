# Analytics hub liveness — implementation tasks

> Goal: make the public `/analytics` command center feel **live** by adding two always-alive elements to the existing StreamPulse hub: an animated **Top Emote Movers leaderboard race** and a **Live Wire moments feed**. Both reuse data already returned by `/v1/public/hub`; no new backend or data layer is required for the MVP.
>
> This document is written to be executed by an autonomous coding agent. Follow it literally: touch only the listed files (or narrowly related), respect the guardrails, and verify the acceptance criteria before marking a task done.

## Agent prompt (paste this to the auto agent)

> You are implementing two front-end features in the **streamclone-pulse** repo, app `streampulse-web` (Vite + React 18 + GSAP; TypeScript). The target page is the public analytics command center at route `/analytics`, rendered by `streampulse-web/src/routes/analytics/AnalyticsLandingPage.tsx`.
>
> Implement, in order:
> 1. **MOVERS-01** — replace the static "Top emote movers" pill strip with an animated leaderboard race (bars whose width encodes emote velocity, rows that reorder with FLIP motion when ranks change).
> 2. **WIRE-01** — add a "Live Wire" moments feed: a chronological, auto-updating list of network peak moments that animates new rows in on each poll.
>
> Hard rules:
> - **Backend is the source of truth.** Motion may only encode values already present in the hub payload (`topMovers[*].emotesPerMin`, `trendPct`; `livePulseMoments[*]`). Never compute scores, rankings, or peaks on the client.
> - **Honor reduced motion.** Read `motionEnabled` from `useAnalyticsMotion()` / `AnalyticsThemeProvider` (it is `!prefers-reduced-motion`). When motion is disabled, render a static, correctly-sorted result with no transforms or auto-scroll.
> - **Poll-based, not real-time.** "Live" means "per hub refresh". Label timing honestly (e.g. "detected in the last {window}", "12s ago"); never claim a websocket/real-time stream.
> - **Do not resurrect "Pulse Wire".** That was a removed news product. This is a metrics moments feed — different scope, different name.
> - Narrow diffs only; do not refactor unrelated code. Keep TypeScript strict (`npm run typecheck` clean).
> - Keep existing e2e honesty/parity tests green.
>
> Verify after each task: `cd streampulse-web && npm run typecheck && npm test`, then the e2e honesty + parity specs. Do not mark a checkbox `- [x]` until acceptance criteria and tests pass.

---

## Trust-audit addendum before implementation continues

The StreamPulse trust audit in `../../../twitch-7tv-clone/issues.md` does not block this liveness plan, but it adds guardrails that must be handled before the plan is considered done:

- **P1-005 stats fallback:** canonical `/analytics` must show unmistakable degraded copy when `hub.loadSource === "stats-fallback"` or `hub.hubEndpointOk === false`. Existing fallback banner behavior on the older dashboard home route is not enough.
- **P1-004 live wording:** movers/live rail copy must distinguish live roster/pool rows from actively IRC-collected tracked channels. Do not use the new animation to make roster-live or metadata-only rows look more authoritative than they are.
- **Live Wire source gating:** only `resolveLivePulseMoments(hub).source === "network"` may use live cadence copy, `NEW` badges, or GSAP enter animation. `featured_fallback`, `legacy_fallback`, `empty`, cache-only, or stats-fallback data must render static/degraded copy.
- **P2-015 hosted moments smoke:** final verification should include a hosted `/v1/public/hub/moments` response check so bucket/table/live moment rows do not silently fall back to stale or partially enriched data.
- **P3-023 console warning:** fix the React `fetchPriority` warning before treating the honesty/parity e2e specs as clean signal.

Concrete plan additions:

1. Add or reuse a degraded hub banner in `streampulse-web/src/routes/analytics/AnalyticsLandingPage.tsx` for `stats-fallback` / `hubEndpointOk === false`.
2. Extend tests so a forced hub failure with stats fallback still renders `/analytics` honestly and does not show Live Wire as network-live.
3. Keep `HubLiveWireFeed` tests asserting fallback sources never render `NEW` and never call GSAP.
4. Add the hosted moments smoke command to the final checklist.

---

## Shared context

**Stack / conventions**

- App root: `streampulse-web/` (run all `npm` commands there).
- Motion lib: **GSAP** (`gsap` `^3.15.0`, already a dependency). Reveal/stagger helpers live in `streampulse-web/src/ui/motion/useAnalyticsMotion.tsx` (`useAnalyticsMotion()`, `SectionReveal`). Prefer extending these over adding a new animation library.
- Reduced-motion gate: `AnalyticsThemeProvider` exposes `motionEnabled = !usePrefersReducedMotion()`; `useAnalyticsMotion()` re-exports `motionEnabled`. Every animation must early-return when it is `false`.
- CSS: hub styles live in `streampulse-web/src/ui/components/analytics/figma-analytics.css` (scoped under `.figma-analytics`). Reuse existing tokens: `--fma-panel`, `--fma-border`, `--fma-muted`, `--fma-mono`, `--fma-green`, `--fma-red`, `--sp-accent`, `--sp-accent-bg`.
- The page fetches once via `usePublicHubData({ enabled, activityWindow })`; data is normalized by `normalizePublicHub`. Re-renders happen on each poll — animate the **diff**, do not re-run entrance animations every poll.
- `usePublicHubData()` exposes `loadSource` and `hubEndpointOk`. Liveness UI must respect those fields: fallback stats can keep the page useful, but must not look like a healthy live hub.

**Verification commands**

```bash
cd streampulse-web
npm run typecheck          # tsc --noEmit — must be clean
npm test                   # vitest run
npm run test:e2e -- tests/e2e/analytics-hub-metrics-honesty.spec.ts tests/e2e/analytics-figma-parity.spec.ts --workers=1
```

Hosted moments smoke after local verification:

```bash
curl -fsS "https://api.streampulse.stream/v1/public/hub/moments?activityWindow=24h&bucketT=<unix_ms>&limit=10"
```

**Honesty guardrails (both tasks)**

- Motion encodes backend values only — no client-side scoring/ranking/peak detection.
- Respect `motionEnabled`; provide a static equivalent.
- Timing copy must be honest (poll cadence, relative "ago" labels).
- Stats-fallback/cache/fallback data must be labelled as degraded or static; never animate it like a network-live update.

---

## MOVERS-01: Top Emote Movers → live leaderboard race

- Area: portal / analytics hub UI
- Priority: P1
- Depends on: none
- Status: `- [x]` done

**Files likely touched**

- `streampulse-web/src/ui/components/analytics/HubLiveRailMoversStrip.tsx` (rewrite the render; keep the exported component name + props signature `{ movers: HubMover[]; loading?: boolean }`).
- `streampulse-web/src/ui/components/analytics/figma-analytics.css` (replace the `.hub-live-rail-movers*` block, currently ~L2547).
- `streampulse-web/src/ui/motion/useAnalyticsMotion.tsx` (optional: add a `reorderList(container, prevRects)` FLIP helper if you factor motion out).
- `streampulse-web/tests/analyticsLandingPage.test.tsx` (or a new `tests/hubLiveRailMovers.test.tsx`) for unit coverage.

**Data available** (`HubMover` in `streampulse-web/src/lib/publicHub.ts`)

- `login`, `displayName`, `category`, `profileImageUrl`
- `viewers`, `emotesPerMin` (all-provider), `seventvPerMin`, `chatPerMin`
- `trendPct` (signed momentum %), `trendSignal?`
- Existing formatter: `formatMoverVelocity(mover)` in `streampulse-web/src/ui/components/analytics/hubFormat.ts`.
- Rendered from `AnalyticsLandingPage.tsx` `section-live-rail` as `<HubLiveRailMoversStrip movers={topMovers.slice(0, 6)} loading={loadingInitial} />`.

**Implementation notes**

- Replace the flex-wrapped pills with a vertical **leaderboard**: one row per mover, sorted by emote velocity (keep backend order; do not re-sort by a client metric — the backend already ranks `topMovers`).
- Each row: rank number · avatar (`Avatar` from `../hub/primitives`) · name · a **horizontal bar** whose fill-width is proportional to that row's `emotesPerMin` relative to the max in the current set · the `formatMoverVelocity(mover).emoteLabel` value · a trend chip using `trendPct` (▲/▼/– with `--fma-green`/`--fma-red`/`--fma-muted`).
- Bar width = `emotesPerMin / maxEmotesPerMin` (clamp to a sensible min so tiny values are still visible). Animate width changes with `gsap.to(bar, { width, duration: 0.5, ease: 'power2.out' })` on data change.
- **Reorder animation (FLIP):** when the set order changes between renders, animate rows to their new positions. Prefer the GSAP Flip plugin (`import { Flip } from 'gsap/Flip'; gsap.registerPlugin(Flip)` — free in GSAP 3.12+). If you avoid the plugin, implement manual FLIP: capture `getBoundingClientRect()` of each row before update (store keyed by `login` in a ref), then after update invert with `transform: translateY(delta)` and `gsap.to(..., { y: 0, duration: 0.45, ease: 'power3.out' })`.
- Add a subtle rank-change delta indicator (e.g. `▲2`) computed from previous vs current index (this is presentation of order the backend already produced — allowed).
- Keep the loading skeleton (bars at 0 width / shimmer).
- **Reduced motion:** when `motionEnabled === false`, render final bar widths and final order immediately with no tweens, no FLIP, no delta flashes.
- Keep the outer `aria-label="Top emote movers"`; each row remains a `<Link to={/analytics/${login}}>`; preserve the `title` tooltip content.

**Acceptance criteria**

- The movers area renders as a ranked bar leaderboard; bar widths visibly correspond to `emotesPerMin`.
- On a data update where two movers swap rank, the rows animate to their new positions (verified manually and/or via a unit test asserting order + a motion hook call).
- With `prefers-reduced-motion: reduce`, the component renders the correct final order/widths and triggers **no** GSAP tweens.
- No client-side scoring: ordering comes from the incoming `movers` array; the component never sorts by a locally computed score.
- `npm run typecheck` clean; existing e2e honesty + parity specs still pass.

**Tests**

- Unit (`vitest` + React Testing Library): render with a mock `movers` array; assert rows appear in the given order, bar widths are proportional, and trend chips reflect `trendPct` sign. Render with `motionEnabled=false` (wrap in provider or mock `useAnalyticsMotion`) and assert no motion side-effects.
- Re-run: `npm run test:e2e -- tests/e2e/analytics-hub-metrics-honesty.spec.ts tests/e2e/analytics-figma-parity.spec.ts --workers=1`.

---

## WIRE-01: Live Wire — network moments feed

- Area: portal / analytics hub UI
- Priority: P1
- Depends on: MOVERS-01 (soft — share the motion helper; can proceed independently)
- Status: `- [x]` done

**Files likely touched**

- `streampulse-web/src/ui/components/analytics/HubLiveWireFeed.tsx` (new component).
- `streampulse-web/src/ui/components/analytics/figma-analytics.css` (new `.hub-live-wire*` block).
- `streampulse-web/src/routes/analytics/AnalyticsLandingPage.tsx` (render the feed in a new `SectionReveal id="section-live-wire"`, placed after `section-live-rail` and before `section-network`).
- `streampulse-web/tests/hubLiveWireFeed.test.tsx` (new unit test).

**Data available**

- `hub.livePulseMoments` (already on `PublicHub`), mapped to `FigmaMomentRow` via `mapHubPulseMoment` (`streampulse-web/src/lib/figmaSessionAnalytics.ts`). Backend struct `HubLivePulseMoment` (`twitch-7tv-clone/internal/analytics/hub_live_pulse_moments.go`) provides per row: `login`, `displayName`, `profileImageUrl`, `category`, `kind` (`chat` / `emotes` / `stream_opening`), `label`, `score`, `confidence`, `chatPerMin`, `emotesPerMin`, `viewers`, `viewerDelta`, `topEmoteCode`, `topEmotes[]`, `at` (unix ms), `offsetSeconds`, `streamId` / `vodId`.
- Feed resolver: `resolveLivePulseMoments(hub)` returns `{ source, moments, ... }`; only treat it as a live network feed when `source === 'network'`. For other sources (`featured_fallback`, `legacy_fallback`), render the moments statically without "new item" animation and without implying live cadence.
- Stable identity for diffing: `momentRowKey(moment)` (`figmaSessionAnalytics.ts`).
- Emote images: resolve via the existing emote URL helper used elsewhere in the panel (`enrichPulseMomentRows` / `buildEmoteLookupFromMoments` in `streampulse-web/src/lib/pulseMomentRow.ts`) so relative `/emotes/...` paths get the correct asset base.

**Implementation notes**

- New self-contained component `HubLiveWireFeed` that takes the resolved feed (reuse `resolveLivePulseMoments(hub)` or accept a `feed` prop like `PulseMomentsLivePanel`) and renders a vertical list of moment cards, newest first (sort by `at` desc; fall back to `offsetSeconds`).
- Card contents: `kind` chip with an icon (chat spike / emote spike / just went live — map `stream_opening` → "Just went live"), avatar + display name + category, a one-line headline from `label` plus the strongest metric (`chatPerMin` or `emotesPerMin`), up to ~3 `topEmotes` rendered as images, and a **relative timestamp** ("12s ago") derived from `at` that re-renders on a 1s interval (single `setInterval`, cleared on unmount).
- Each card is a link → `buildAnalyticsHref({ login, streamId, offsetSeconds })` (use the same helper `mapHubPulseMoment` already uses) so it deep-links into the VOD moment.
- **New-item animation:** keep a ref of previously-seen `momentRowKey`s. On each poll, entries whose key was not seen before animate in at the top (`gsap.from(el, { height: 0, opacity: 0, y: -8, duration: 0.4, ease: 'power3.out' })`) with a brief "NEW" pulse. Cap the visible list (e.g. 8–10) and let old rows drop off.
- **Noise control:** de-duplicate by `login` within a short window if the same channel produces repeated peaks, and cap how many new cards animate per poll (e.g. 3) so the feed never floods/flickers.
- **Empty / warming state:** when there are no network moments, show the honest reason (reuse the `EMPTY_REASONS`-style copy pattern from `PulseMomentsLivePanel.tsx`), not a blank box.
- **Reduced motion:** when `motionEnabled === false`, render the list in final order with no enter animation and no "NEW" pulse; the relative-time ticker may remain (it's text, not motion) or update on poll only.
- Honesty label in the header: e.g. "Live wire · detected in the last {activityWindow}" — never "real-time".
- Placement: render inside `AnalyticsLandingPage.tsx` as its own `SectionReveal`. Do **not** restructure `AnalyticsFigmaShell`. (Optional enhancement, only if trivial: on wide viewports, a `position: sticky` wrapper — but do not add a new shell grid column in this task.)

**Acceptance criteria**

- A "Live Wire" feed section renders on `/analytics` with moment cards sourced from `hub.livePulseMoments`, newest first, each deep-linking to the channel/VOD moment.
- On a poll that introduces a new moment, that card animates in at the top; unchanged cards do not re-animate.
- With `prefers-reduced-motion: reduce`, the feed renders correct content and order with no enter animation / no auto-motion.
- When the resolved feed `source !== 'network'` (fallback) or is empty, the component shows the appropriate static / empty-reason state and does not imply live cadence.
- No client-side scoring or peak detection; the component only presents backend `livePulseMoments`.
- `npm run typecheck` clean; existing e2e honesty + parity specs still pass.

**Tests**

- Unit (`vitest` + RTL): render with a mock `livePulseMoments` set; assert cards render newest-first with kind chips, metrics, emote images, and correct hrefs. Simulate a re-render adding a new moment and assert the new key is treated as "new" (motion hook invoked) while existing ones are not. Render with `motionEnabled=false` and assert no enter animation is triggered. Render an empty feed and assert the empty-reason copy.
- Re-run: `npm run test:e2e -- tests/e2e/analytics-hub-metrics-honesty.spec.ts tests/e2e/analytics-figma-parity.spec.ts --workers=1`.

---

## Definition of done (both tasks)

- [x] MOVERS-01 acceptance criteria + tests pass.
- [x] WIRE-01 acceptance criteria + tests pass.
- [x] `npm run typecheck` clean; hub liveness unit tests + `analyticsLandingPage` tests green.
- [x] e2e honesty+parity: all 17 specs pass (parity uses `#section-live-wire`; `fetchPriority` warning removed).
- [x] Stats-fallback/degraded hub state visible on canonical `/analytics` via `HubDataHealthBanner`; Live Wire gated when `hubEndpointOk === false` or `loadSource === 'stats-fallback'`.
- [x] Hosted `/v1/public/hub/moments` smoke run 2026-07-06 — endpoint requires `bucketT`; sample returned `status: empty`, `reason: no_corpus_peaks_in_bucket` (healthy empty, not 5xx).
- [ ] Manual check at `/analytics`: movers reorder with motion; new moments slide into the Live Wire; both degrade to static under `prefers-reduced-motion`.
- [ ] Manual fallback check: mock or force `hubEndpointOk: false` / `loadSource: 'stats-fallback'` in browser devtools (unit tests cover this path).
- [x] Diff is scoped to the files listed; no unrelated refactors; "Pulse Wire" scope not reintroduced.

### Hosted moments smoke (2026-07-06)

The moments endpoint requires `bucketT` (not just `limit`):

```bash
curl -fsS "https://api.streampulse.stream/v1/public/hub/moments?activityWindow=24h&bucketT=<unix_ms>&limit=10"
```

Smoke with `bucketT=1` returned HTTP 200, `status: empty`, `reason: no_corpus_peaks_in_bucket` — API reachable; empty bucket is expected for a synthetic timestamp.
