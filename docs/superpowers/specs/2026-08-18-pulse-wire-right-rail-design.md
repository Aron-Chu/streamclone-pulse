# Pulse Wire → fixed right-rail catch-moment radar

| | |
|---|---|
| **Status** | Approved design (brainstorming) |
| **Owner repo** | `streamclone-pulse` |
| **Surface** | `/analytics` hub landing — `AnalyticsLandingPage` |
| **Primary file** | `streampulse-web/src/ui/components/analytics/HubLiveWireFeed.tsx` |
| **Layout shell** | `AnalyticsFigmaShell` / `figma-analytics.css` (`figma-analytics__frame`) |

## Summary

Turn **Pulse Wire** from a horizontal chart-attached annotation lane into a
**fixed right rail** — a persistent, always-visible "catch-moment radar." Each
moment is a **Callout card** showing the channel, **category**, chat/emote
magnitude, top emotes, and a clear **leave to channel / VOD** action. The rail is
tiered into a tight **"Live now"** band plus a collapsed **"Earlier today"**
group so users catch both what's happening this instant and what they missed.

Decisions lock the design: **Approach A (fixed right rail)**, **Callout card
anatomy**, **tiered live + earlier freshness**. Confirmed via interactive
mockups in the brainstorm session.

## Motivation

Currently Pulse Wire renders as one-line chips above the Global Activity chart
(`layout="lane"`) and its click **selects** the moment in place (shared
`selectedMomentKey`). That makes it a passive annotation, not a catch surface,
and it's cramped to one horizontal line. Users want a **glanceable radar** that
**launches to the channel/VOD** rather than inspecting in place, shows
**categories**, and is detailed enough to be a real feature.

## Goals / non-goals

**Goals**
- Persistent right rail that mirrors the left sidebar (same frame column), always on at desktop widths.
- Each moment card surfaces: channel, **category**, Chat + Emotes magnitude, top emotes, age, NEW badge, and a clear jump/launch action.
- Tiered freshness: "Live now" (≤30m) + collapsed "Earlier today."
- Native to the existing theme (reuse `--sp-*` tokens and `hub-live-wire__*` / `figma-*` class conventions); restrained, consistent motion.

**Non-goals**
- Do NOT add new backend API / new data fields. Reuse `LivePulseMomentsResult` / `livePulseMomentsFromPublicHub` and existing `FigmaMomentRow` fields.
- Do NOT keep the in-place moment inspection model on the rail (chart + Pulse Moments keep their own selection; the rail is decoupled).
- Do NOT re-add a second sticky rail or third frame column *in addition* to the left sidebar — this rail replaces the removed in-chart lane and is the *one* right rail.

## Layout

`figma-analytics__frame` is currently `grid-template-columns: 220px minmax(0, 1fr)` at wide widths. Extend to a three-column grid:

| Viewport | Columns | Rail behavior |
|----------|---------|---------------|
| ≥ 1440px | `220px minmax(0,1fr) 320px` | Persistent fixed right rail, full height, internally scrolls. |
| 1024–1440px | `220px minmax(0,1fr) 260px` | Always-on, auto-narrower rail (keeps center chart from losing width). |
| < 1024px | `minmax(0,1fr)` rail stacked below, OR slide-over drawer via a "Pulse Wire" toggle | Rail out of the flow; center keeps full width. |

- The Chart / Pulse Moments center column already uses `minmax(0, 1fr)`, so it flexes automatically to the remaining width.
- Move the existing `section-live-wire` sidebar entry to **anchor / open the right rail** (scrolls it into view on wide, opens the drawer below `1024px`).
- **Remove** the in-chart `figma-global-activity__annotation-lane` block in `FigmaGlobalActivityPanel` and its `HubLiveWireFeed layout="lane"` usage.

## Moment card (Callout card)

Vertical card (~320px, dark `--sp-surface-2`, teal `--sp-accent`):

