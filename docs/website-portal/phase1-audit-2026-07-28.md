# Phase 1 audit — /analytics hub (Cash App–style chart + hub consistency)

Date: 2026-07-28
Scope: read-only, no code edits
URL: `http://127.0.0.1:5173/analytics` (hosted backend `https://api.streampulse.stream`)
Tracks: `adaptive-chart` (Track A) and `hub-ia` (Track B)

## Method

- Source inspection of `streampulse-web/src/ui/components/hub/HubActivityChart.tsx`, `…/lib/hubChartActivityModel.ts`, `…/lib/hubActivitySummary.ts`, `…/ui/components/analytics/FigmaGlobalActivityPanel.tsx`, `FigmaSignalChart.tsx`, `ActivityBucketInspector.tsx`, `HubLiveWireFeed.tsx`, `…/routes/analytics/AnalyticsLandingPage.tsx`, supporting utilities (`activityBucketInspectorUtils.ts`, `pulseMomentsUtils.ts`), motion (`useAnalyticsMotion.tsx`, `useSmoothedScalar.ts`), and CSS (`hub.css`, `analytics-hub-fonts.css`, `analytics-surfaces.css`).
- Docs reviewed: `analytics-command-center-layout.md`, `analytics-product-refactor-audit-2026-07-10.md`, `local-dev-runbook.md`.
- Dev server started via `npm install` + `npm run dev:hosted`; `/analytics` returns HTTP 200; hosted hub returns 200 (`Cache-Control: public, max-age=15, swr=60, stale-if-error=300`).

### Browser-verification gap (note for the user)

- Chrome DevTools MCP returned `Protocol error (Target.setDiscoverTargets): Target closed` on every call in this session — no Chrome target available.
- Playwright MCP needs `npx playwright install chrome`, which is unavailable here.
- No screenshots, console traces or DOM snapshots were therefore produced live. **All "observed" findings below are derived from source**, and the audit intentionally flags every claim that **must** be confirmed visually before Phase 2 edits land. The next developer should re-run a quick interactive pass with `chrome-devtools-mcp` (or a Playwright spec) to lock in rest-vs-detail and Live Wire behavior.

---

# Track A — `adaptive-chart`

> Goal: Cash App–style adaptive time-series interaction.
> Rest → calm, simplified, smoothly interpolated overview.
> Hover / press-drag → reveal higher-resolution detail + precise scrub.
> Exit → smooth return to rest, identical X/Y domains.
> Reproduce the interaction pattern only; do not copy branding.

## A.1 Current behavior (observed from source)

### What renders

`HubActivityChart.tsx` produces a single 100×100 SVG plot:

| Lane | Element | Color token | Stroke | Notes |
|---|---|---|---|---|
| Chat | `<rect>` bars | `--sp-chart-chat` | fill α 0.08 → 0.55 (selected) | sits behind lines |
| Viewers | `<path>` + dark underlay | `--sp-chart-viewers` | 2.25 (line) / 5 (underlay) | one curve, Catmull‑Rom style |
| Emotes | dashed `<path>` + dark underlay | `--sp-chart-emotes` | 1.75 dash `5 4` | α 0.92 |
| Providers | dashed `<path>` overlays | per‑provider tokens | 1.4 / α 0.55 | shown only in "power-user" overlay |
| Chat-volume backdrop | `<rect>` per bucket | same as chat | — | alpha bumps on hover / selected / accent |

X is **evenly spaced** by index (`xAtIndex(i) = i/(n-1)*100`), not by bucket timestamp. Y scales are independent per series (viewers / chat / emotes / provider each have their own `max`). Spline smoothing uses a Catmull‑Rom‑to‑Bezier conversion (`buildLine`) with control points clamped `minX / maxX` to prevent overshoot. Lines break on `maxConnectedGapMs(windowMinutes)` and on missing samples (`splitLinePaths`).

### State on rest

- `hover === null`, `selectedBucketT === null` → no crosshair, no bucket cue, no tooltip.
- `BucketSelectionCue` is unmounted until something is selected.
- `hx-bucket-cue--motion.bx-bucket-cue-bounce 0.56s` only fires on a fresh selection, not on rest.
- Range controls (`24h / 7d / 1mo / …`) trigger a `fadeThemeCenter` GSAP pulse (`0.15s opacity 0.85→1`) on the body wrapper, plus the existing domain recomputation.
- No "calm vs detail" two-path mode exists today. The single splined viewers line is the only smooth curve; chat is bars; emotes is dashed.

