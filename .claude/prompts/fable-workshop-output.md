# Opus 5 Workshop — StreamPulse `/analytics` + Pulse extension

> Run date: 2026-07-29. Everything below was inspected, not inferred. Where I did not
> verify something, I say so.

---

## Mode 0 — The thing nobody told me, which invalidates the brief

I have to lead with this because it changes how you read every other section.

**The code in this workspace is not the code the brief describes, and not the code the dev server is running.**

| Claim in brief | Reality |
|---|---|
| `HubActivityChart.tsx` is 1442 lines | Workspace copy is **1130** lines. |
| `hub.css` is 3507 lines | Workspace copy is **3392** lines. |
| `tests/hubActivityChartDetailLayer.test.tsx` — 15/15 passing | **Does not exist** in this workspace. |
| `buildLinearLine`, `.hx-chart-detail-layer`, `prevInspectorModeRef` | **Zero matches** in this workspace (grep across all of `c:\Users\Aron\streamclone-pulse`). |
| `hubChartActivityModel.ts` does path generation | It does **not**. It is 57 lines and computes three peak scalars. `splitLinePaths` lives in `HubActivityChart.tsx`. |

I found the real code. The Vite server on `127.0.0.1:5173` serves from:

```
C:\Users\Aron\AppData\Local\Temp\streamclone-pulse-audit\streampulse-web
```

A `/@fs/` probe for the workspace path returns **403** (outside `fs.allow`); the temp clone's
`HubActivityChart.tsx` is **1442 lines**, `hub.css` is **3507**, and the test file exists at
**166 lines**. Every number in the brief matches the temp clone exactly.

Two more facts:

- **The workspace is 51 commits behind the temp clone.** `git rev-list --count HEAD..72d2b81` = **51**;
  the reverse is **0**. Both are on a branch called `master`. They are separate clones, not worktrees.
- **The entire Phase-2a chart feature is staged-but-uncommitted inside `%TEMP%`:**
  `+240` lines `HubActivityChart.tsx`, `+59` `hub.css`, `+166` test, `+20` `FigmaGlobalActivityPanel.tsx`,
  `+4` `HubLiveWireFeed.tsx`. Nothing is committed. Windows cleans `%TEMP%`.

**Before any idea in this document: `git -C "%TEMP%\streamclone-pulse-audit" commit` and push the branch.**
Everything else in this review is worth less than that one command. I am not going to pad the rest of the
document pretending this is a normal design review when the artifact under review lives in a directory the
OS is allowed to delete.

I also confirmed the brief's extension file list is ~43% fictional. Of 21 cited paths under `src/ui/`:

- **Absent:** `ChatActivityChart.tsx`, `EmoteLaneChart.tsx`, `SegmentedPulseChart.tsx`,
  `ChatActivityInspector.tsx`, `VodReplayPulse.tsx`, `VodPulseTimeline.tsx`, `VodBestClipCard.tsx`,
  `VodCurrentMomentCard.tsx`, `VodTopMomentsList.tsx` (9 of 21).
- `src/vod/` contains exactly two files, both pure data adapters, no UI.
- The "chart family of four" is **two** components: `PulseOverviewChart.tsx` (1126) and
  `RecapTimelineChart.tsx` (435, no SVG at all).

So the Mode B question "are the four extension charts duplicating work?" is void. I answer the real
question instead.

Where I cite line numbers below, **`chart.tsx:NNN` means the temp clone's `HubActivityChart.tsx`** —
the code that actually runs.

---

## Mode A — Brainstorm

### Category 1 — Chart interaction (three developed fully)

**Idea 01 — Kill the crossfade; make the detail reveal a *resolution* change, not a *geometry* change**

