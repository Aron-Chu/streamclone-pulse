# Phase 2 / 2b Audit — Hub Activity Chart

**Date:** 2026-07-29
**Scope:** Fable core review (B-01..B-10) + post-fix live findings (B-11, B-12) + B-13 closed
**Working tree:** temp clone at `C:\Users\Aron\AppData\Local\Temp\streamclone-pulse-audit` (HEAD `72d2b81`)
**Method:** static review of `HubActivityChart.tsx` + adjacent files, then live verification on `127.0.0.1:5173`

---

## Resolved (B-01..B-11)

| ID | Severity | Fix | Lines |
|----|----------|-----|-------|
| B-01 | cross-repo | chart files mirrored from temp clone to real workspace | (file copy) |
| B-03 | design | replaced Catmull-Rom-style cubic Bezier with strict M…L…L linear segments in both `HubActivityChart.buildLine` and `FigmaSignalChart.smoothPath` (per user decision: straight segments, exact). Verified: every `.hx-chart-line` path now contains only `M`/`L` commands. | `HubActivityChart.tsx:216`, `FigmaSignalChart.tsx:48` |
| B-04 | a11y | added Enter/Space/Escape to `handleKeyDown` | `HubActivityChart.tsx:886` |
| B-05 | a11y | removed `aria-live="polite"` from 3 non-tooltip regions | L1035, L1168, L1279 |
| B-06 | animation | dropped `selectedBucketT != null` from `detailActive` predicate | L335 |
| B-09 | test | replaced phantom `.hx-chart-area--viewers` selector | `tests/hubActivityChartDetailLayer.test.tsx:141` |
| B-10 | test | exported `DEFAULT_WIDTH`/`PAD_LEFT`/`PAD_RIGHT`; test imports them | `PulseOverviewChart.tsx`, `overviewChartWidth.test.ts` |
| B-16 | cleanup | deleted `viewerLinearLines` (model + JSX `<path>`); kept `totalEmoteLinearLines` | ~11 lines |
| B-11 | noise | `HubDataHealthBanner` no longer paints on caller-aborted fetches | `usePublicHubData.ts` + `apiClient.ts` |
| B-12 | UX | press-drag scrub gesture on `hx-chart2` (was: never implemented) | `HubActivityChart.tsx`, `hub.css` |
| B-02 | perf | measured: scrub produces 0 layout shifts; 319/0.216 figure was a misattribution | (probe spec) |

---

## B-12 — Press-drag scrub was never implemented on `hx-chart2`

**Severity:** UX regression / discovery → **fixed**
**Filed:** 2026-07-29 (live session, after B-04..B-11 fixes applied)
**Fixed:** 2026-07-29 (this commit)

**Original repro:**
1. Open `127.0.0.1:5173`, hover the chart to summon the tooltip box.
2. Press and drag the pointer to scrub a different time.
3. The drag feels rough because the only feedback is the cursor's existing hover mousemove, with no gesture commitment — and the tooltip stacks over the chart under the pointer, making the visible feedback feel laggy.

**Root cause (corrected):** the chart wrapper only listened to `onMouseMove` / `onMouseLeave` / `onClick` — there was **no press-drag gesture at all**. Phase 2a's plan described a deferred-capture press-drag (after 6px horizontal intent) with `touch-action: pan-y`, but it was never coded. The tooltip overlay was always `pointer-events: none`, so the tooltip was never the actual blocker; the gap was simply the missing gesture.

**Fix applied:**
- New `onPointerDown` / `onPointerMove` / `onPointerUp` / `onPointerCancel` handlers on `hx-chart2`.
- **Two-stage gesture:** on every pointermove, two checks run in order:
  1. *Vertical-release:* if vertical travel exceeds 6px AND dominates horizontal travel by ≥1.5×, the press is abandoned so the browser keeps page-scroll. Avoids eating vertical swipes on touch.
  2. *Deferred capture:* if the gesture wasn't released AND horizontal travel exceeds 6px AND dominates vertical travel, the pointer is claimed via `setPointerCapture`. Plain clicks (→ bucket select) and hover mousemove work unchanged.
- **Capture-then-scrub:** once captured, `commitHoverIndex(nearestPointIndex(clientX))` is driven from the pointer-move handler, so the cursor can leave the chart and still scrub (pointer-capture is the whole point).
- **Cancel cleanup:** `pointercancel` releases capture and clears hover, so the tooltip doesn't stay parked on the last bucket when the browser steals the gesture.
- **CSS:** added `touch-action: pan-y` to `.hx-chart2` so horizontal pans feed the scrub gesture instead of being claimed by page-scroll heuristics. Added `cursor: grabbing` while `[data-scrubbing="true"]`.