### Interaction primitives

| Event | Handler | Aggregation |
|---|---|---|
| `onMouseMove` | `handleMove` → `nearestPointIndex(clientX)` (linear scan of `xs[]`, `O(n)`) → `commitHoverIndex` | RAF‑coalesced to one `setHover` per frame. `flushHover` writes `lastBucketTRef` and notifies `onBucketHover` **only when the bucket changes**. |
| `onMouseLeave` | `handleLeave` | Cancels pending RAF; calls `flushHover(null)`. |
| `onClick` (only when `onBucketSelect` set) | `handleClick` → `resolveChartBucketSelection` | Cycles selected bucket; clears `focusedSeriesKey`. |
| Selection cue animation | GSAP via `useAnalyticsMotion` | 0.56s `cubic-bezier(0.2, 1.45, 0.35, 1)` bounce + ring pulse ×2 |
| Crosshair smoothing | `useSmoothedScalar(target, enabled)` | Exponentially eased: `lerpScalar(c, t, 0.35)`, snaps when `|c - t| < 0.05`. Three separate scalars for `hx`, `hy`, `emoteHy`. |
| Moment markers | `<button>` overlay aligned to `xs[idx]` | Pop from `prevSeenRef` set; up to 12 markers. |
| Bucket‑clear on outside click | `pointerdown` listener on document | If target is outside `chartAreaRef`, clears selected + hover. |

### Pointer rate & jank

- `handleMove` does a linear scan each frame for `O(n)` buckets (n ≤ 240, so cheap) but the **linear scan + RAF coalesce** pattern is correct.
- `flushHover` only triggers `onBucketHover` when the bucket actually changes — good protection against parent re‑renders.
- `splitLinePaths` is recomputed inside the `model` `useMemo` keyed on `chartPoints` (so it does **not** recompute when only the hover index changes — good).
- `momentMarkers` rendered as **DOM buttons**, not SVG — they participate in React render and can trigger inspector transitions. (See B‑side risk: parent state churn.)
- React state churn on hover: `setHover` happens every RAF tick the bucket changes, which is fine for the chart itself but the parent `<FigmaGlobalActivityPanel>` has a 80ms `hoverIntentTimerRef` debounce + `selectedMoment?.t` effect that flips a GSAP transition for the inspector chrome. This is the **shared-blocker** listed in §C.

### Accessibility & reduced motion

- `hx-chart2` has `role="img"`, `aria-label` is built dynamically including the selected bucket and click affordance.
- No keyboard navigation on the main chart (no `tabIndex`, no `ArrowLeft/Right`, no `Home/End`). By contrast `FigmaSignalChart.tsx` (the session chart) already implements `tabIndex={0}` + arrow / Home / End handlers — there is a **reference implementation** to copy.
- `prefers-reduced-motion` is honored globally by:
  - `useSmoothedScalar` snaps when `enabled = false`
  - `motionEnabled = useAnalyticsThemeOptional().motionEnabled ?? true`
  - CSS keyframes are disabled by `hub.css` line 1002 block (specific to `.is-marquee`) and the global `analytics-hub-home.css:911`, `figma-analytics.css` blocks — but **`hub.css` itself has no `prefers-reduced-motion` block for the chart crosshair, bucket-cue bounce or refresh-pulse**. Audit finding: bucket-cue bounce and refresh pulse will keep running under reduced‑motion.

### Source accuracy

- `buildLine` (Catmull‑Rom-to-Bézier) clamps control X within `[minX, maxX]`: **no overshoot on X**.
- It does **not** clamp control Y, so for big Y‑swings the curve can still overshoot slightly. With the current scales this is rarely visible, but it is a real risk on wide windows (1mo/3mo). Audit finding.
- `splitLinePaths` drops zero values and breaks on gaps: correct behavior for "no sample" semantic. Viewers break on `hasViewerRollup || viewers > 0`; chat has a dedicated `chatGapBands` overlay; emotes splits on `emoteCount > 0`.
- No interval re‑sampling for rest: the chart shows every bucket the model returned (≤ 240). On a 24h window with 1‑min buckets this is fine; on `1mo` the bucket width grows to ~15‑min, so rest still uses the full ~80 points. Audit finding: rests fine; "detail" needs definition (see A.3).