- Problem: The shipped detail layer draws a second path that is geometrically identical to the first. Measured on the live page with real production data: the viewers detail line deviates from the rest line by **max 0.92px, mean 0.136px**, and exceeds the 1.6px stroke width across **0%** of the chart. It is invisible. The emotes line only clears its own stroke on 18% of the width.
- Proposal: Delete the linear/smooth crossfade. Replace "detail" with *more buckets*: at rest render the 209 buckets decimated to ~70 (`largest-triangle-three-buckets`, ~30 lines, no dependency); on scrub render all 209 within a ±15% window around the cursor. The user gains actual information instead of a re-drawn identical curve.
- Touch points: `chart.tsx:519` (`viewerLinearLines`), `chart.tsx:533` (`totalEmoteLinearLines`), `chart.tsx:1138–1166` (detail `<g>`), `hub.css` detail-layer block.
- Token budget: uses `--sp-chart-viewers`, `--sp-chart-emotes`, `--sp-chart-stroke-width` (currently ignored — see Finding B-07). Adds nothing.
- Motion budget: none for the geometry. One 140ms opacity fade on the *added* buckets only, `cubic-bezier(0.16, 1, 0.3, 1)` (already in the plan doc's approved list).
- Defends against "vibe code": it is the only version of rest→detail where a measurement proves the user receives new pixels. The current one provably does not.

**Idea 02 — Scrub-to-arm, release-to-pin, with the pin living in the rail (not the plot)**

- Problem: The tooltip covers **24.1% of the plot area** while you scrub (measured: 252×224px tip over a 902×260px plot). You obscure the data you are reading in order to read it.
- Proposal: Scrubbing shows only the crosshair + a 1-line value strip pinned to the chart's *top edge* (never over the curve). Release commits the bucket into the existing `ActivityBucketInspector` in the right rail, which is already 350×525px and already exists. The heavy tooltip is deleted.
- Touch points: `chart.tsx:1279–1420` (`.hx-chart-tip-slot` + `.tip`), `ActivityBucketInspector.tsx`, `hub.css:2023–2160`.
- Token budget: `--sp-surface-2` for the value strip, `--sp-type-meta` for its text, `--sp-border`. Adds nothing.
- Motion budget: value strip cross-fades text only, 120ms. No position animation — it is fixed to the top edge.
- Defends against "vibe code": it deletes 140 lines of tooltip markup and reuses a panel that is already on screen and already empty at rest. Net negative complexity.

**Idea 03 — Two-handle range scrub, replacing single-bucket selection**

- Problem: The chart is a 209-bucket, 24-hour aggregate. Selecting *one* ~6-minute bucket out of 24 hours is the wrong quantum for "what happened on the network today". The current interaction answers a question nobody has.
- Proposal: Press-drag defines a **span**, not a point. Release filters Pulse Moments to `[t0, t1]`. Single tap still selects one bucket (backwards compatible with `resolveChartBucketSelection`). The existing `BucketSelectionCue` renders twice, with a tinted band between.
- Touch points: `chart.tsx:770–885` (press-drag handlers already track `pressStartRef.index` and a final index — the span is *already computed*, it is just thrown away at `chart.tsx:868`), `resolveChartBucketSelection` in `hubActivitySummary.ts`, `FigmaGlobalActivityPanel` bucket props.
- Token budget: band fill `--sp-accent-bg`; edges `--sp-border-strong`. Adds nothing.
- Motion budget: none. The band tracks the pointer 1:1 — a range selection that lags its own cursor is broken, not smooth.
- Defends against "vibe code": the press-drag machinery is already built and already discards the start index. This is finishing an interaction that is currently half-implemented, not adding one.

### Category 2 — Live Wire lane

**Idea 04 — Live Wire becomes the chart's x-axis annotation gutter, not a rail**

- Problem: Live Wire is currently a horizontally-scrolling chip rail with `‹ ›` arrows sitting directly above a chart that also has a horizontal range-tab row, a legend row, and a provider-chip row. That is **4 control rows above the plot** (measured), and the plot is only **19.8% of the panel's 1316px height**.
- Proposal: Collapse the rail into a 20px gutter strip immediately under the plot's x-axis. Each fresh peak is a tick at its bucket's x position with a 1-line label on hover. It stops being a list and becomes what `analytics-product-refactor-audit-2026-07-10.md:11` already says it should be: "a truly live annotation layer for the activity chart".
- Touch points: `HubLiveWireFeed.tsx` `layout="lane"` branch, `FigmaGlobalActivityPanel.tsx:470` (`__annotation-lane` wrapper), `hub.css` axis block.
- Token budget: `--sp-surface-3` ticks, `--sp-accent` for `NEW`, `--sp-type-label`. Adds nothing.
- Motion budget: new tick fades in over 180ms and nudges 4px upward once. Job: *orient* — tells you a new event landed and exactly where in time.
- Defends against "vibe code": your own audit doc specified this in July and it was not built. This is closing a written gap, and it removes a scroll rail rather than adding a surface.

**Idea 05 — First/last bookend instead of "newest first"**

- Problem: The lane header now reads `Live wire · Last 30m` with meta `newest first` (`HubLiveWireFeed.tsx:187`, `:370`). Both halves are chrome describing sort order. Nobody needs to be told a live feed is newest-first.
- Proposal: Replace the meta with the actual window bookend: `8:52 → 9:22`. One string, real information, same pixels.
- Touch points: `HubLiveWireFeed.tsx:369–374`.
- Token budget: `--sp-type-meta`, `--fma-mono` for the timestamps. Adds nothing.
- Motion budget: none.
- Defends against "vibe code": strictly replaces a tautology with a fact at identical cost.

**Idea 06 — Cascade threading (2 emotes, one line, one arrow)**

- Problem: Live Wire chips are independent atoms. The interesting network fact is *contagion* — the same emote breaking out on channel B four minutes after channel A.
- Proposal: When two peaks within the window share a dominant emote, render them as one chip with a `→` and both channel avatars: `LUL  xQc → forsen  +4m`. Requires only data already in `livePulseMoments` (each moment carries its top emote and its channel).
- Touch points: `HubLiveWireFeed.tsx` moment-grouping (currently `collectFreshKeys` / lifecycle filter only).
- Token budget: `--sp-accent-dim` for the connector, existing avatar sizing.
- Motion budget: none. The arrow is static; it is a fact, not a transition.
- Defends against "vibe code": StreamPulse is the only product that sees all 330 tracked channels at once. Cross-channel contagion is the one insight nobody else can render. Everything else on this page is available per-channel elsewhere.

### Category 3 — Pulse Moments row

**Idea 07 — Click-to-lock pans the chart window to the moment**

- Problem: Selecting a moment sets `accentBucketT`, which draws a faint cue somewhere in a 24-hour, 902px-wide plot. At 4.34px per bucket the cue is a hairline in a haystack.
- Proposal: Selecting a moment switches the chart to a 2-hour window centred on it and marks the return path with a `← 24h` chip. Range control already supports arbitrary windows.
- Touch points: `AnalyticsLandingPage.tsx:396` (`momentMarkers`), `HubActivityRangeControl`, `FigmaGlobalActivityPanel.tsx:487`.
- Token budget: `--sp-surface-3` chip, `--sp-accent-strong` label. Adds nothing.
- Motion budget: the existing `fadeThemeCenter` window crossfade already runs on window change (`FigmaGlobalActivityPanel.tsx:~390`). Reuse it. Zero new motion.
- Defends against "vibe code": reuses the window crossfade that is already wired and currently only fires on manual tab clicks.

**Idea 08 — Hover-to-preview is already built and currently fights itself; make it one hop**

- Problem: Hover intent is debounced in **three** places: `commitHoverIndex` rAF-throttles (`chart.tsx:~700`), `handleBucketHover` adds an 80ms `setTimeout` (`FigmaGlobalActivityPanel.tsx:~240`), then a `useEffect` re-emits it (`FigmaGlobalActivityPanel.tsx:~350`). Three layers of latency stacked on one pointer move.
- Proposal: Delete the rAF throttle and the effect hop. Keep the 80ms intent timer, in the parent only. One debounce, one owner.
- Touch points: `chart.tsx` `hoverRafRef` / `commitHoverIndex`, `FigmaGlobalActivityPanel.tsx` `hoverIntentTimerRef` + the re-emit effect.
- Token budget: none.
- Motion budget: none (removes latency).
- Defends against "vibe code": it is a deletion. Three debounces is not "responsive", it is three people having solved the same problem separately.

**Idea 09 — Drag-to-reorder is wrong; bookmarks (R10) want a keyboard verb**

- Problem: I was asked whether moment cards want drag-to-reorder for personal bookmarks. They do not: the ordering that matters (time, or Pulse score) is computed, and a manual order is a third truth to keep honest.
- Proposal: Bookmarks get one verb, `B`, on the focused moment, and a count badge on the section header. No ordering, no drag.
- Touch points: `PulseMomentRow.tsx` (extension, 179 lines), portal moments table.
- Token budget: `--sp-accent` badge, `--sp-type-label`.
- Motion budget: 100ms badge scale on add. Job: *confirm*.
- Defends against "vibe code": R10's metaphor is "remember this", not "curate this". Drag-to-reorder is a Trello reflex, not a StreamPulse one.

### Category 4 — Extension overlay on Twitch

**Idea 10 — The visual contract is: Pulse owns the sidebar's vertical rhythm, never its z-index**

- Problem: `Overlay.tsx` is **1899 lines** and `LiveStatsBand.tsx` is **1047**. An overlay that large will inevitably start competing with Twitch chrome by accretion. There is no written contract to push back against.
- Proposal: Write one rule and enforce it in the mount test: Pulse renders *inside* Twitch's chat column flow at Twitch's own row height, and never uses `position: fixed` on a channel page. The only exception is the opt-in `chatClosedPulseDockEnabled` dock, which is already gated.
- Touch points: `src/content/twitchSidebarChrome.ts`, `src/content/mount.tsx`, `tests/mountPlacement.test.ts`, `tests/mountStyles.test.ts`.
- Token budget: read Twitch's `--color-background-base` / row metrics; no StreamPulse surface tokens on the outermost node.
- Motion budget: none. A parasite is a thing that moves when its host does not.
- Defends against "vibe code": "don't look like a parasite" is unenforceable as taste and trivially enforceable as a mount test. You already have two mount test files to put it in.

**Idea 11 — One chart component for the overlay, not one per surface**

- Problem: `PulseOverviewChart.tsx` is 1126 lines with 1 `<svg>`, 5 `<path>`, 14 `<rect>`. `RecapTimelineChart.tsx` is 435 lines with **no SVG at all** — it is a CSS-bar chart. The same product renders "activity over time" two structurally incompatible ways.
- Proposal: Recap adopts the overview's SVG stack. Not a shared abstraction — a deletion of the CSS-bar implementation.
- Touch points: `src/ui/RecapTimelineChart.tsx`, `src/ui/PulseOverviewChart.tsx`.
- Token budget: whatever `PulseOverviewChart` already uses.
- Motion budget: none.
- Defends against "vibe code": **not a drop-in** — this is >100 lines. Flagging it as such. But two rendering models for one concept is how you get two sets of bugs.

### Category 5 — Recap (R12)

**Idea 12 — The 60-second recap is one sentence and one number**

- Problem: `StreamRecapSection.tsx` is 1025 lines. Whatever it shows at second 60, it is not one sentence.
- Proposal: On stream end, the panel collapses to: *"4h 12m · peak 3.1K chat/min at 21:47 · LUL ran the night."* Everything else is behind "Full recap". The 5-minute view is the current panel. The next-day view is a link to the portal session route.
- Touch points: `StreamRecapSection.tsx`, `RecapAnalyticsNav.tsx`.
- Token budget: `--sp-type-title` for the sentence, `--fma-mono` for the number.
- Motion budget: 200ms collapse on stream-end detection. Job: *transition* — marks that the stream is over.
- Defends against "vibe code": it is a *time-boxed* information hierarchy, tied to the three concrete horizons the brief asked about, not "let's add a summary card".

**Idea 13 — Recap's empty state teaches the coverage model**

- Problem: The brief bans generic empty states. Recap has the best possible teaching moment and I have not verified it uses it (I read the file list, not all 1025 lines — flagging that).
- Proposal: When recap has no data, say why in coverage terms: *"No recap — Pulse joined this channel 14 minutes before it ended. Recaps need 30 minutes of chat coverage."* That single string explains the collector model, the 30-minute floor, and why the user should keep the tab open.
- Touch points: `StreamRecapSection.tsx` empty branch.
- Token budget: `--sp-text-muted`, `--sp-type-body`.
- Motion budget: none.
- Defends against "vibe code": it is copy that changes user behaviour (keep the tab open), not copy that fills a box.

### Category 6 — Tokens the system actually needs

**Idea 14 — `--sp-chart-stroke-width-detail` and `--sp-motion-reveal`**

- Problem: The detail layer hardcodes `stroke-width: 1.6`, `1.4`, `opacity: .85`, `.75`, `transition: opacity 180ms ease` — while `--sp-chart-stroke-width: 1.5` **already exists and is ignored** (verified via `getComputedStyle`).
- Proposal: Add exactly two tokens: `--sp-chart-stroke-width-detail` and `--sp-motion-reveal: 160ms cubic-bezier(0.16, 1, 0.3, 1)`. Every hardcoded chart reveal duration in `hub.css` points at the second one.
- Touch points: `analytics-surfaces.css:38–39`, `hub.css:1590–1620`.
- Token budget: **adds 2.** Justified: no existing token expresses "the duration of a reveal"; `--sp-chart-stroke-width` exists but has no detail-tier sibling.
- Motion budget: n/a (it *is* the motion budget).
- Defends against "vibe code": the brief demanded I only propose tokens the system lacks. These are the only two I found that pass that bar.

**Idea 15 — `--sp-data-gap` (and delete the hatch)**

- Problem: Gap bands are hatched diagonal stripes and consume **12.5% of chart width** on the live page right now. Hatching is the loudest possible treatment for the *absence* of data. `--sp-surface-inset` exists but is not used for this.
- Proposal: One token, `--sp-data-gap`, resolving to a flat 4% desaturation of `--sp-bg`. Gaps recede; the note stays.
- Touch points: `hub.css` `.gap-fill` / `.gap-fill--internal` / `.gap-fill--chat-rollup`.
- Token budget: **adds 1.**
- Motion budget: none.
- Defends against "vibe code": screenshot evidence — the chart currently reads as *broken* because missing data shouts louder than present data.

### Category 7 — Three features to remove

**Idea 16 — Remove the viewers detail path entirely**

- Problem: Measured max deviation **0.92px**, mean **0.136px**, **0%** of the chart above stroke width. It renders nothing.
- Proposal: Delete `viewerLinearLines` (`chart.tsx:519`) and its `<path>` block. Keep the emotes one *only* if Idea 01 is rejected (18% of width, so it is at least arguable).
- Touch points: `chart.tsx:519–532`, `chart.tsx:1139–1150`, `hub.css` `.hx-chart-line--viewers-detail`.
- Token budget: removes hardcoded values.
- Motion budget: removes a `mix-blend-mode: screen` repaint (see Finding B-03).
- Defends against "vibe code": there is no aesthetic argument for a line you cannot see.

**Idea 17 — Remove `providerLines` or `providerLaneLines` — one of them is always dead**

- Problem: `chart.tsx:423` and `chart.tsx:436` both build 4 path-sets for all 4 providers, unconditionally. `providerLines` renders only when `showProviderOverlay` is true; `providerLaneLines` only when it is false. **8 sets built, at most 4 ever used, on every model rebuild.**
- Proposal: Move both inside a `showProviderOverlay` branch.
- Touch points: `chart.tsx:423–450`.
- Token budget: none.
- Motion budget: none.
- Defends against "vibe code": pure dead work, provably unreachable in half of all renders.

**Idea 18 — Remove the second and third `aria-live` regions**

- Problem: Three live regions on one chart: `.hx-chart2` (`chart.tsx:1035`), `.hx-chart-sr` **nested inside it** (`chart.tsx:1168`), and `.hx-chart-tip-slot` (`chart.tsx:1279`). A page-wide scan found 5 total.
- Proposal: Keep `.hx-chart-sr` only. Remove `aria-live` from `.hx-chart2` and from `.hx-chart-tip-slot`. Also drop `role="status"` from `.hx-chart-sr` (it implies `aria-live="polite"` — the pair is redundant).
- Touch points: `chart.tsx:1035`, `chart.tsx:1168`, `chart.tsx:1279`.
- Token budget: none.
- Motion budget: none.
- Defends against "vibe code": nested live regions are not "extra accessible", they are a screen-reader denial-of-service.

---

## Mode B — Audit, ranked by impact

### B-01 — The feature under review is uncommitted, in `%TEMP%`, on a clone 51 commits ahead of this workspace — **severity: critical**

- **What:** `C:\Users\Aron\AppData\Local\Temp\streamclone-pulse-audit`, staged-not-committed: `+240` chart, `+59` css, `+166` test, `+20` panel, `+4` wire.
- **Why:** Windows reclaims `%TEMP%`. There is no remote copy. The reviewed artifact can cease to exist between this review and a decision on it.
- **Cost:** Total loss of the Phase-2a work.
- **Fix sketch:** `git commit` + `git push -u origin phase2a-chart-detail`, then re-point the dev server at a durable checkout. ~2 lines. Do this first.

### B-02 — Scrubbing the chart generates **319 layout shifts and 0.216 CLS** — **severity: high**

- **What:** `PerformanceObserver({type:'layout-shift'})` on a fully-settled page, single 61-step scrub, zero baseline before the scrub: **CLS 0.216**. Sources: `hx-provider-lane__cross` ×139, `tip` ×64, `cross hx-crosshair` ×64, `hdot hx-crosshair--emotes` ×52.
- **Why:** Every crosshair and dot is positioned with percentage `left`/`top` inline styles — `chart.tsx:1265`, `:1269`, `:1273`, `:1202`, plus the provider-lane crosses. `left`/`top` mutate layout; `transform` does not. `useSmoothedScalar` drives three of these at rAF cadence (`chart.tsx:616–624`), so each animation frame is a layout pass.
- **Cost:** At **4× CPU throttle** (a normal mid-tier laptop) the scrub runs at **p50 36.9ms/frame ≈ 27fps**; **73 of 85 frames** blow the 16.67ms budget and **54** exceed 33ms. At 1× it is p50 4.2ms with a 94.8ms spike. **Honesty note:** because I dispatched synthetic events, `hadRecentInput` was false; with real input Chrome excludes these from the reported CLS metric, so your *field* CLS is probably unharmed. The **layout work is real regardless** — that is what the 27fps measures.
- **Fix sketch:** Swap `left: X%` / `top: Y%` for `transform: translate3d(calc(var(--hx) * 1%), calc(var(--hy) * 1%), 0)` on the crosshair spans, feed `--hx`/`--hy` as CSS custom properties, add `will-change: transform`. ~40 lines across `chart.tsx` and `hub.css`. Drop-in.

### B-03 — The detail layer is invisible where it matters most — **severity: high (design)**

- **What:** Compared the *actual rendered* `d` attributes on the live page. Viewers: **max vertical deviation 0.92px, mean 0.136px, 0.0% of chart width exceeds the 1.6px stroke**. Emotes: max 10.71px, mean 0.98px, 18% of width. Both paths have identical command counts (92 vs 92).
- **Why:** 209 buckets across 902px = **4.34px per bucket**. A Catmull-Rom spline and a polyline through the same points at 4.34px spacing cannot diverge visibly. The pattern was copied from a chart with ~50 points across the same width.
- **Cost:** A second full `<path>` set, a `mix-blend-mode: screen` (which forces stacking-context isolation and blocks GPU fast paths), and an opacity transition — for zero visible pixels on the viewers series.
- **Fix sketch:** Idea 16 (delete viewers detail) or Idea 01 (make it a resolution change). Both ≤100 lines.

### B-04 — Bucket selection is **not keyboard operable** — **severity: high (a11y, functional)**

- **What:** `handleKeyDown` (`chart.tsx:886`) handles `Home`, `End`, `ArrowLeft`, `ArrowRight` — and nothing else. `selectIndex` (`chart.tsx:904`) calls `commitHoverIndex` + `setAnnouncement`. **It never calls `onBucketSelect`.** There is no `Enter`, no `Space`, no `Escape`.
- **Why:** The old `onClick` was replaced by `onPointerDown`/`onPointerUp` in this diff. Commit now happens exclusively in `finalizePress`, which is unreachable without a pointer.
- **Cost:** A keyboard user can move a cursor along the chart forever and can never select a bucket or filter Pulse Moments. This is the chart's only purpose.
- **Fix sketch:** In `handleKeyDown`, add `if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); finalizePressFromIndex(hover ?? selectedIndex) }` and `if (event.key === 'Escape') onBucketSelect?.(null)`. Extract the commit body of `finalizePress` into a helper. ~20 lines. Drop-in.

### B-05 — `role="img"` + `tabIndex={0}` + `aria-live="polite"` on the same node — **severity: high (a11y)**

- **What:** `chart.tsx:1033–1036`. Verified in the live DOM: `role=img`, `tabindex=0`, `aria-live=polite`, containing a second live region at `chart.tsx:1168`, with a third sibling at `chart.tsx:1279`.
- **Why:** `role="img"` makes the subtree presentational — the arrow-key affordance is invisible to AT, and a focusable image announces as "image, 0 items". Layering `aria-live` on it means every crosshair span add/remove inside re-triggers the region. Measured **21.6 DOM mutation records per pointer move** (1319 over a 61-step scrub, 637 attribute + 276 childList).
- **Cost:** Screen-reader announcement flooding during scrub; the interaction is undiscoverable to keyboard AT users.
- **Fix sketch:** `role="img"` → `role="group"` + `aria-roledescription="interactive activity chart"` + `aria-keyshortcuts="ArrowLeft ArrowRight Home End Enter"`. Remove `aria-live` from `chart.tsx:1035` and `chart.tsx:1279`. Remove `role="status"` from `chart.tsx:1168`. ~8 lines. Drop-in.
- **On the brief's "locked decision":** `aria-live="polite"` not `role="application"` — the second half was right, the first half is wrong. The answer is *neither on this node*.

### B-06 — The chart never returns to calm rest — **severity: high (design, contradicts the stated goal)**

- **What:** `chart.tsx:334`: `const detailActive = hover != null || pressDragging || selectedBucketT != null`. Verified live: after a single scrub-and-release, with the pointer off the chart, `data-detail-active="true"` and computed `opacity: 1`.
- **Why:** Selection is sticky (by design), so the detail layer is sticky too.
- **Cost:** The premise "calm rest → reveal detail → smooth return" is false after the user's first click. Every subsequent visit to the page is in permanent detail mode.
- **Fix sketch:** `const detailActive = hover != null || pressDragging`. One line. If selected buckets need emphasis, that is what `BucketSelectionCue` is for — it already exists.

### B-07 — Detail strokes use shadcn fallbacks and ignore the design system — **severity: medium (token discipline)**

- **What:** `hub.css`: `stroke: hsl(var(--sp-chart-viewers, var(--chart-2)))`. Verified computed values: `--sp-chart-viewers` = `210 12% 78%` (near-white), `--chart-2` = `280 65% 68%` (**purple — the same hue as the chat bars**). Widths `1.6`/`1.4` hardcoded while `--sp-chart-stroke-width: 1.5` exists and is unused. Duration `180ms` hardcoded.
- **Why:** Fallback chain reaches into the shadcn baseline instead of the `--sp-*`/`--fma-*` system that `analytics-surfaces.css:1–13` explicitly mandates.
- **Cost:** If the token ever fails to cascade, the "precise" viewers line renders in chat-bar purple. Plus 5 magic numbers outside the system.
- **Fix sketch:** Drop the `var(--chart-2)` / `var(--chart-4)` fallbacks; adopt Idea 14's two tokens. ~10 lines.

### B-08 — `mix-blend-mode: screen` makes the "precise" line's colour depend on chat volume — **severity: medium (design)**

- **What:** `hub.css` detail block; verified computed `mixBlendMode: "screen"` on both detail strokes.
- **Why:** `screen` composites against whatever is behind. Behind the viewers line is a field of purple `.hx-chat-bar` rects whose height varies per bucket. So the detail line's rendered colour shifts with chat volume.
- **Cost:** A layer whose stated job is *precision* renders in a colour that is a function of an unrelated series. Plus forced isolation + per-frame repaint during the 180ms transition.
- **Fix sketch:** Delete both `mix-blend-mode` declarations; raise opacity to compensate. 2 lines.

### B-09 — One of the 15 "passing" tests asserts nothing — **severity: medium (test integrity)**

- **What:** `hubActivityChartDetailLayer.test.tsx:141` — `'rest area paths use smooth geometry (with C commands)'` queries `.hx-chart-area--viewers, .hx-chart-area--emotes` and wraps every assertion in `if (restArea.length > 0)`. I grepped the entire `streampulse-web/src` tree: **`hx-chart-area` occurs 0 times.** The selector can never match. The test is a guaranteed green no-op.
- **Why:** Class name drift between test and component, hidden by a defensive `if`.
- **Cost:** 15/15 is really 14/15. I ran it: `Tests 16 passed` across both chart files — so it is genuinely green, which is exactly the problem.
- **Fix sketch:** Point it at `.hx-chart-line--viewers:not(.hx-chart-line-underlay)` and drop the `if`. 3 lines.

### B-10 — The extension's chart tests are **copies of the logic, not tests of it** — **severity: medium (test integrity)**

- **What:** `tests/overviewChartWidth.test.ts:1–31` imports nothing from `PulseOverviewChart.tsx`. It re-declares `PAD_LEFT = 4`, `PAD_RIGHT = 12`, `DEFAULT_WIDTH = 320` and re-implements `resolveOverviewWidth` / `resolvePlotWidth` inside the test file, under the comment *"Mirrors PulseOverviewChart width / plotWidth guards."* `chartWindowHydrationRace.test.ts` does the same for `LiveStatsBand`.
- **Why:** Mirror-testing. The test verifies its own copy.
- **Cost:** `PulseOverviewChart.tsx` (1126 lines) and `RecapTimelineChart.tsx` (435 lines) have **zero real component coverage**. Change `PAD_RIGHT` in the component and every test still passes. The historical `width: -15` bug the test commemorates could be reintroduced tomorrow, silently.
- **Fix sketch:** Export the two guards from the component and import them. ~6 lines each side. **Genuinely worth doing** — this is the highest-value/lowest-cost item in the whole audit.

### B-11 — Mouse moves are handled twice — **severity: low (correctness smell, *not* a perf problem)**

- **What:** `chart.tsx:1037` `onMouseMove={handleMove}` (ungated) and `chart.tsx:1040` `onPointerMove={... handlePointerMove}`. A real mouse fires both. Both call `nearestPointIndex` (an O(n) scan + a `getBoundingClientRect()` layout read).
- **Cost — measured, and it is small:** 61-step scrub, both = **376ms**, pointer-only = **352ms**, mouse-only = **344ms**. **0 long tasks in all three.** So ~30ms over a 61-move scrub, ~0.5ms per move.
- **Fix sketch:** Delete `onMouseMove`/`onMouseLeave` and handle `pointerleave` instead. ~6 lines. Do it for clarity, not for speed.

### B-12 — `storedProviders` is keyed on bucket count — **severity: low**

- **What:** `chart.tsx:584`: `useMemo(() => readStoredProviders(), [chartPoints.length])`.
- **Why:** A synchronous `sessionStorage.getItem` + `JSON.parse` re-runs whenever the number of buckets changes — a dependency with no causal relationship to stored provider prefs.
- **Cost:** Negligible time; it is a correctness landmine (a poll that changes bucket count silently re-reads persisted UI state).
- **Fix sketch:** `[]`. One line.

### B-13 — A comment states the opposite of what the code does — **severity: low**

- **What:** `chart.tsx:882–883`: `// Restore the prior hover state — no commit on cancellation.` followed by `flushHover(null)`, which **clears** hover.
- **Fix sketch:** Fix the comment, or actually restore. One line either way.

### B-14 — Parity contract violation: `hub.css` and `hubx` are on the `/analytics` landing — **severity: medium (contract)**

- **What:** `analytics-figma-parity-requirements.md` §6 — *"Do not use on the `/analytics` landing: `hub.css`"*. But `FigmaGlobalActivityPanel.tsx:31` does `import "../hub/hub.css"` and `:481` renders `className="hubx figma-global-activity__chart ..."`. Live DOM: **3 `.hubx` nodes** on `/analytics`.
- **Why:** The hub chart was embedded into the Figma shell without updating the contract. `analytics-surfaces.css:69` even has a `.figma-analytics .hubx` compatibility block — the violation is institutionalised in the token layer.
- **Cost:** Either the doc is wrong or the page is. Right now a reader cannot tell which, and 3392–3507 lines of `hub.css` ship on a route that claims not to load it.
- **Fix sketch:** Not a code fix — amend §6 to permit the embedded chart explicitly, or extract the chart's styles. Decide and write it down.

### B-15 — The parity doc contradicts itself on game segments — **severity: low (doc)**

- **What:** §3 says the default channel console shows segments (`showGameSegments={true}`) *"to match Streamclone `:8090`"*. §8 acceptance criteria says channel routes render *"with `showGameSegments={false}`"*. Same document.
- **Cost:** The acceptance criteria cannot be satisfied without violating the route contract.
- **Fix sketch:** Delete the `false` clause from §8. One line.

### B-16 — `chartActivityPoints` is derived twice per data change — **severity: low**

- **What:** `hubChartActivityModel.ts:36` calls `chartActivityPoints(...)` and its own doc comment says callers should not re-run it. `FigmaGlobalActivityPanel.tsx:~330` calls `deriveHubChartActivityModel`, then passes the **raw** `chartInputs.points` to `HubActivityChart`, which calls `chartActivityPoints` again at `chart.tsx:~370`.
- **Cost:** Not measured in isolation; both are memoized and fire per poll, not per frame. Low.
- **Fix sketch:** Pass `chartModel.chartPoints` down and let the chart accept pre-derived points. ~15 lines.

### B-17 — On the brief's "4 path strings every call, always — lazy? memoize?" — **this premise is wrong, and I am correcting it**

- **Measured:** `splitLinePaths` at n=209 — smooth **0.089ms**, linear **0.034ms**. All 12 calls the model performs: **0.5425ms**, and it is inside `useMemo([chartPoints, windowMinutes])`, so it runs **once per data poll (~30s)**, never on pointer move.
- **Verdict:** 0.54ms every 30 seconds is not a problem. Memoizing it further would be optimising noise. The real waste is B-17's neighbour — **8 provider path-sets built, ≤4 used** (Idea 17) — and that is also sub-millisecond. Redirect the effort to B-02.

### B-18 — Density, from the screenshot and measurements — **severity: medium (design)**

- Plot is **19.8%** of the 1316px panel height. **4 control rows** above it (Live Wire rail, range tabs, legend, provider chips), **4 provider lanes** below it, then a caption.
- Tooltip covers **24.1%** of the plot while scrubbing.
- Gap bands cover **12.5%** of chart width, rendered as diagonal hatching — the loudest treatment on the page is applied to *missing* data.
- `211/240 buckets` appears twice: once as an in-plot overlay label, once in the caption below.
- **Fix sketch:** Ideas 02 (tooltip out of the plot), 04 (Live Wire → gutter), 15 (`--sp-data-gap`), and delete the duplicate bucket-count overlay. Each is drop-in.

### Missing from `hubActivityChartDetailLayer.test.tsx`

Tests I would require before this merges:

1. `data-detail-active` becomes `"true"` on `pointerdown` and returns to absent on `pointerleave` — **would have caught B-06.**
2. `Enter` on a focused chart calls `onBucketSelect` — **would have caught B-04.**
3. Exactly one `[aria-live]` node exists within `.hx-chart2` — **would have caught B-05.**
4. Horizontal-intent: a 5px `pointermove` does not set `--dragging`; a 7px one does. The `6px` threshold at `chart.tsx:332` is currently untested and un-tunable (it is a `const` inside the component body).
5. `pointercancel` mid-drag leaves `selectedBucketT` unchanged.
6. Under `prefers-reduced-motion`, the detail layer's computed `transition` is `none`.
7. A rendered-geometry assertion: rest and detail paths must differ by more than the detail stroke width somewhere — **would have caught B-03**, the most important finding, at build time.
8. `hubActivityChart.test.tsx` contains **one** test for a 1442-line component. That is the real coverage gap.

### Extension components shipping with no tests

`PulseOverviewChart.tsx` (1126), `RecapTimelineChart.tsx` (435), `Overlay.tsx` (1899), `LiveStatsBand.tsx` (1047), `StreamRecapSection.tsx` (1025) — **5,532 lines**, covered only by the mirror tests described in B-10.

---

## Mode C — Thought experiments

### C-1 — Delete `HubActivityChart.tsx`; ship a static stepped area chart of the last 30 minutes

**Do it.** I did not expect to write that.

What the page loses is smaller than it looks. It loses hover tooltips, bucket→Pulse-Moments filtering, the provider-lane sparklines, and the detail crossfade. Of those, the crossfade is provably invisible on the viewers series (B-03), the provider lanes are four near-flat dashed rows consuming space below the plot, and the tooltip covers 24.1% of the plot it explains. The genuinely valuable capability is bucket→moment filtering — and that is *selection*, not *charting*. It survives as a list.

What the page gains is severe. It gains 1442 lines deleted, 3507 lines of `hub.css` mostly deleted, the resolution of the parity violation in B-14 (no `hubx`, no `hub.css` on the landing, exactly as the contract demands), the elimination of 319 layout shifts per scrub, and the 27fps-at-4×-CPU problem simply ceases to exist because nothing animates.

It also gains honesty. The current chart spends 12.5% of its width hatching data it does not have, and renders 209 buckets at 4.34px each — a density at which no human reads individual buckets anyway. A stepped area chart of the last 30 minutes at ~30 buckets of 30px each is *legible*, and legibility is the thing the current chart has traded away for interactivity nobody measured.

The real loss is strategic, not visual: the 24-hour window is the only place StreamPulse shows that it watches 330 channels continuously. Collapse to 30 minutes and the product looks like a live widget rather than a corpus. That matters for the pitch, and it is why I would not actually ship C-1 as stated.

**Revised call:** keep a 24h chart, delete the *interaction*. Static, no hover, no crosshair, no detail layer, no provider lanes. Selection moves to the Pulse Moments table where it belongs. That captures ~90% of C-1's gains and loses none of the corpus story. If someone later proves users scrub the chart, add scrubbing back with evidence. Right now the scrub exists because it was buildable, not because it was asked for.

### C-2 — Rebuild Live Wire as a 60-second trailing thread with causality arrows

**Retract before building.** I want this and it does not survive the data contract.

The model would need, per event: `t`, `channel`, `emote`, and a **causal parent** — `(parentEventId, lagSeconds, confidence)`. The UI is a horizontal thread where a 7TV cascade on channel A connects by arrow to a chat spike on channel B four minutes later, pinnable to any moment.

Two things kill it. First, the data does not exist and cannot be faked client-side. `livePulseMoments` carries peaks, not edges. Inferring "A caused B" from co-occurrence requires cross-channel emote velocity correlation over a sliding window — that is a **backend** job in `streampulse-backend/internal/analytics`, and per `AGENTS.md` it cannot be built here. Any client-side version is a second scoring engine, which is a hard guardrail violation. Second, and worse: at a 30-minute window with the observed cadence, most events have **no** causal parent. A thread visualisation whose dominant state is "disconnected dots" is a worse list than the list it replaced.

But the 60-second trailing strip *without* arrows is not the same idea, and it is good. It needs no new data, it makes "live" mean something falsifiable (the strip visibly empties when the network is quiet, which the current chip rail never does), and it composes with Idea 04's gutter.

**Call:** ship the trailing strip; put causality edges on the backend roadmap as `pulse.cascade_edges` with an explicit confidence floor, and do not render a single arrow until that endpoint exists. Idea 06 (two-node co-occurrence chips) is the honest intermediate — it claims correlation, draws one connector, and never says "caused".

### C-3 — Strip the Figma shell from `/analytics/:channelLogin`

This is already the default — §3 of the parity doc routes channel views straight to `AnalyticsConsole`. So the real question is the one the brief asks second: **is the `?figma=1` opt-in the complexity we should question?**

**Yes. Delete it.**

`?figma=1` keeps `FigmaChannelDashboard.tsx` alive as a parallel implementation of a screen that already has a canonical implementation. It is justified as a "design-review surface", but a design-review surface that only the author visits is a second product with a userbase of one — and it is the exact failure mode §1 of the parity doc was written to prevent: *"It must not mix three different products in one route."* The flag does not prevent the mixing; it makes the mixing conditional, which is harder to reason about than either branch alone.

The cost of deleting it is genuinely small. Design review against Figma does not need a live React route — it needs the Make file and a screenshot, and `docs/design/evidence/` already holds regression PNGs. The `screenshots/baseline/` and `screenshots/after/` directories staged in the temp clone prove the team already reviews from captures, not from a flag.

Who complains: whoever uses `?figma=1` to check layout parity without touching the console. That is one person, and their workflow is replaced by `npm run` + a capture script that already exists (`phase1-baseline-capture.mjs`, `phase2-after-capture.mjs`, both staged in the temp clone).

The stronger reason: every conditional surface doubles the state space of every future change to the channel route. B-14 exists precisely because a second surface was allowed to leak its stylesheet into a route that documented itself as not loading it. `?figma=1` is the same shape of debt, pre-authorised. Kill it while it is still cheap, and let the parity doc's §3 route table shrink from six rows to four.

---

## Mode D — Goal honesty

### Was the goal right?

No. And the measurement says so without needing an opinion.

"Reproduce the Cash App rest→detail interaction" presumes a chart where rest and detail can *differ*. Cash App's chart is one price series, ~50–100 points, no gaps, across ~350px on a phone: roughly 4–7px per point on a curve whose whole job is a single monotone-ish trend. Smoothing that and then un-smoothing it produces a visible change.

StreamPulse's chart is **209 buckets across 902px** — 4.34px per bucket — of a **three-series, gap-riddled, 24-hour, 330-channel aggregate**. At that density a spline and a polyline through identical points are the same drawing. Measured on the live page with production data: **0.92px max deviation on viewers, 0% of the width above stroke width.** The goal was not achievable in this data regime, and one afternoon of measuring the rendered `d` attributes would have shown that before any of it was written.

### What StreamPulse already has that rest→detail overrides

Three things, and they are better than the thing that overrode them.

**Gap honesty.** The chart already renders "No IRC chat rollups in this stretch" and hatched bands over 12.5% of its width. That is StreamPulse's most distinctive UI behaviour — it is a product that tells you what it does not know. Rest→detail says "the calm version is the honest default and detail is a reward." For this chart the opposite is true: the *gaps* are the detail, and they are already always-on.

**Selection as the primary verb.** `resolveChartBucketSelection`, `selectedBucketT`, `accentBucketT`, `BucketSelectionCue`, and a 350×525px inspector rail all exist to support click→filter. Rest→detail added a *hover* affordance on top of a surface whose real verb is *click*, and then broke the click for keyboard users (B-04) in the process of adding it.

**The corpus.** 330 channels, 330/330 IRC collectors, 101 roster live. The reason to look at this chart is breadth. Rest→detail is a depth gesture.

### Where the pattern produces the wrong feeling

- **After the first click.** `detailActive` includes `selectedBucketT != null` (B-06), so the chart parks in permanent detail. The pattern's emotional payload is the *return* to calm, and this build never returns.
- **Over the hatched gaps.** The detail layer fades in across regions with no data. "Reveal precision" over an acknowledged absence is the wrong promise.
- **During a spike.** The screenshot shows a chart that is already visually loud — a hard emote spike from ~2K to 8.2K/min. There is no calm to depart from. The pattern needs a quiet baseline; this data has none.

### Cash App patterns we should NOT copy next

1. **Snap-to-nearest-datapoint magnetism with haptic-style feedback.** At 4.34px per bucket, magnetism is indistinguishable from a linear cursor, and you would ship 60 lines of snapping logic to reproduce the identity function.
2. **The single-value hero number that morphs as you scrub.** You already have `PEAK GLOBAL VIEWERS 883.9K` / `LIVE POOL SUM NOW 1.1M` / `PEAK CHAT/MIN 17.4K` as a stable KPI row. Making them track the cursor destroys their function — they are *summary*, and a summary that changes when you wiggle the mouse is not a summary.
3. **Time-range tabs that animate a re-scale of the same curve.** You have six ranges (24h → 1 year) with genuinely different bucket counts and gap profiles. Morphing between them would animate a lie.
4. **Gradient area-fill under the line.** The brief bans gradient washes; I am naming this one specifically because it is the single most likely thing to be proposed next, it is the most Cash-App-looking element, and with three overlapping series it would make the chart unreadable rather than pretty.

### StreamPulse-native patterns we should have invented instead

**D-1 — Coverage-as-texture.** The chart's own signature is that it knows what it doesn't know. Instead of a detail layer, modulate the *line itself* by confidence: full-opacity stroke where an IRC collector was active, 40% where the bucket is Helix-viewer-only, absent where nothing. The information is already in `hasChatRollup` / `hasViewerRollup`, and `splitLinePaths` already branches on it (it just breaks the line instead of grading it). Rest→detail adds a layer; this adds *meaning* to the layer you already draw. No competitor can copy it because no competitor admits to gaps.

**D-2 — The bookmark gutter (R10, native).** "Remember this" is StreamPulse's actual metaphor. Give the chart a 12px gutter under the axis where every bookmarked moment is a permanent tick. It never fades, never reveals, never returns to calm — it *accumulates*. The gesture is `B`, the state is durable, and the chart becomes a record of the user's attention rather than a surface that performs for the cursor. This is the pattern the product wanted; rest→detail is the pattern the reference app had.

**D-3 — Live Wire as the chart's present tense.** Idea 04's gutter, stated as identity: the plot is the past, the gutter is the last 30 minutes, and new events enter the gutter and then *settle into the plot* as their bucket completes. One continuous object with two tenses. That is a chart behaviour that only makes sense for a product that is watching 330 channels right now, which is the only thing StreamPulse has that nobody else does.

### Honesty check — what survives if we erase it and start over

I asked, for each borrowed parameter: good, or merely already built?

| Choice | Verdict |
|---|---|
| Smooth spline at rest (`buildLine`, Catmull-Rom) | **Survives.** Predates this work, is well-tested, and clamps control points to the x-interval to prevent overshoot. Keep. |
| Linear geometry for detail (`buildLinearLine`) | **Does not survive.** Its entire justification is a visual difference that measures 0.92px. Delete. |
| 6px horizontal-intent threshold | **Survives, barely.** It is a reasonable number, but it is a bare `const` inside the component body (`chart.tsx:332`) with no test. It survives as a *tested exported constant*, not as-is. |
| 140–180ms transition | **Neutral.** 180ms is fine and unremarkable. It survives only as a token (Idea 14), never as a literal. |
| `aria-live="polite"` | **Does not survive.** Wrong element, tripled, nested. See B-05. |
| Same X/Y domains, no resampling | **Survives, and is the best decision in the whole diff.** It is what makes the crossfade honest rather than a lie about the data. It is also, ironically, exactly what makes the crossfade invisible — the constraint that guaranteed integrity guaranteed pointlessness. |
| Press-drag with deferred pointer capture | **Survives and is genuinely good.** Not capturing on pointerdown, and only capturing after horizontal intent, is the correct way to avoid stealing vertical page scroll on touch. This is the one piece of the diff I would keep verbatim. |
| `touch-action: pan-y` | **Survives.** Correct and it makes the chart usable on touch, which it previously was not (the old code was `onMouseMove` only). |

So: of eight decisions, **four survive**, and the two best ones — deferred pointer capture and `touch-action: pan-y` — have nothing to do with Cash App. They are competent pointer-event engineering that got smuggled in under a borrowed-pattern banner. **The valuable part of this work is the input handling. The branded part is the part that measures zero.**

---

## What I'd test before shipping any of this

1. **Commit and push the `%TEMP%` clone.** Then verify `git log` on a durable remote. Nothing else is testable until the artifact is durable.
2. **Rendered-geometry diff test** (B-03): assert rest vs detail paths differ by more than the detail stroke width across ≥10% of chart width, on the real fixture. If it fails, the layer does not ship. This is the test that makes the whole feature falsifiable.
3. **Keyboard commit test** (B-04): focus chart → `ArrowRight` ×3 → `Enter` → `onBucketSelect` called with the expected `t`. Then `Escape` → called with `null`.
4. **Single live region test** (B-05): `container.querySelectorAll('.hx-chart2 [aria-live]').length === 1`, and `.hx-chart2` itself has no `aria-live`.
5. **Return-to-calm test** (B-06): select a bucket → `pointerleave` → `data-detail-active` is absent.
6. **CLS-under-interaction budget** (B-02): Playwright + `PerformanceObserver`, settled page, scripted 60-step scrub, assert layout-shift sum < 0.02. Current value is **0.216**. Wire it into the existing `streampulse-web` Playwright config alongside `check:analytics-overlap`.
7. **Frame budget at 4× CPU throttle** (B-02): assert p75 frame time < 16.67ms during scrub. Current p75 is **39.9ms**. Run it throttled — 1× hides the entire problem (p50 4.2ms).
8. **De-mirror the extension tests** (B-10): import `resolveOverviewWidth` / `resolvePlotWidth` from `PulseOverviewChart.tsx` and delete the local copies. Then deliberately break `PAD_RIGHT` in the component and confirm the suite goes red. If it stays green, the test is still fake.
9. **Reduced-motion snapshot**: `prefers-reduced-motion: reduce` → detail layer computed `transition: none` **and** `mix-blend-mode: normal` (the current media block handles the first, not the second).
10. **Touch parity**: real touch emulation, not synthetic `PointerEvent` — vertical swipe scrolls the page, horizontal swipe scrubs, `pointercancel` mid-gesture leaves selection untouched. My synthetic dispatches cannot prove `touch-action` works.
11. **Parity contract reconciliation** (B-14, B-15): decide whether `.hubx` on `/analytics` is legal, amend §6, and delete the contradictory `showGameSegments={false}` clause in §8. Then add a route test asserting whichever answer you chose.

---

## What I retract

**R-1 — I retract the brief's premise that `splitLinePaths` emitting 4 path strings every call is a performance problem, and I retract my own initial reading of it as one.** I measured it: 0.089ms smooth, 0.034ms linear, **0.5425ms for all 12 calls**, inside a `useMemo` keyed on `[chartPoints, windowMinutes]` — so once per ~30s poll, never per frame. "Lazy? Memoize?" is optimising noise. I spent effort here before measuring, which is exactly the mistake this document criticises elsewhere. The real cost is layout, not path-building (B-02).

**R-2 — I retract my first smooth-vs-linear deviation measurement.** I compared the two paths via `getPointAtLength(L * t)`, which samples by arc length. The paths have different total lengths, so I was comparing different x positions and reported a **113px** max deviation. That number was garbage. The corrected x-aligned measurement gives **0.92px** on the live viewers series. I am leaving this in because the wrong number would have supported the feature and the right number kills it — and the difference was entirely my methodology.

**R-3 — I retract my initial attribution of CLS 0.216 to page load.** The first trace showed the cluster during a window that also contained 1.3MB of image loading, and I nearly wrote it off. Re-measuring on a settled page with a zeroed baseline showed **`clsIdleBaseline: 0`, `clsFromScrub: 0.216`** — it is entirely interaction-generated. I also have to qualify it in the other direction: because I dispatched untrusted events, `hadRecentInput` was false, so real users' reported CLS is probably unaffected. The *layout thrash* is real; the *Core Web Vital* likely is not. Both halves of that need saying.

**R-4 — I retract Idea 11 as scoped.** I proposed unifying `RecapTimelineChart.tsx` onto `PulseOverviewChart.tsx`'s SVG stack, then noticed it is >100 lines and flagged it "not a drop-in" — but I should go further: a 435-line CSS-bar chart that works is not obviously worse than a 1126-line SVG chart that has zero tests (B-10). Until `PulseOverviewChart` has real coverage, migrating *toward* it is migrating toward the less-verified implementation. **Do B-10 first; revisit Idea 11 only if it still looks right afterwards.**

**R-5 — I retract C-1 as written, in-line, in the section itself.** "Delete the chart, ship 30 minutes static" gains legibility and loses the corpus story, which is the product's actual differentiator. The revised call — keep 24h, delete the *interaction* — is what I stand behind.

**R-6 — I retract the brief's framing that the four extension chart components need a duplication analysis.** Three of the four do not exist (`ChatActivityChart.tsx`, `EmoteLaneChart.tsx`, `SegmentedPulseChart.tsx`), along with all five `Vod*.tsx` surfaces and `ChatActivityInspector.tsx`. I answered the question that was actually available (B-10, Idea 11) rather than inventing findings about files I could not open. **I did not review `Overlay.tsx` (1899 lines), `LiveStatsBand.tsx` (1047), or `StreamRecapSection.tsx` (1025) beyond their size and test coverage** — Ideas 10, 12 and 13 are proposals grounded in structure and requirements, not in a line-by-line read, and should be treated as less-evidenced than anything in Mode B.

**R-7 — I retract one finding entirely.** While reading the `hub.css` diff I believed the new `@media (prefers-reduced-motion: reduce)` block had consumed a pre-existing closing brace and unbalanced the stylesheet. I re-counted the braces in the hunk: it is balanced, and the page renders with zero console errors. There was no bug. I had written it up before checking.
