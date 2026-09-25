# Live Wire responsive sticky right rail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Live Wire (the hub-landing "Pulse Wire") from a chart-attached horizontal lane into a responsive sticky right-rail catch-moment radar with detailed callout cards, tiered "Live now" + "Older retained" freshness, poll-identity-gated NEW, and sibling analytics/VOD actions.

**Architecture:** Move pure logic into testable `src/lib/liveWire.ts` + `src/lib/momentActions.ts`. Add a landing-only `rightRail` slot to the shell — a **single** rail child placed by CSS grid across every breakpoint (col 3 at ≥1440, row 2 beside the center at 1100–1439, row 2 below at <1100) — so Live Wire is **mounted exactly once**. Rework `HubLiveWireFeed` (`layout="rail"`) with cards, tiering, hard NEW gating, and sibling actions. Delete the obsolete lane. Rewrite the unit test + replace the opposite E2E specs; update docs.

**Tech Stack:** React 18 + Vite, TypeScript, GSAP (`useAnalyticsMotion`), `react-router-dom`, Vitest (jsdom), Playwright E2E.

## Global Constraints

- **Naming:** This surface is **Live Wire**. Do NOT use "Pulse Wire" in any new/edited copy on the hub landing (rename sidebar entry + `WireHeader` label). No-resurrection rule.
- **No backend change:** Reuse `LivePulseMomentsResult` / `resolveLivePulseMoments` only. No new fields, no new fetching.
- **No missing-vs-zero distinction:** backend numeric fields use `omitempty`, so absent == zero on the wire → both render as unavailable ("—", no bar).
- **Never `position: fixed` for the rail** — sticky grid child only.
- **Never `href="#"`** — render a disabled state when no analytics/VOD target exists.
- **No client-side derived score** — display backend `moment.score` only if present.
- **NEW is HARD-gated:** requires `feed.source === "network"` **AND** `loadSource === "full"` **AND** `hubEndpointOk === true`. `!isHubNetworkDegraded(...)` alone is insufficient (cache/pending are not classified degraded).
- **Single landmark:** the rail is ONE `<aside aria-label="Live Wire">` at the shell level; the cards inside are `<ul role="list"><li role="listitem"><article>` — do NOT nest another `<aside>` or `<section role="region">` inside the rail.
- **Single mount:** `HubLiveWireFeed` is rendered once and repositioned by CSS grid; never mount a second copy as a fallback.
- **Reduced motion:** suppress entrance animation; retain the semantic `NEW` label.
- **No nested interactive controls:** moment card is a non-interactive `article` with sibling action links/buttons.
- **Dirty worktree policy:** the worktree contains extensive unrelated uncommitted changes (mostly `packages/analytics-console` + `packages/pulse-charts`). **Do NOT run automatic whole-file `git add` + `git commit` steps.** Stage only the specific intended files, review the staged set, and get explicit user approval before every commit.
- **Commands scoped:** runtime checks as `npm --prefix streampulse-web run typecheck` and `npm --prefix streampulse-web run check:<name>` / `npm --prefix streampulse-web exec node scripts/<name>.mjs`. E2E: `npm --prefix streampulse-web run test:e2e:analytics-local`.
- **Unit test location:** `streampulse-web/tests/*.test.ts(x)` (vitest jsdom, globals). E2E: `streampulse-web/tests/e2e/`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/lib/liveWire.ts` (new) | Pure logic: `resolveMomentAtMs`, `classifyMomentWindow`, `normalizeRatePct`, `dedupeMomentsByLogin`, `capNewKeysPerPoll`. |
| `src/lib/momentActions.ts` (new) | `resolveMomentActions(moment)` → analytics/VOD hrefs + disabled reason (inspector model). |
| `src/ui/motion/useAnalyticsMotion.tsx` | Right-entry option on `animateEnterHorizontal` (default left, backward compatible). |
| `src/ui/components/analytics/FigmaGlobalActivityPanel.tsx` | Remove lane + annotation-only props (`annotationFeed`/`annotationLoading`/`annotationHubEndpointOk`/`annotationLoadSource`/`annotationActivityWindow`); drop `HubLiveWireFeed` import. |
| `src/ui/components/analytics/AnalyticsFigmaShell.tsx` | Add `rightRail?: ReactNode`; `--with-right-rail` frame modifier. |
| `src/ui/components/analytics/figma-analytics.css` | Grid placement at all breakpoints, sticky rules, and **all rail-card styles** (cards, twin bars, actions, disclosure, list spacing, focus-visible). |
| `src/ui/components/analytics/HubLiveWireFeed.tsx` | Rework to `layout="rail"`: cards, tiering, hard NEW gating, sibling actions, `aria-expanded` disclosure; **delete** `layout="lane"` branch + stale annotation/selection props + `isLiveWireEventFresh` (replaced by `classifyMomentWindow`). |
| `src/routes/analytics/AnalyticsLandingPage.tsx` | Wire `pollSequence`+`loadSource` into `liveWireFeedProps`; drop lane/annotation props from `FigmaGlobalActivityPanel`; render the single rail via shell `rightRail`; make sidebar entry action-only. |
| `src/ui/components/analytics/AnalyticsHubSidebar.tsx` | Make the Live Wire entry non-observed/action-only (exclude from IntersectionObserver) and rename label. |
| `tests/liveWireUtils.test.ts` (new) | Unit tests: classifier, normalization, dedupe, cap. |
| `tests/momentActions.test.ts` (new) | Unit tests: action resolver. |
| `tests/hubLiveWireFeed.test.tsx` (**rewrite**) | Replace assertions that lock the old lane/outer-link/animation/30m-omission behavior with the rail contract. |
| `scripts/check-analytics-links.mjs` | Align to canonical `/analytics/{channel}/{streamId}` form (it currently emits `/s/{streamId}`). |
| `tests/e2e/analytics-hub-live-wire-ticker.spec.ts` + 3 others | Replace opposite-contract assertions. |
| `docs/superpowers/specs/2026-08-18-pulse-wire-right-rail-design.md` | Fix stale `/s/{streamId}` claim; align to canonical route. |
| `docs/website-portal/analytics-command-center-layout.md` | Mark hub-landing lane contract superseded. |
| `docs/website-portal/analytics-hub-liveness-tasks.md`, `analytics-product-refactor-audit-2026-07-10.md` | Update naming + lane references. |

**Task order note:** Task 8 defines `layout="rail"` + all new component behavior; Task 9 (landing wiring) consumes it; Task 10 (shell slot + grid + CSS) is where the single-mount placement is wired. Compile gates are defined in the task that introduces the type, and Tasks that consume a not-yet-defined symbol are ordered after it.

---

### Task 1: Pure timestamp classifier + bar normalization (`liveWire.ts`)

**Files:**
- Create: `src/lib/liveWire.ts`
- Test: `tests/liveWireUtils.test.ts`

**Interfaces:**
- Produces:
  - `resolveMomentAtMs(at?: number): number | null`
  - `classifyMomentWindow(at: number | undefined, now: number, windowMs: number): 'live' | 'older' | 'omit'`
  - `normalizeRatePct(rate: number | undefined, maxRate: number): string | null`
  - `dedupeMomentsByLogin<T extends { login?: string; at?: number }>(items: T[], cap: number, windowMs: number): T[]`
  - `capNewKeysPerPoll(elements: { key: string; at?: number }[], seen: Set<string>, now: number, windowMs: number, maxNew: number): Set<string>`

- [ ] **Step 1: Write the failing test** (see file `tests/liveWireUtils.test.ts` — classifier boundaries inclusive at exactly 30m, older past it, omit for missing/invalid/non-positive/future; normalize pct within a max, null for missing/zero/non-positive max; dedupe drops a login within the window and honors cap; cap returns max fresh+unseen keys).
- [ ] **Step 2: Run to verify it fails** — `npm --prefix streampulse-web run test -- liveWireUtils`
- [ ] **Step 3: Write minimal implementation** (as in the verified design: `resolveMomentAtMs` seconds→ms, reject null/non-finite/≤0; `classifyMomentWindow` omit when `ms==null||ms>now`, live when `now-ms<=windowMs` else older; `normalizeRatePct` null when rate missing/≤0 or max≤0 else `"${round(min(100,rate/max*100))}%"`; dedupe by login with `Math.abs(at-last)<windowMs` skip, cap; capNewKeys returns unseen keys within window up to maxNew, skipping lifecycle kinds upstream).
- [ ] **Step 4: Run to verify it passes** — `npm --prefix streampulse-web run test -- liveWireUtils`
- [ ] **Step 5: Stage + get approval to commit** (only `src/lib/liveWire.ts` + `tests/liveWireUtils.test.ts`).

---

### Task 2: Shared moment action resolver (`momentActions.ts`)

**Files:**
- Create: `src/lib/momentActions.ts`
- Test: `tests/momentActions.test.ts`

**Interfaces:**
- Consumes: `buildAnalyticsHref` (`src/lib/analyticsLinks`), `buildVodTimestampUrl` (`src/lib/figmaSessionAnalytics`), `FigmaMomentRow`.
- Produces: `interface MomentActions { analyticsHref?: string; vodHref?: string; disabledReason?: string }`, `resolveMomentActions(moment: FigmaMomentRow): MomentActions`.

- [ ] **Step 1: Write the failing test** — prefers `moment.href`; falls back to `buildAnalyticsHref({login,streamId,offsetSeconds})` → canonical `/analytics/{channel}/{streamId}#t={offset}`; `vodHref` only when `vodId` set (`https://www.twitch.tv/videos/{vodId}?t={offset}s`); when neither resolves, `disabledReason` set and **no `'#'`**.
- [ ] **Step 2: Run to verify it fails** — `npm --prefix streampulse-web run test -- momentActions`
- [ ] **Step 3: Write minimal implementation** (inspector model: `analyticsHref = moment.href ?? (login ? buildAnalyticsHref({...}) : undefined)`; `vodHref = moment.vodId ? buildVodTimestampUrl(...) : undefined`; if neither, `{ disabledReason: 'Live tracking only' }`).
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Stage + approve commit** (only the two files).