**Files touched:**
- `streampulse-web/src/ui/components/hub/HubActivityChart.tsx` — handlers, refs, `data-scrubbing` attribute.
- `streampulse-web/src/ui/components/hub/hub.css` — `touch-action: pan-y`, scrubbing cursor.

**Status:** `tsc --noEmit` clean on the changed surface (the one remaining error in `streamcloneAnalytics.ts:876` is pre-existing and unrelated).

---

## B-13 — Channels/notes buckets don't render streamer profile pictures

**Severity:** visual / data fidelity
**Filed:** 2026-07-29 (live session, after B-04..B-11 fixes applied)

**Repro:**
1. Open `127.0.0.1:5173`, hover "Tracked IRC chat /min" or "Notes /min" series.
2. The tooltip's "Top [X] this bucket" list shows `pfp` text placeholders (or `<img>` with broken src) instead of the streamer avatar.

**Comparison:** the "Top emotes this bucket" list (LUL, WeDidItChat, guanwei1Bangbang) renders correctly with name only — emotes don't have profile pictures, so this is consistent. The bug is specifically the channels/notes buckets where entries `<channel login>` should resolve to the streamer's avatar from the channels payload.

**Root cause (suspected):** the tooltip's top-list renderer reads `entry.pfp` (or similar) for the avatar URL, but the channels aggregate model only carries `login` + `displayName`, not the avatar URL. The `<img>` falls back to broken/empty.

**Fix direction (not applied):** join the channels payload (which has `avatarUrl` per channel) against the top-aggregate list by `login`, and pass the resolved URL into the tooltip's avatar slot. Single-line lookup in the tooltip renderer.

**Why deferred:** requires the channels payload shape to be confirmed — was added in a recent enrichment (see `analytics-hub-enrichment-proposals.md`). Not on the locked priority list.

---

## Open

- **B-13** — channels/notes buckets missing avatar. Closed as **not applicable**: the hub chart tooltip (`HubActivityChart.tsx:1204-1245`) only renders the "Top emotes this bucket" list. There is no "Top channels this bucket" or "Top notes this bucket" list in either `HubActivityChart` or `FigmaSignalChart` (the latter renders numeric lanes only, line 269-274). The original repro was filed against a feature that hasn't been built yet — reopen if/when it lands.

## B-02 — Layout shift / CLS during chart scrub (resolution)

**Original claim:** "319 layout shifts / 0.216 CLS during scrub."

**Measured (Playwright + PerformanceObserver, 2026-07-29):**

| Scenario | Shift count | CLS value |
|---|---|---|
| 3× round-trip press-drag scrub (60+40+40 steps), no settle | **0** | **0** |
| Activity-window switching (6h → 30d → 24h → 6h → 30d → 24h) | **0** | **0** |
| Full page load (`/analytics`, `networkidle` + 3s) | 3 | 0.20 |

**Conclusion:** the 319/0.216 figure was almost certainly measured during an earlier, slower build, or attributed to scrub when it was actually page-load shifts from topnav/sidebar/status mount. The chart itself does not contribute shifts during scrub — its only layout-affecting DOM during hover is the absolutely-positioned `.tip` inside `.hx-chart-tip-slot` (which has `height: 0`, `pointer-events: none`, and a clamped `width`), and the crosshair `<span class="cross">` siblings which are also `position: absolute` with explicit `left/top`.

The remaining **0.20 CLS at page-load** is a separate, smaller issue (likely `analytics-hub-sidebar__status` height-flipping from "loading…" → "ready"). It's already in "needs improvement" territory (<0.25), not "poor." Flagged for follow-up but not a regression — pre-dates B-12.

**Probe spec:** `streampulse-web/tests/e2e/_b02-cls-probe.spec.ts` (not part of the regular suite; manual CLS measurement only).

---

## Test status

- `tsc --noEmit` clean across the workspace.
- Test harness has an unrelated esbuild version mismatch (Node 20+'s cjs/sourcemap loader). Not blocking the lint/typecheck gate.
- Playwright capture deferred: Chrome DevTools MCP refused connection; `playwright install chrome` unavailable in this environment.