### Shared‑selection integration

- Selected bucket: chart receives `selectedBucketT`, bucket lock (`BucketSelectionCue`), `accentBucketT` for moment‑driven soft highlight, `selectedMomentKey` for marker state.
- Pointer out: there is no explicit "exit transition"; `hover` simply returns to `null` and the cue fades by reactivity.
- Parent (`FigmaGlobalActivityPanel`) wires: `selectedPoint = chartPoints.find(t === selectedBucketT ?? accentBucketT)`, `hoverPoint = chartPoints.find(t === hoverBucketT)` (only when no lock and no linked moment).
- `livePoolViewerSum` is passed as a *floor* for the trailing open bucket only (`applyLivePoolViewerFloor`), not used in the resting overview.

## A.2 Inferred / read‑across from references

> No private Cash App internals claimed. Inferences are about *what the interaction pattern looks like in public product surfaces*, based on the prompt's stated goals and standard implementations of "rest vs detail" charts.

| Behavior | Reference pattern (inferred from prompt + public‑surface knowledge) | What StreamPulse has | Gap |
|---|---|---|---|
| Calm rest line | one lower‑frequency series, "averaged" or sub‑sampled to even spacing | viewers line is already calm; emissive chat/emote bars stay always visible | no clean separation between "calm" and "detail" presentations |
| Detail line on interact | same X/Y domain, second path with full bucket resolution + per‑bucket tooltip | only one path per series; tooltip already exists; values from hover only | the second path/annotation layer is missing |
| Pointer scrub | nearest‑bucket + crosshair | nearest‑bucket + crosshair ✅, but no separate detail line | needs a second, higher‑resolution overlay |
| Press‑drag scrub (touch) | press and drag pans a "reading" indicator; scroll suppressed on the canvas | not implemented; only `onMouseMove` + click | needs pointerdown / pointermove / pointerup handlers + `touch-action: none` |
| Exit transition | smooth snap back to calm | none — pointer leave just unmounts crosshair | needs crossfade back to rest |
| Stable domains | no Y‑axis jump on hover | viewer/chat/emote Y‑maxes come from the data, not from the hovered point | already correct ✅ |
| Crossfade duration | 140–180 ms | not yet measured; selection cue is 0.56s bounce | separate, faster (≤180ms) needed for detail reveal |
| Empty / sparse series | rest line uses rolling means; extrema preserved | current line is true series, breaks on gaps | breakpoints preserved correctly; "rolling mean" overlay not present |
| Reduced motion | snap | only crosshair snap; selection cue still bounces | bucket cue + refresh pulse must respect reduced‑motion |

## A.3 Chosen technical approach

**Sticking to the existing custom SVG stack.** Number of points is small (≤ 240), interactivity is near‑instant, and re‑mounting a vendor chart inside the hub CSS would break the analytics-surface tokens (and is explicitly forbidden by the skill guardrails). The work is a "two‑path crossfade" layering on top of the current single‑path chart:

### Resting layer (always mounted, calm)

- **One path per core series** (viewers, chat, emotes total).
- Render the existing splined viewers + dashed emotes + chat bars. This is already calm enough — lines are Catmull‑Rom with `vector-effect="non-scaling-stroke"` and the tooltip is hidden.
- Optional: **add a faint averaged "rest" curve** for viewers at ~`(window minutes / 60)` step (e.g. 10‑min average). Procedural + memoized. Preserves extrema by walking a running max/min envelope (see §A.3.1).

### Detail layer (crossfaded in on hover)

- A **second, thinner** viewers path + a more granular bucket highlight, painted on top with `pointer-events: none`.
- Same exact X coordinates (no domain jump); same Y scaling.
- "Higher‑resolution" here means:
  1. Per‑bucket dot at the hovered bucket (already rendered as `.hdot`, thinned out to a small ring).
  2. A vertical crosshair + value readout with discrete bucket time + slot position (already implemented — `hx-crosshair`, `hx-chart-tip-slot .tip`).
  3. A second viewers curve drawn with **straight line segments** at the resting state, then snap to the splined curve during hover. The transition is 140–180ms, single‑shot (`crossfade — graceful, not infinite`).