---

### Task 3: Directional right-entry motion option

**Files:**
- Modify: `src/ui/motion/useAnalyticsMotion.tsx:102-108`

**Interfaces:**
- Produces: `buildDirectionalX(from: 'left' | 'right' | undefined): number` (`-24` / `24` / default `-24`) and `animateEnterHorizontal(el, opts?: { from?: 'left' | 'right' })` (default left, backward compatible).

- [ ] **Step 1: Append failing test** for `buildDirectionalX` (undefined/left → -24, right → 24) to `tests/liveWireUtils.test.ts` (pure helper; verifies without gsap).
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement** — export `buildDirectionalX` and update `animateEnterHorizontal` to use `buildDirectionalX(opts?.from)`.
- [ ] **Step 4: Run to verify it passes.**
- [ ] **Step 5: Stage + approve commit** (motion file + test file).

---

### Task 4: Obsolete lane removal — panel + component branch deletion

**Files:**
- Modify: `src/ui/components/analytics/FigmaGlobalActivityPanel.tsx`
- Modify: `src/ui/components/analytics/HubLiveWireFeed.tsx` (remove `layout="lane"` branch + `isLiveWireEventFresh` + `live-wire--lane`/ticker-lane CSS classes; **defer** the `layout="rail"` branch to Task 8 so the file stays compiling)

