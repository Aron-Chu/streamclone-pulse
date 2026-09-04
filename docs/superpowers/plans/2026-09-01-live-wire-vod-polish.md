# Live Wire and Portal VOD Resolution Implementation Plan

> **Superseded UI direction (2026-09-03):** Keep any independently valid VOD
> resolution work, but do not reintroduce the violet Editorial Wire, three-card
> rail, left accent, or Newsroom framing from this plan. Current Live Wire and
> Pulse Explorer behavior is canonical in
> [`../../website-portal/live-wire-moment-system.md`](../../website-portal/live-wire-moment-system.md)
> and
> [`../../website-portal/analytics-command-center-layout.md`](../../website-portal/analytics-command-center-layout.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the under-designed Live Wire cards with a polished Editorial Wire rail while making portal analytics resolve live VOD identifiers from the same truthful availability contract used by the extension.

**Architecture:** Keep the existing `HubLiveWireFeed` data flow, semantic event classification, and accessible button/link interaction model. Join stream titles from `hub.liveChannels`, render only backend-provided values and real Twitch/7TV image URLs, and use scoped CSS for the rail treatment without inventing game assets. Normalize portal VOD identifiers at the session-view-model boundary, inspect all response sources and availability states, and preserve an explicit waiting state when Twitch has not published a VOD.

**Tech Stack:** React 18/TypeScript, React Router, lucide-react, existing `Avatar`/`EmoteImg` primitives, CSS custom properties, Vitest, Vite.

## Global Constraints

- Preserve the dark/violet theme and existing Live Wire information architecture.
- Preserve backend-authored scoring, confidence, comparisons, coverage, and VOD availability semantics; never add client-side scoring or fabricated zero-fill.
- Preserve the 30-minute rolling window, 10-minute deduplication, 12-card cap, and rail/lane layouts.
- Use real Twitch profile images and real 7TV/Twitch emote image URLs already present in payloads; do not add emoji or fake game icons.
- No backend API or data-model changes are required for the Live Wire redesign; `HubLiveChannel.title` is joined by login.
- Keep cards keyboard accessible as the existing `<button>` or React Router `<Link>`; do not replace them with clickable non-semantic divs.
- Normalize empty or whitespace-only VOD IDs as absent and never construct a Twitch URL from an invalid value.
- Keep all changes local and uncommitted unless the user explicitly requests a commit.

---

### Task 1: Capture the current portal VOD failure and compare API sources

**Files:**
- Inspect: `streampulse-web/src/lib/figmaSessionAnalytics.ts`
- Inspect: `streampulse-web/src/lib/streamcloneAnalytics.ts`
- Inspect: route components/loaders that render `/analytics/:login/:streamId`
- Test/diagnostic: existing portal Vitest helpers and browser network logs

**Interfaces:**
- Consumes: stream ID `318299176935`, portal stream detail/coverage/minutes/peaks responses, extension API behavior.
- Produces: a concrete response-shape and UI-gating diagnosis before changing code.

- [ ] **Step 1: Reproduce the exact route on the local portal.**

Run a finite health check and inspect the route at `http://127.0.0.1:5173/analytics/forsen/318299176935`. Record the visible VOD state, console errors, and requests for the stream detail, coverage truth, minutes, peaks, and any route-specific loader.

```bash
curl --max-time 3 -I http://127.0.0.1:5173/analytics/forsen/318299176935
```

Expected: the route loads without assuming that a VOD exists; any waiting state must be attributable to the returned availability state.

- [ ] **Step 2: Compare portal and extension identifiers.**

Inspect the response bodies for the portal requests and the extension’s successful request path. Compare `availability.vodId`, top-level `vodId`, `stream.vodId`, `vodState`, `liveDvrState`, `chartState`, and any `vodMessage`. Confirm whether the portal receives a VOD ID under a different field or whether the VOD is genuinely unpublished.

- [ ] **Step 3: Trace the UI gate.**

Find the exact component condition that decides between a Twitch VOD link, a loading/waiting message, and an unavailable/error state. Confirm whether it reads the normalized view model’s `vodId`, `vodHref`, or a separately converted `availability` object. Do not patch until the failing condition is identified.

- [ ] **Step 4: Preserve the diagnosis in a focused test fixture.**

Add or extend a fixture with the observed payload shape. The fixture must distinguish an availability VOD ID from a coverage fallback and from a live-DVR state with no published VOD.

---

### Task 2: Normalize portal VOD availability and add regression coverage

**Files:**
- Modify: `streampulse-web/src/lib/figmaSessionAnalytics.ts`
- Test: existing analytics Vitest file or a new focused `streampulse-web/src/lib/figmaSessionAnalytics.test.ts`

**Interfaces:**
- Consumes: the four parallel portal responses used by `fetchPortalSessionViewModel`.
- Produces: `FigmaSessionViewModel.vodId?: string` and `vodHref?: string` containing only a non-empty normalized Twitch VOD ID, while retaining truthful availability state/message fields.

- [ ] **Step 1: Define the typed availability fields used by the session loader.**

Extend the detail response type with nullable availability fields needed for the decision:

```ts
availability?: {
  vodId?: string | null
  vodState?: string | null
  liveDvrState?: string | null
  chartState?: string | null
  vodMessage?: string | null
}
```

Keep unknown fields tolerated and do not require availability for older responses.

- [ ] **Step 2: Add a small normalization helper.**

Implement a local helper with an explicit contract:

```ts
function normalizePortalVodId(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const value = candidate.trim()
    if (/^\d+$/.test(value)) return value
  }
  return undefined
}
```

Use it for availability, coverage, and stream-detail candidates in that order. If the backend uses a numeric VOD identifier, convert it only at the typed boundary; reject empty strings and unrelated URLs.

- [ ] **Step 3: Return honest availability state alongside the ID.**

Use the typed `detail.availability` value rather than a broad cast. Preserve the existing session model’s waiting/unavailable semantics and message. A live DVR state with no `vodId` must remain a waiting state, not receive a guessed URL.

- [ ] **Step 4: Write focused tests before running the suite.**

Cover these cases with deterministic response fixtures:

```ts
it('prefers a non-empty availability VOD id', async () => { /* availability id wins */ })
it('falls back to coverage VOD id', async () => { /* coverage id used */ })
it('falls back to stream detail VOD id', async () => { /* stream id used */ })
it('ignores empty and whitespace VOD ids', async () => { /* no invalid href */ })
it('keeps live DVR without a published VOD truthful', async () => { /* vodId undefined, waiting state retained */ })
```

Assert both `vodId` and `vodHref`; assert that invalid values never produce `https://www.twitch.tv/videos/`.

- [ ] **Step 5: Run the focused tests.**

```bash
cd /mnt/c/Users/Aron/streamclone-pulse/.worktrees/newsroom-vod-polish/streampulse-web
npm exec vitest run --config vitest.config.ts src/lib/figmaSessionAnalytics.test.ts
```

Expected: all new VOD cases pass. If the repository uses a different existing test filename, run the exact focused file containing the new cases.

---

### Task 3: Implement Editorial Wire rail markup without changing semantics

**Files:**
- Modify: `streampulse-web/src/ui/components/analytics/HubLiveWireFeed.tsx`
- Test: component/analytics tests covering Live Wire rendering

**Interfaces:**
- Consumes: `PublicHub.liveChannels`, `FigmaMomentRow`, existing `kindMeta`, `enrichPulseMomentRows`, `Avatar`, and `EmoteImg`.
- Produces: rail and lane cards with joined title, semantic labels, real image assets, truthful facts, and existing chart-select/fallback-link behavior.

- [ ] **Step 1: Add a title lookup keyed by normalized login.**

Follow the existing `profileImageByLogin` and `categoryByLogin` maps:

```ts
const titleByLogin = useMemo(() => {
  const map = new Map<string, string>()
  for (const channel of hub.liveChannels) {
    const title = channel.title?.trim()
    if (title) map.set(channel.login.toLowerCase(), title)
  }
  return map
}, [hub.liveChannels])
```

Resolve the card title from the map by `login.toLowerCase()` and omit the title line if absent.

- [ ] **Step 2: Derive semantic card accent and strength tier from existing fields.**

Use event kind and backend score only to select presentation classes. Do not recompute score. Map emote breakout to violet, chat breakout to cyan, viewer spike to red, and weak/emerging cards to slate. Keep the existing `evidenceLabel`, comparison fallback, confidence, and historical labels.

- [ ] **Step 3: Replace the card content structure with five visual sections.**

Keep the current outer `<button>`/`<Link>` branching exactly intact. Within `content`, render:

1. Header: `Avatar`, display name, `NEW`, clip candidate when `score >= 40`, category, viewers, optional joined title, elapsed time, and optional offset.
2. Kind labels: one or more text labels with semantic classes; no emoji placeholder icons.
3. Metric facts: primary backend-provided rate/viewer fact, unit, comparison or italic `no baseline`, and confidence when available.
4. Evidence: up to three `topEmotes` with `EmoteImg`, names, counts, and dividers only between actual items.
5. Footer: strength tier label and compact backend-score-width bar; use a bounded display width only for presentation and never expose it as a probability.

Use the existing `moment.topEmotes` and `resolveMomentEmote` lookup. Omit absent values rather than zero-filling.

- [ ] **Step 4: Preserve accessibility and click behavior.**

Retain `aria-label`, `aria-pressed`, and the existing `onSelectMoment` callback when `canSelectMoment(moment)` is true. Otherwise retain the canonical `href` link. Ensure decorative images have empty alt text while emote wrappers retain descriptive labels.

- [ ] **Step 5: Add component assertions.**

Test that:

- A joined stream title renders for a matching live channel.
- Missing titles are omitted.
- Real emote image URLs are passed to `EmoteImg`.
- Up to three emotes render with dividers only between adjacent items.
- Existing chart-select button behavior remains a button and calls `onSelectMoment`.
- A non-selectable moment remains a router link.
- Missing comparison renders `no baseline` rather than a fabricated percentage.

---

### Task 4: Apply scoped Editorial Wire CSS to rail and lane variants

**Files:**
- Modify: `streampulse-web/src/ui/components/analytics/figma-analytics.css`
- Optional inspect only: `streampulse-web/src/ui/themes/analytics-surfaces.css`

**Interfaces:**
- Consumes: class names emitted by `HubLiveWireFeed.tsx`.
- Produces: calm Editorial Wire presentation for rail cards and compressed lane cards, with semantic accents and no decorative noise.

- [ ] **Step 1: Update the actual rendered card selectors.**

Target `.hub-live-wire__event-card` and its descendants; do not rely solely on the stale `.hub-live-wire__rail-card` name. Apply a 3px semantic left border, subtle tint, 0.5rem radius, rail padding near `0.7rem 0.8rem`, and a `0.75rem` rail list gap.

- [ ] **Step 2: Add the header, title, time, and category hierarchy.**

Use Inter/system body text and the existing monospace token for timestamps, viewers, offsets, and counts. Keep the title one line with ellipsis and the time block right-aligned.

- [ ] **Step 3: Add kind, metrics, evidence, and footer styles.**

Implement the specified violet/cyan/red label backgrounds, tinted metric box, monospace primary value, comparison/no-baseline treatment, 20px rail emote images, 18px lane emote images, divider, tier label, and compact gradient bar. Keep colors as text-plus-rail semantics so color is not the only indicator.

- [ ] **Step 4: Add state and layout variants.**

Use an emerging modifier with reduced opacity and slate rail. Keep interactive hover calm; retain visible keyboard focus. Compress lane cards to approximately 260px width, smaller avatar/padding, and omit stream title and offset only in lane context.

- [ ] **Step 5: Check CSS overlap and responsive behavior.**

Run:

```bash
cd /mnt/c/Users/Aron/streamclone-pulse/.worktrees/newsroom-vod-polish/streampulse-web
npm run check:analytics-overlap
```

Expected: the existing overlap guard remains green with no new blocking overlap.

---

### Task 5: Verify route behavior and visual output locally

**Files:**
- Inspect: `/analytics`, `/analytics/newsroom`, `/analytics/forsen/318299176935`
- Test: portal Vitest/typecheck/build checks

**Interfaces:**
- Consumes: completed component/CSS/VOD changes.
- Produces: local verification evidence and a concise list of any environment-only limitations.

- [ ] **Step 1: Run focused and repository checks.**

```bash
cd /mnt/c/Users/Aron/streamclone-pulse/.worktrees/newsroom-vod-polish/streampulse-web
npm test -- --run
npm run typecheck
npm run check:analytics-overlap
```

If the known unrelated `getChannelEmoteCatalog` type error persists, record it separately and verify that the changed files have no new diagnostics.

- [ ] **Step 2: Run the portal build if practical.**

```bash
npm run build
```

Expected: the build either passes or reports only pre-existing/environment-specific failures; do not mask failures from changed code.

- [ ] **Step 3: Verify with the local Vite server.**

Start the prescribed server detached from the shell, poll `http://127.0.0.1:5173`, and inspect the three routes using Chrome DevTools MCP. Confirm the rail card hierarchy, real images, title joins, links/buttons, and VOD state.

- [ ] **Step 4: Capture a 1280px visual check.**

Record screenshots or browser snapshots for `/analytics` and `/analytics/newsroom`. Confirm Live Wire no longer uses the old thin notification treatment and that empty/unavailable states remain honest.

- [ ] **Step 5: Report without deploying or committing.**

Summarize changed files, tests, browser findings, the VOD root cause/fix, and any pre-existing failures. Do not deploy production or create a commit unless explicitly requested.