- Rendered in a sibling `<g class="hx-detail-layer">`, not by re‑mounting the chart.

### Resting-vs-detail gate

- A single React state `detail` = `null | { x, i }`, where `i` is the bucket index. Driven by the existing hover index (no new pointer events needed — already coalesced).
- The crossfade is **CSS opacity transition** on the detail layer's `<g>` (140ms ease‑out), no GSAP. GSAP only handles range‑change fade.
- Calm is also a transition: hover-out → `detail = null` → opacity fades 1 → 0 over 160ms. `motionEnabled = false` (reduced motion) sets opacity instantly and the entire crossfade is just a `display` flip.

### X/Y domain invariant

- Reuse the existing `xAtIndex(i)` and per‑series `atViewerY / atChatY / atEmoteY` functions. Compute **once** in `useMemo`; both layers read from the same constants. No domain jump is possible by construction.

### Press‑drag scrubbing

- Add a `pointerdown` listener that captures the bucket index on press. While the pointer is down, render the bucket cue as `'selected'` (locked preview) — the rail inspector switches to "preview" mode but the bucket is **not yet committed** for `onBucketSelect`. On `pointerup`, fire `onBucketSelect(bucketT)`.
- Apply `touch-action: none` only to `hx-chart2` when `bucketSelectEnabled`.
- Suppress the native horizontal scroll on the canvas via `e.preventDefault()` on `pointermove` only when `isDownRef.current === true`.

### Keyboard scrub

- Make the chart focusable when `bucketSelectEnabled`: `tabIndex={0}`, `role="application"`, `aria-valuenow`, `aria-valuemin`, `aria-valuemax`. Reuse `nearestPointIndex` so we have **one** definition of "nearest".
- `ArrowLeft` / `ArrowRight` move ±1 bucket, `Shift+Arrow` jump 5, `Home/End` first/last. Emits the same `onSelectMomentKey` / `onBucketSelect` payloads the click would. Announce bucket time + the three series values via a visually hidden `aria-live="polite"` region (same shape `FigmaSignalChart` already has).

### Misleading‑viz guardrails

- **Resting curve preserves extrema:** derive the resting curve via a max‑envelope over `W = max(3, round(windowMinutes / 12))` buckets — never `every Nth` resampling.
- **No overshoot on Y:** keep `buildLine` X‑clamp; add the same clamp on Y for the resting curve so a calm envelope at the foot of the curve does not draw above a real peak elsewhere in the window.
- **Trailing open bucket** stays dropped (current `dropTrailingOpenBucket`). No faux extension across the live edge.

### Reduced motion

- Extend the existing `hub.css` `@media (prefers-reduced-motion: reduce)` block (currently scoped to `.hx-streamrail.is-marquee`) to also disable:
  - `@keyframes hx-bucket-cue-bounce` and `hx-bucket-cue-ring`
  - `@keyframes hx-chart-refresh-pulse`
- The `useSmoothedScalar` already snaps when `enabled=false`. The new crossfade becomes an instant opacity toggle.

### Responsive

- Same X domain at narrow widths; the only risk is tooltip positioning at <420px. Audit finding: today the tip uses `tipShift` to flip when `hx < 18` or `> 82`, which works on `xs.length * slotWidth` not on container width. Under `390px` the provider‑lanes fold below — we keep that. Detail layer does not add columns.

### What stays the same

- Spline type, line colors, provider chips, range controls, moment markers, chunked‑gap bands, channel‑roll gap bands, sample‑note copy, top‑emotes tooltip block.
- The whole `bucketSelectEnabled` gating and outside‑pointer‑down clear.
- The lane and provider overlay mechanics.

### What does **not** ship in Phase 2a

- New chart library, Canvas rendering, react‑spring etc.
- A "compare signals" quadrant mode (separate concern, `analytics-product-refactor-audit` P2 territory).
- Bucket‑lock UI affordance overhaul beyond the existing bucket‑cue + pointer‑down press‑drag.

## A.4 Uncertainties and product calls