**Interfaces:**
- Consumes: nothing new.
- Produces: `FigmaGlobalActivityPanel` no longer takes `annotationFeed`/`annotationLoading`/`annotationHubEndpointOk`/`annotationLoadSource`/`annotationActivityWindow`; `HubLiveWireFeed` no longer imports/emits `isLiveWireEventFresh`.

- [ ] **Step 1: Compile gate** — `npm --prefix streampulse-web run typecheck` FAILS after you delete the annotation props from `FigmaGlobalActivityPanel` while `AnalyticsLandingPage` still passes them (red first).
- [ ] **Step 2: Run to confirm the expected red.**
- [ ] **Step 3: Make the change** — delete the annotation-lane JSX block (lines ~501–515) and the annotation-only props/types from `FigmaGlobalActivityPanel` and its `AnalyticsLandingPage` call site (lines ~575–579); delete the `layout === 'lane'` branch, `isLiveWireEventFresh`, and unreferenced lane helpers in `HubLiveWireFeed.tsx`; delete the now-unreferenced `hub-live-wire--lane`/`hub-live-wire--ticker` CSS blocks.
- [ ] **Step 4: Run `typecheck` → PASS; run `npm --prefix streampulse-web run test` (the rewritten unit test from Task 8 lands later; the existing `hubLiveWireFeed.test.tsx` will be broken at this point — see Task 8 ordering note: run this task's check as `typecheck` only, and complete the test rewrite in Task 8 before the final green).**
- [ ] **Step 5: Stage + approve commit** (the two component files + CSS).

---

### Task 5: AnalyticsFigmaShell right-rail slot

**Files:**
- Modify: `src/ui/components/analytics/AnalyticsFigmaShell.tsx:21-27, 31, 65-78`

**Interfaces:**
- Produces: `AnalyticsFigmaShellProps.rightRail?: ReactNode`; frame modifier class `figma-analytics__frame--with-right-rail`.

- [ ] **Step 1: Compile red** — `npm --prefix streampulse-web run typecheck` fails because `rightRail` isn't a known prop yet (usage added in Task 9; to make this task's red/red visible standalone, add a temporary `rightRail={null}` in a scratch check OR proceed with the type addition and let Task 9's usage be the consumer — run `typecheck` before/after the type change).
- [ ] **Step 2: Run to verify.**
- [ ] **Step 3: Implement** — add `rightRail?: ReactNode` to props; append `${rightRail ? ' figma-analytics__frame--with-right-rail' : ''}` to the frame class; render `{rightRail ? <aside className="figma-analytics__right-rail" aria-label="Live Wire">{rightRail}</aside> : null}` as the third grid child (single mount, single `<aside>` landmark).
- [ ] **Step 4: Run `typecheck` → PASS.**
- [ ] **Step 5: Stage + approve commit.**

---

### Task 6: Frame + rail-card CSS (grid placement, sticky, accessibility styles)

**Files:**
- Modify: `src/ui/components/analytics/figma-analytics.css`

**Interfaces:**
- Consumes: `HubLiveWireFeed` rail DOM classes from Task 8.
- Produces: `.figma-analytics__right-rail` placement at all breakpoints, `.hub-live-wire__rail-card`, twin bars, actions, disclosure, list spacing, focus-visible.

- [ ] **Step 1: Write placement rules (single-mount grid)**

Use the frame's **explicit two-row grid** so the rail is always the same DOM element (`<aside class="figma-analytics__right-rail">`) placed into different `grid-area`s by breakpoint — no component-internal DOM knowledge needed, no duplicate mount. The frame gets explicit `grid-template-rows` only when the modifier is active:

```css
/* Single rail child, repositioned by grid — never mounted twice. */
.figma-analytics__frame--with-right-rail { grid-template-rows: auto auto; }

.figma-analytics__right-rail { display: none; } /* default hidden */

/* >=1440px: sidebar | center | rail, each in row 1 */
@media (min-width: 1440px) {
  .figma-analytics__frame--with-right-rail {
    grid-template-columns: 220px minmax(0, 1fr) 320px;
    grid-template-areas:
      ". . rail";
  }
  .figma-analytics__frame--with-right-rail .figma-analytics__sidebar { grid-area: auto; }
  .figma-analytics__frame--with-right-rail .figma-analytics__center { grid-area: auto; }
  .figma-analytics__frame--with-right-rail .figma-analytics__right-rail {
    grid-area: 1 / 3 / 2 / 4; /* column 3, row 1 */
    display: block;
    position: sticky;
    top: 4.75rem;
    align-self: start;
    max-height: calc(100vh - 5.5rem);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
}

/* 1100-1439px: sidebar | center in row 1; rail spans full width in row 2 */
@media (min-width: 1100px) and (max-width: 1439px) {
  .figma-analytics__frame--with-right-rail {
    grid-template-columns: 220px minmax(0, 1fr);
    grid-template-areas:
      "sidebar center"
      "rail rail";
  }
  .figma-analytics__frame--with-right-rail .figma-analytics__sidebar { grid-area: sidebar; }
  .figma-analytics__frame--with-right-rail .figma-analytics__center { grid-area: center; }
  .figma-analytics__frame--with-right-rail .figma-analytics__right-rail {
    grid-area: rail;
    display: block;
    margin-top: 1rem;
  }
}

/* <1100px: single column; sidebar hidden; rail is row 2 */
@media (max-width: 1099px) {
  .figma-analytics__frame--with-right-rail {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "center"
      "rail";
  }
  .figma-analytics__frame--with-right-rail .figma-analytics__center { grid-area: center; }
  .figma-analytics__frame--with-right-rail .figma-analytics__right-rail {
    grid-area: rail;
    display: block;
    margin-top: 1rem;
  }
}
```

Contract: **one `<aside>`, one mount, repositioned only by `grid-area`.** The two-row frame (`grid-template-rows: auto auto`) exists only on the active modifier, so non-landing routes are unaffected.

- [ ] **Step 2: Style the rail cards** — `.hub-live-wire__rail-list` (`<ul>`), `.hub-live-wire__rail-card` (`<li><article>`), twin `.hub-live-wire__bar` fills (hidden decorative: `aria-hidden` on fills, real value in an absolutely-positioned/visually-inline label), `.hub-live-wire__actions` (sibling links/buttons, gap, focus-visible ring `outline`), `.hub-live-wire__disclosure` (`button[aria-expanded]`, chevron rotate), spacing between cards; all using `--sp-*` tokens.
- [ ] **Step 3: Set center-width expectations** (real padding: 16px side below 1100, 20px at 1100+) → centers ≈ **992px @1024, 820px @1100 (no rail), 820px @1440 (rail 320), 900px @1520/1600 (shell capped at 1520)**.
- [ ] **Step 4: Run `npm --prefix streampulse-web exec node scripts/check-analytics-overlap.mjs` → green.**
- [ ] **Step 5: Stage + approve commit** (CSS file only).

---

### Task 7: AnalyticsHubSidebar — action-only Live Wire entry

**Files:**
- Modify: `src/ui/components/analytics/AnalyticsHubSidebar.tsx:38`

**Interfaces:**
- Produces: Live Wire sidebar entry is **excluded from the IntersectionObserver** (action-only) and labeled **"Live Wire"**.

- [ ] **Step 1: Compile check** — `npm --prefix streampulse-web run typecheck` passes at baseline.
- [ ] **Step 2 (red):** currently the observer includes every visible section; a sticky rail outside the scroll flow pins `activeId` — no automated red, so gate by review: assert the sidebar list renders a "Live Wire" action link (E2E in Task 11).
- [ ] **Step 3: Implement** — filter `section-live-wire` out of the `IntersectionObserver` set and render it as a non-observed action link; rename label to "Live Wire" (update `commandCenterLabels` map if it maps `section-live-wire` to old copy).
- [ ] **Step 4: Run `typecheck`.**
- [ ] **Step 5: Stage + approve commit.**

---

### Task 8: HubLiveWireFeed rail layout, cards, tiering, hard NEW gating

**Files:**
- Modify: `src/ui/components/analytics/HubLiveWireFeed.tsx`
- Rewrite: `tests/hubLiveWireFeed.test.tsx` (edit list — required for `npm run test` to pass)

**Interfaces:**
- Consumes: `classifyMomentWindow`, `normalizeRatePct`, `dedupeMomentsByLogin`, `capNewKeysPerPoll` (Task 1), `resolveMomentActions` (Task 2), `animateEnterHorizontal(…, { from: 'right' })` (Task 3).
- Produces: `HubLiveWireFeed` with `layout?: 'section' | 'ticker' | 'lane' | 'rail'`, and — for the rail — props `pollSequence?: number`, `loadSource?: PublicHubLoadSource`; removes `onSelectMoment`/`selectedMomentKey` usage on the rail.

- [ ] **Step 1: Rewrite the unit test** (`tests/hubLiveWireFeed.test.tsx`) to the rail contract:
  - old outer-link `.hub-live-wire__card` Link → new `<article role="listitem">` with sibling action links;
  - initial-state animation only on the hard-gated live band, not on first render;
  - **older-than-30m rows appear in "Older retained"** (no 30m omission);
  - **right-entry** motion (spy asserts `x: 24`);
  - lane selection (`selectedMomentKey`) is gone;
  - NEW only when `feed.source==='network' && loadSource==='full' && hubEndpointOk===true`;
  - cache/degraded → no NEW, no entrance motion, honesty banner;
  - reduced motion → no animation, semantic NEW retained;
  - disclosure button `aria-expanded` toggles the older list; counts only rendered rows;
  - non-nested controls (no link-in-link).
- [ ] **Step 2: Run to verify it fails** (component not yet reworked). `npm --prefix streampulse-web run test -- hubLiveWireFeed`
- [ ] **Step 3: Rework the component**:
  - Build a **valid retained candidate list** already filtered of lifecycle kinds (there is NO 30m pre-filter anymore):
    `const candidates = enrichPulseMomentRows(feed.moments.filter(m => !isLifecycleMomentKind(m.kind)), enrichCtx)`
  - Classify using the **one-second `now` state** (already in the component):
    `liveMoments` = candidates where `classifyMomentWindow(at, now, WINDOW) === 'live'`; `olderMoments` = `'older'`; `omit` entries are dropped.
    `const retained = [...liveMoments, ...olderMoments]`; normalize each bar dimension across `retained`'s max; cap each list (10 live / 12 older).
  - **Hard NEW gating** (all three): `const healthyFullNetwork = feed.source === 'network' && loadSource === 'full' && hubEndpointOk === true`. Compute **semantic NEW keys** (unseen, in-window, healthy) separately from the **max-3 animation keys** (`capNewKeysPerPoll`). Only healthyFullNetwork rows may be NEW. Track `lastConsumedPollSequence` in a ref; baseline the seen-set on the first healthy full snapshot; preserve seen keys through cache/degraded transitions (do not clear on non-healthy snapshots); key the animation effect on `pollSequence` changes (not the 1-second clock).
  - **Cards:** `<ul role="list">` → `<li role="listitem"><article className="hub-live-wire__rail-card">`; header (avatar+name+best-available category sub-line), twin bars (hidden `aria-hidden` fills + labelled metric), up to 3 emotes, age + NEW badge, `resolveMomentActions(moment)` sibling actions ("View moment" → `analyticsHref`; "Jump to VOD" → `vodHref` external; else disabled `<span aria-disabled="true">Live tracking only</span>`).
  - **Tiering:** "Live now" list + `<button aria-expanded ...>Older retained · N</button>` disclosure toggling the older list.
  - **Motion:** `animateEnterHorizontal(rowEl, { from: 'right' })` for the animation keys only; `motionEnabled` (reduced-motion) already gates animation while the semantic NEW label stays.
  - **Delete** the `layout === 'lane'` branch body and stale `selectedMomentKey`/`onSelectMoment` wiring on the rail.
- [ ] **Step 4: Run the unit tests** — `npm --prefix streampulse-web run test` — all green (including the rewritten `hubLiveWireFeed.test.tsx`).
- [ ] **Step 5: Stage + approve commit** (component file + rewritten test file).

---

### Task 9: Landing page wiring (single rail mount)

**Files:**
- Modify: `src/routes/analytics/AnalyticsLandingPage.tsx:379-387, 145-151, 416-440, 575-580`

**Interfaces:**
- Consumes: `HubLiveWireFeed layout="rail"` + `pollSequence`/`loadSource` (Task 8), shell `rightRail` (Task 5).
- Produces: `<HubLiveWireFeed layout="rail" pollSequence={hub.pollSequence} loadSource={hub.loadSource} ... />` passed to `<AnalyticsFigmaShell rightRail={...}>`; the **only** place Live Wire is mounted.

- [ ] **Step 1: Compile red** — `npm --prefix streampulse-web run typecheck` fails until `rightRail`/`layout="rail"`/`pollSequence` exist (they exist by Tasks 5/8, so this is verifying integration, not standalone red — run after Tasks 5+8).
- [ ] **Step 2: Implement** — add `pollSequence: hub.pollSequence` to `liveWireFeedProps`; remove the `annotation*` props from the `FigmaGlobalActivityPanel` call site (Task 4); render the single rail:
  `rightRail={<HubLiveWireFeed {...liveWireFeedProps} layout="rail" />}` inside `<AnalyticsFigmaShell>`.
- [ ] **Step 3: Run `typecheck` → PASS.**
- [ ] **Step 4: Rerun unit tests** — `npm --prefix streampulse-web run test` → green.
- [ ] **Step 5: Stage + approve commit.**

---

### Task 10: Align links checker + docs supersession (incl. the spec's stale route)

**Files:**
- Modify: `scripts/check-analytics-links.mjs`
- Modify: `docs/superpowers/specs/2026-08-18-pulse-wire-right-rail-design.md` (fix `/s/{streamId}` claim → canonical `/analytics/{channel}/{streamId}`)
- Modify: `docs/website-portal/analytics-command-center-layout.md`, `analytics-hub-liveness-tasks.md`, `analytics-product-refactor-audit-2026-07-10.md`

- [ ] **Step 1: Align the checker** — its inline `buildAnalyticsHref` emits `/s/{streamId}`; change expected strings to `/analytics/{channel}/{streamId}` (and keep the `/s/{streamId}` redirect case as a known-alias, not the canonical expectation). Add a VOD-fragment note that in-app links use the `#t={offset}` fragment via offsetSeconds.
- [ ] **Step 2: Run `npm --prefix streampulse-web exec node scripts/check-analytics-links.mjs` → green.**
- [ ] **Step 3: Update the spec + the 3 docs** to canonical route + Live Wire naming + supersession of the hub-landing lane.
- [ ] **Step 4: Stage + approve commit.**

---

### Task 11: Replace E2E contract

**Files:**
- Modify: `streampulse-web/tests/e2e/analytics-hub-live-wire-ticker.spec.ts`
- Modify: `streampulse-web/tests/e2e/analytics-figma-parity.spec.ts`
- Modify: `streampulse-web/tests/e2e/analytics-hub-ux.spec.ts` (Live Wire selection test)
- Modify: `streampulse-web/tests/e2e/analytics-hub-chart-contract.spec.ts`

- [ ] **Step 1: Rewrite the live-wire ticker spec** to the rail contract (see the earlier verified mock `installHubUxMock` + viewport matrix):
  - `viewport.width >= 1440`: `.figma-analytics__right-rail` visible; `.hub-live-wire__rail-card` first visible; no horizontal overflow; no console errors.
  - `1100 <= width <= 1439`: `.figma-analytics__right-rail` visible as the **same single element** (not a second mount) placed below the center; `#section-live-wire` not inside the chart col.
  - `width < 1100`: rail visible below the center in single-column layout; no overflow.
  - **Computed layout** at exactly **1099, 1100, 1439, 1440, 1520, 1600**: assert center/rail bounding boxes ≈ the Task 6 width table (± pad tolerance) and `.figma-analytics__right-rail` toHaveCount(1) (single mount).
  - Assert a "Live Wire" sidebar action link (action-only target).
- [ ] **Step 2: Update the other three specs** — remove assertions that `#section-live-wire` sits in the chart col / lane chips coordinate in-place selection / `side-rail--right` is absent; assert the rail or its in-flow position instead; update the "Live Wire selection coordinates one inspector" test in `analytics-hub-ux.spec.ts` to reflect launch-target (not selection) behavior.
- [ ] **Step 3: Run the full E2E** — `npm --prefix streampulse-web run test:e2e:analytics-local` → green.
- [ ] **Step 4: Run motion/NEW/disclosure scenarios** are covered by the rewritten `hubLiveWireFeed.test.tsx` (unit) since they need controlled time/poll transitions.
- [ ] **Step 5: Stage + approve commit.**

---

### Task 12: Full acceptance gate (final, no commit)

- [ ] **Step 1:** `npm --prefix streampulse-web run typecheck`
- [ ] **Step 2:** `npm --prefix streampulse-web run test` (all unit, incl. rewritten `hubLiveWireFeed.test.tsx`)
- [ ] **Step 3:** `npm --prefix streampulse-web exec node scripts/check-analytics-overlap.mjs`
- [ ] **Step 4:** `npm --prefix streampulse-web exec node scripts/check-analytics-links.mjs`
- [ ] **Step 5:** `npm --prefix streampulse-web run test:e2e:analytics-local`
- [ ] **Step 6:** Grep the diff for any residual "Pulse Wire" copy on the hub landing; confirm no `href="#"` remains; confirm `.figma-analytics__right-rail` has exactly one mount.

---

## Self-Review (against Sol findings)

1. **P0 multi-mount** → Task 6 places ONE `rightRail` child via grid at all breakpoints; no `#section-live-wire-fallback`; Task 9 mounts once; Task 11 E2E asserts `toHaveCount(1)`. ✅
2. **P0 hard NEW** → Task 8 requires `source==='network'` **&&** `loadSource==='full'` **&&** `hubEndpointOk===true`; semantic keys split from animation keys; `pollSequence` consumed once; baseline on first healthy snapshot; seen preserved through cache/degraded. ✅
3. **P0 older-retained empty** → Task 8 builds a candidate list with NO 30m pre-filter and classifies via the 1-second `now`. ✅
4. **P0 unit tests** → Task 8 rewrites `tests/hubLiveWireFeed.test.tsx`; it is in the edit list and required for green. ✅
5. **P0 CSS/a11y** → Task 6 styles cards/bars/actions/disclosure/list/focus-visible; single `<aside>` landmark; `<ul><li><article>`; `aria-expanded`; hidden decorative fills + absolute metric labels. ✅
6. **P1 widths** → Task 6 uses real 16px/20px padding → 992/820/820/900; Task 11 tests 1099/1100/1439/1440/1520/1600. ✅
7. **P1 order/commands** → Task 8 defines `layout="rail"` before Task 9 consumes it; Task 5 red via type usage after Task 9; git add paths all under `streampulse-web/tests/`; checks via `npm --prefix streampulse-web run typecheck` + `check:*`. ✅
8. **P1 navigation** → Task 7 makes the Live Wire sidebar entry action-only / non-observed (observer no longer pins on sticky rail); stable target = the single rail `<aside>`. ✅
9. **P1 link/doc cleanup** → Task 10 aligns checker + fixes the spec's stale `/s/{streamId}` + updates liveness + product-refactor docs. ✅
10. **P1 obsolete lane** → Task 4 deletes lane branch + annotation props + CSS + selection tests; Task 7/8 rename sidebar + `WireHeader` copy to "Live Wire." ✅
11. **Process dirty worktree** → Global Constraints + every task's Step 5 = **stage only intended files, get explicit approval before commit**; no automatic whole-file commits. ✅

**Placeholder scan:** no TBD/TODO; all code steps carry concrete implementation instructions. Task 6's grid uses explicit `grid-area` placement with no dependency on the component's internal DOM.

**Type consistency:** `layout="rail"` defined in Task 8, consumed Task 9; `pollSequence`/`loadSource` props defined Task 8, consumed Task 9; `rightRail` defined Task 5, consumed Task 9; `classifyMomentWindow`/`normalizeRatePct`/`resolveMomentActions`/`animateEnterHorizontal({from:'right'})` defined Tasks 1–3, consumed Task 8. ✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-18-live-wire-right-rail.md`. Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks.
2. **Inline Execution** — run tasks in this session with checkpoints.

Which approach? (Note: every task ends with a stage-then-approve commit step per the dirty-worktree policy.)