```
[avatar]  display name            [2m ago] [NEW]
          Just Chatting ▸ category sub-line

Chat      ████████████░░  38k/m
Emotes    ████████░░░░░░  12k/m

[emoji][emoji][emoji]      View moment →
```

- **Header row:** channel `Avatar` + `displayName`; below it the **category** as the sub-line (from `moment.category`).
- **Right of header:** `relativeTime(moment.at)` + `NEW` badge (fresh ≤ 30m and first observation this poll — reuse existing `collectFreshKeys` logic).
- **Twin magnitude bars:** `Chat` and `Emotes` mini progress bars, width ∝ rate / max-in-view, with `compact()` labels (`38k/m`). Reuse `strongestMetric`/`compact` helpers; normalize against the max visible value for consistent scale.
- **Top emotes:** up to 3 emote thumbnails from `moment.topEmotes` via `EmoteImg` + `resolveMomentEmote`.
- **Action:** whole card is a link; persistent **"View moment →"** affordance.
  - Default destination: `/analytics/:login` (channel analytics).
  - When `moment.vodId` exists, render a secondary **"▶ Jump to VOD"** button/link (uses `vodId`/`href`).

## Tiered freshness

- **Live now (top):** fresh network moments with `isLiveWireEventFresh(...)` true (≤ 30m), **newest first**. New cards slide in from the right on poll (max 3 per poll — reuse `MAX_NEW_ANIMATIONS_PER_POLL` and `useAnalyticsMotion` `animateEnterHorizontal`).
- **Earlier today (below):** older moments within the served activity window, **collapsed by default** behind a chevron count header ("Earlier today · 12"). Expanding lists them newest-first with a subtle age fade. Helps catch missed/or-runback moments without cluttering the live radar.
- **Empty state:** keep existing honesty copy/blog machinery (`EMPTY_REASONS`, `LIVE_WIRE_QUIET_EMPTY`, degraded-hub banner). A quiet empty shows the message, not a dead box.

## Decoupling & selection

- The rail **no longer** participates in `selectedMomentKey` / `onSelectMoment` / `accentBucketT` linkage that the old lane used. Chart markers and Pulse Moments inspector keep their own selection.
- `HubLiveWireFeed` props change: **remove** `selectedMomentKey` / `onSelectMoment` (or stop passing them from `FigmaGlobalActivityPanel`). The remaining `HubLiveWireFeed` usage becomes the right rail with `layout="rail"` (new variant) — the `section`/`ticker`/`lane` variants may remain for other surfaces or be retired if unused.

## Data & errors

- Feed: same `LivePulseMomentsResult` already built on the landing page (`liveWireFeed` / `liveWireFeedProps`). No new fetching.
- Degraded hub: `isHubNetworkDegraded(loadSource, hubEndpointOk)` → rail shows the aggregate-only honesty banner (existing `feed.banner` copy). Never fabricate moments.

## Accessibility & performance

- Rail is a semantic `<aside>` (the page already uses `<aside>` for the left sidebar) with an `aria-label`. Cards are real links; focusable; `NEW` is a visible badge, not color-only.
- Internal scroll on the rail (`overflow-y: auto`) so many cards never break layout.
- Reuse existing motion hook; no new dependencies. Cards are plain DOM + CSS, so no perf risk from the `:1000`-ms `now` interval already used by the component.

## Testing

- Unit: card rendering (category sub-line, twin bar labels, top emotes, age/NEW, VOD vs channel action) for each `kind` (chat / emote / peak) and for missing optional fields.
- Unit: tiering groups "Live now" vs "Earlier today" correctly by `isLiveWireEventFresh`.
- Layout: rail present at ≥1024, drawer/stacked below 1024; center chart not squeezed.
- Regression: chart + Pulse Moments selection still works after removing the in-chart lane.
- E2E/screenshot at desktop widths using existing Playwright conventions.

## Out of scope (later)

- Persisting the collapsed/expanded "Earlier today" state.
- Server-driven ranking (#1/#2 "heat" ranks) if a scoring field beyond `score` is desired.
- Category-filter chips inside the rail.