| Call | Question | Default choice |
|---|---|---|
| What is "detail"? | A second crosshair layer vs an entirely different curve geometry | second layer that overlays the calm curve at the same X/Y; tooltip already covers the values |
| Should detail stay on selection? | After `onBucketSelect`, keep crosshair visible or hide it? | keep visible while a bucket is locked (the cue already fills the role); on plain hover it lives in the tooltip only |
| Crossfade duration | Prompt says ~140–180ms "tune from observation" | start 160ms ease‑out; final value to be measured once DevTools MCP is reachable |
| Pointer‑down commit vs preview | Should press‑drag commit instantly (no second tap) or open preview first? | commit-on-release; preview while dragging feels more natural and lets the user scrub before locking |
| Reduced motion detail | Skip the layer entirely or instant snap? | instant snap; the crosshair itself is still readable |
| Resting curve new or reused? | Keep the splined curve as the calm line OR add a calmer averaged overlay | **add averaged overlay**; existing line is already calm enough but on 1mo the curve can look noisy due to per‑bucket swings — an averaged envelope helps. If reviewers prefer "no second curve", fallback is to keep the existing curve and skip A.3.1. |

## A.5 Phase 2a implementation plan (no code yet)

1. **Add the averaged resting curve** (`A.3.1`) in `hubChartActivityModel.ts`. Pure function: `buildCalmEnvelope(points, windowMinutes)` keyed on existing model.
2. **Add `<g class="hx-detail-layer">`** in `HubActivityChart.tsx`, mounted above the existing line group; opacity 0 by default. Memoized paths identical to current.
3. **Wire `detail` state** off the existing hover index. `motionEnabled = useAnalyticsMotion().motionEnabled` already exists.
4. **CSS crossfade** in `hub.css`: `transition: opacity 160ms ease-out` on `.hx-detail-layer`, `opacity: 1` on `[data-hover="true"]`. Add reduced‑motion override.
5. **Press‑drag**: `usePointerPressDrag(wrapRef, onBucketSelect)` hook in a new `…/ui/components/hub/usePointerPressDrag.ts`. Pointer down → set `pressDraggingRef.current = true`. Move → continue emitting `setHover(i)`. Up → commit `onBucketSelect(i)` if a movement delta exceeded 4px; otherwise treat as a click.
6. **Keyboard**: add `tabIndex`, `onKeyDown` (Arrow/Shift‑Arrow/Home/End), `aria-live` mirror near `.hx-chart-tip-slot`. Reuse `nearestPointIndex` plus a `selectIndex(i)` callback.
7. **Reduced‑motion** CSS extension under `hub.css`. Add a comment in the same file pointing at the audit so future contributors know.
8. **Manual verification** (browser MCP): rest, hover‑in, lock, pointer out, range change, keyboard arrow, reduced‑motion. Capture screenshots; check `Settings → Accessibility → prefers‑reduced-motion: reduce` in DevTools. **`npm run typecheck && npm run check:analytics-overlap`** must still pass.

---

# Track B — `hub-ia`

> Goal: confirm hub surfaces are still doing distinct jobs after the recent refactor. Read‑only.

## B.1 What the hub is supposed to do (re‑read of the product charter)

| Surface | Unique question | Code | Notes |
|---|---|---|---|
| Network activity chart | When did the network move? | `HubActivityChart.tsx` | bucket × hover × lock |
| Live Wire lane | What just changed (≤30m)? | `HubLiveWireFeed.tsx` | fresh annotation layer, **never** a Moments clone |
| Bucket inspector rail | What explains this bucket (preview)? | `ActivityBucketInspector.tsx` | preview‑only |
| Pulse Moments | Which events deserve investigation? | `PulseMomentsLivePanel.tsx` | durable ranked list |
| Top clips | Only when sanitized public clips exist | `TopClipsShelf.tsx` | gated on `publicClips?.length > 0` |
| Channel Screener | Multi‑view tracked table | `LiveChannelsMatrix.tsx` | intentionally separate |

## B.2 Observed (from source — see browser‑verification gap above)

### Live Wire ↔ Pulse Moments overlap

- Both views source moments from the **same `livePulseFeed.moments`** in `AnalyticsLandingPage.tsx`. Live Wire filters out lifecycle kinds (`isLifecycleMomentKind`); the Pulse Moments panel renders the same set embedded in its table.
- The de‑duplication step (`dedupeMomentsByLogin`, 10‑min window) only applies to Live Wire. **A 17h‑old moment that satisfies ≤30m in the lane filter would be rendered with `NEW` until the user saw it** — but `isLiveWireEventFresh(moment.at, now)` (live window ≤30m) and the `activeNewKeys` set both gate on `isLiveWireEventFresh`. The "stale events displayed as live" bug from the Jul 10 audit is **fixed**.
- The lane layout shows chips with `kindMeta`, `relativeTime`, `login/display`, an optional emote thumbnail, and a `NEW` chip when both `isLiveNetwork` and `freshKeys.has(key)` and `isLiveWireEventFresh(at, now)`. The lane uses `<LiveWireTickerScroller>` with Prev/Next arrows, no perpetual marquee — good.
- Empty copy is the agreed phrase: `'No network breakouts in the last 30m'`. ✓
- One Live Wire event ↔ one Pulse Moments row → the user sees the **same content twice**. Audit finding: see §B.5 fix `hub-ia‑1`.

### Selected / hover bucket rail

- Inspector mode is `'range' | 'preview' | 'selected'` determined by `selectedPoint ?? hoverPoint`. There is no longer any "moment inspector body" clone in the rail (`HubMomentRailBody` is not referenced here).
- Three stats: `range` mode uses emote‑intel KPIs (`resolveInspectorRangeStats`); `preview / selected` uses `viewers / chat / emotes` for that bucket.
- Head label switches between three forms; head badge has `Linked / Selected / Preview / null`.
- `InspectorStreamersFooter` is shown only in `range` mode and renders `Top live by activity` (linked to `rankLiveChannelsByActivity`). Empty copy is honest.
- The `LinkedMomentStrip` is rendered only when `linkedMoment` is present and there is no explicit lock, showing channel · label · Clear.
- The rail is restrained and **does not clone** `HubMomentRailBody`. ✅
- Density audit finding: when in `preview / selected` the rail includes a `clip-tools` reserved slot (`activity-bucket-inspector__reserved-slot`) and asks for permission — but **no UX is wired in**. The slot is inert. `hub-ia‑2` below.

### Pulse Moments table + side inspector

- Reads `selectedMomentKey` from parent; finds the row from a unified `momentLookupPool` (key set = `poolMoments ∪ bucketMoments ∪ liveWireFeed.moments`).
- `accentBucketT` is derived from `activityBucketKey(selectedMoment.at, data.activity.windowMinutes)`. Selecting a moment highlights the bucket but does **not** lock it.
- The Pulse Moments side inspector (`FigmaMomentInspector` / `PortalMomentInspector`) stays outside the chart rail. ✅

### Shared selection

- `selectedMomentKey` flows: Live Wire chip → `handleSelectMoment` → state → chart markers + accent → Pulse Moments row → bucket rail linked strip.
- Clearing the bucket (or selecting another bucket) clears moment selection. ✓ (`handleSelectBucket` sets `selectedMomentKey = null`).
- One potential drift point: there are **two `selectedMoment` lookups** — `selectedMoment` in the landing page (used to derive `linkedMoment` and `accentBucketT`) and the local `selectedMomentKey` consumption in `PulseMomentsLivePanel`. Both look up via the same `momentLookupPool`. ✓ Consistent.

### Bucket lock interaction with chart scrubbing

- Chart click → `handleBucketSelect(bucketT)` → Pulse Moments refilter.
- Locked bucket also freezes the rail into `'selected'` mode; `hoverIntent` is ignored.
- Adaptive scrub (Track A) needs a clear policy for "selected bucket" vs "scrub bucket". They can be unified under one bucket, but the bucket‑lock fires `selectedBucketT` immediately. **Track A §A.3 should not produce a path that adds a second selected bucket state.** See shared‑blocker §C.1.

## B.3 Inferred (from the product audit doc)

- "Live Wire = fresh chart annotations, not a second Moments list" is honored at the data shape (dedupe, freshness window, no emote velocity duplicate), but **the lane is still a list**, just a smaller one. The Jul 10 doc accepts this and asks for **clarity / framing / density** changes — not a structural rebuild.
- Pool Wire has already been compressed into a `POOL Stable` line in the command header — verified by inspection of `HubCommandHeader.tsx` references.
- Emote Market, Top clips and Channel Screener are mounted from `AnalyticsLandingPage`, each in its own `SectionReveal`. They are not in the scope of this audit.

## B.4 Recommended changes (`hub-ia` track)

### `hub-ia‑1` · Reduce Live Wire ↔ Pulse Moments visual duplication

- **Whitelist the Live Wire lane to "only moments ≤ 30m"**: ✅ already done (`isLiveWireEventFresh`).
- **Demote events from Live Wire as soon as a more durable home exists.** Today Live Wire and Pulse Moments can render the **same** row at the same time. Add a `seenInMoments = momentKeysInRange.has(key)` flag and suppress the row from Live Wire when it appears as a Pulse Moments row in the **same range** — i.e. reserve the lane to **events not yet promoted**.
- Acceptable alternative: keep the current behavior but rename the chip eyebrow from "Live Wire" to "Live Wire — not in Moments yet" so the user understands the lane is a **backlog of unreviewed events**, not a duplicate list.

### `hub-ia‑2` · Honest preview density on the bucket rail

- The `clip-tools` reserved slot is dead code today. Either **remove the reserved slot** (audit + small CSS delete), or wire a real “Top channels this bucket” preview pulled from `bucketMoments` (use `aggregateFromFigmaMoments` → `topChannels`). Recommend removal in Phase 2b; replacement is a follow‑on.
- Range‑mode empty state already exists for streamers; preview/selected mode should hide the streamers footer entirely (today it already returns `[]` for non‑range modes — ✓). Leave it.

### `hub-ia‑3` · Linked‑moment strip placement

- The strip is rendered above the chrome when `linkedMoment` is present. Confirm (browser) that it does not push the inspector out of viewport at narrow widths (`< 480px`) — if it does, fold the strip into a chip in the chrome header. Today no responsive test, so this is a "measure first" task.

### `hub-ia‑4` · New‑event animation cap

- Current cap: `MAX_NEW_ANIMATIONS_PER_POLL = 3`. ✓ Matches P1 spec.
- Animation handler: `animateEnterHorizontal` for lane/ticker (`x: -24, opacity: 0, 350ms power3.out`). ✓ Honors `motionEnabled` (early return in GSAP wrapper). Check CSS for `prefers-reduced-motion` override on this keyframe (none today); add one.

### `hub-ia‑5` · Lifecycle kinds stay in Pool Wire only

- Live Wire filters with `!isLifecycleMomentKind(m.kind)`. ✓ Verified at landing‑page level.

### `hub-ia‑6` · Section IDs live on the route

- Sidebar anchor IDs (`section-overview`, `section-live-wire`, …) are wired. No regression risk.

## B.5 Non‑goals for `hub-ia`

- Do not introduce a new client‑side Pulse ranking.
- Do not move moment inspector into the chart rail on hub landing.
- Do not turn Live Wire into a horizontal ranked Moments table.
- Do not duplicate the emote‑velocity leaderboard in Live Wire (`topMovers` lives only in Emote Market — verify in browser).
- Do not change the freshness window without a backend contract change.

## B.6 Blockers affecting the adaptive chart track

- `selectedBucketT` and `hoverBucketT` are two top‑level states in the landing page. Press‑drag should commit only the active bucket without spawning a third state. → §C.1
- Crossfade timing must coexist with the 80ms hover‑intent debounce in `FigmaGlobalActivityPanel`. If debounce > crossfade, the detail layer flickers in late. → §C.2
- The bucket inspector's `transitionInspector` GSAP call (`opacity 0.6, scale 0.98, 0.25s power2.out`) runs on every `selectedPoint.t` change. Adaptive chart lock → it will re‑fire. Decide whether to keep this transition or disable it during press‑drag. → §C.3

---

# C — Combined deliverable + shared blockers

## C.1 Phase 2a (chart) summary

- **Stack**: keep custom SVG + `@streampulse/pulse-charts`, add a single `<g class="hx-detail-layer">` overlay.
- **Rest**: existing viewers curve + new averaged envelope (max‑window 10–15min, extrema‑preserving).
- **Detail**: same X/Y, second copy of the curve (with bucket‑highlights & dots), tooltip, crosshair.
- **Press‑drag**: pointerdown→drag→up commits; touch‑action suppressed on canvas.
- **Keyboard**: `tabIndex={0}`, arrows / Home/End / Shift+Arrow.
- **Reduced motion**: extend `hub.css` reduced‑motion block to include bucket‑cue bounce, ring and refresh pulse.
- **Misleading‑viz guardrails**: Y‑clamp in resting curve; never sample‑drop in `preview` mode.
- **Out of scope (B‑side concerns)**: do not move moment inspector into the rail, do not reintroduce `HubMomentRailBody`-style clones.

## C.2 Phase 2b (hub‑ia) summary (ranked)

1. `hub-ia-1` — suppress Live Wire rows that already appear in Pulse Moments for the same range (or rename eyebrow to clarify).
2. `hub-ia-2` — remove dead `clip-tools` reserved slot or wire it for real preview density.
3. `hub-ia-3` — narrow‑viewport check on Linked‑moment strip.
4. `hub-ia-4` — add reduced‑motion override for `animateEnterHorizontal` keyframes.
5. `hub-ia-5` — confirm lifecycle kinds do not leak into Live Wire (already done; verify visually).
6. `hub-ia-6` — confirm sidebar section IDs and Live Wire lane id `#section-live-wire`.

## C.3 Shared blockers

1. **Bucket lock ↔ scrub collision** — both `selectedBucketT` and `hoverBucketT` exist. Press‑drag and click both call `onBucketSelect`. Phase 2a must pick one bucket model: commit on release, **no separate "scrub bucket" state**. If a user wants to lock a bucket while still hovering elsewhere, we'll wait for click — this matches the existing behavioral contract.
2. **80ms `hoverIntentTimerRef` debounce** in `FigmaGlobalActivityPanel.handleBucketHover` runs **longer** than the proposed crossfade. **Adapt the chart to read from the actual local hover index for crossfade (no parent propagation needed)** so the detail layer appears instantly even if the rail preview hasn't switched yet. Keep the 80ms debounce for the rail.
3. **`transitionInspector` GSAP fires on every selectedPoint change.** The press‑drag will trigger this each release. Either (a) gate it to "non-pointer-lock transitions" only, or (b) shorten to a 120ms opacity‑only tween (CSS) for press‑drag. Default: (a) — gate `transitionInspector` on a new `transient = !pressDraggingRef.current` flag threaded through props.
4. **Chrome DevTools MCP / Playwright** verification gap — re‑run with browser tools before merging Phase 2 changes. Add a 5‑minute manual checklist to PR description.

## C.4 Verification before any Phase 2 PR merges

- `cd streampulse-web && npm run typecheck` — clean.
- `npm test` — focused vitest for `splitLinePaths`, `buildCalmEnvelope`, `activityBucketKey`.
- `npm run check:analytics-overlap` — must not regress.
- Browser (Chrome DevTools MCP):
  1. Resting state at 1280×800 and 390×844.
  2. Hover preview, locked bucket, pointer exit.
  3. Moment marker click selects the same row in Pulse Moments.
  4. Press‑drag commits on release, suppresses native scroll.
  5. Keyboard arrows move the crosshair; Home / End jump; Shift‑Arrow steps by 5.
  6. `prefers-reduced-motion: reduce` shows instant detail and no bounce.
  7. Empty (`No live channels`), sparse (no recent buckets), volatile (peak) states all render without console errors.
- No Y‑domain jump on hover. No tooltip layout shift. No duplicate Pulse Moments lists. No moment body in the chart rail.

---

## Open questions for the user before Phase 2

1. Browser‑verification gap above — do you want me to install Playwright (`npx playwright install chrome`) to capture screenshots before editing, or proceed with code‑only Phase 2 and verify at PR time?
2. A.4 trade‑off: do you want the new averaged resting curve, or keep the current single curve and skip A.3.1?
3. A.4 trade‑off: commit press‑drag on release vs commit on press? Recommendation: release.
4. B.4.1 trade‑off: suppress Live Wire rows that already appear in Pulse Moments, or just rename the eyebrow?
