# Live Wire → responsive sticky right-rail catch-moment radar

| | |
|---|---|
| **Status** | Approved design (brainstorming), revised per review ×2 |
| **Owner repo** | `streamclone-pulse` |
| **Surface** | `/analytics` hub landing — `AnalyticsLandingPage` |
| **Primary file** | `streampulse-web/src/ui/components/analytics/HubLiveWireFeed.tsx` |
| **Layout shell** | `AnalyticsFigmaShell` → `figma-analytics.css` (`figma-analytics__frame`) |
| **Data resolver** | `resolveLivePulseMoments` → `LivePulseMomentsResult` (`livePulseMomentsFromPublicHub` is **deprecated**) |
| **Naming** | Locked: **Live Wire**. Do **not** use "Pulse Wire" in this surface (no-resurrection naming rule). |

## Summary

Turn **Live Wire** from a horizontal chart-attached annotation lane into a
**responsive sticky right rail** — a persistent, always-visible "catch-moment
radar" on the hub landing. Each moment is a **Callout card**: channel,
category, chat/emote magnitude, top emotes, and sibling **leave-to-analytics /
jump-to-VOD** actions. The rail shows a tight **"Live now"** band plus a
compact, honestly-partial **"Older retained"** disclosure.

The rail is a **responsive sticky grid child** and is **never `position: fixed`**.
Responsive contract (single, no contradiction): **sticky rail at ≥ 1440px**;
**normal in-flow Live Wire section below the center column at all narrower
widths**. No drawer is shipped.

Confirmed via interactive mockups: **Approach A rail**, **Callout cards**,
**tiered Live now + older-retained** (partial). This spec **supersedes** the
hub-landing "Live Wire placement" contract in
`docs/website-portal/analytics-command-center-layout.md` (lane + shared
selection + no third rail).

## Motivation

Live Wire currently renders as one-line chips above the Global Activity chart
(`layout="lane"`) and its click **selects** the moment in place (shared
`selectedMomentKey`). That makes it a passive annotation, not a catch surface,
and it is cramped to one horizontal line. Users want a **glanceable radar** that
**launches to channel analytics / VOD** rather than inspecting in place, shows
**categories**, and is detailed enough to be a real feature.

## Goals / non-goals

**Goals**
- Responsive sticky right rail mirroring the left sidebar; always on at desktop `≥ 1440px`; in-flow section below the center at narrower widths.
- Each moment card: channel, **best-available category**, Chat + Emotes magnitude, top emotes, age, NEW badge, sibling jump actions.
- Tiered freshness: "Live now" (≤30m) + compact, honestly-partial "Older retained" disclosure.
- Reuse the existing theme (`--sp-*` tokens, `hub-live-wire__*` / `figma-*` conventions), `resolveLivePulseMoments`, and a **new shared action resolver** modeled on the mounted moment inspector.

**Non-goals**
- **No new backend API / fields.** Reuse `LivePulseMomentsResult`. Rail shows only currently-retained rows; it is **not** a day archive.
- Do NOT keep the in-place inspection model on the rail; rail is decoupled from `selectedMomentKey`.
- Do NOT ship a slide-over drawer in this batch (deferred — see §Responsive contract).
- No client-side derived score; no `href="#"`; **no missing-vs-zero distinction** (see §Magnitude bars).

## Conflict supersession (REQUIRED in same batch)

This batch must update — not merely add tests for — every contract that encodes
the opposite layout:

1. **Canonical layout/liveness docs:** `docs/website-portal/analytics-command-center-layout.md` ("Live Wire placement 2026-07 P1", "Do not regress") and the analytics refactor/liveness/figma-parity docs: mark the hub-landing lane model **superseded**.
2. **E2E specs that assert the opposite contract** (all must be reconciled):
   - `analytics-hub-live-wire-ticker.spec.ts` — asserts `.figma-analytics__side-rail--right` count 0 (L29, L80) and lane-inside-chart-col (L30–53).
   - `analytics-figma-parity.spec.ts` — L34–35 assert `.hub-live-wire--ticker` visible and `side-rail--right` count 0.
   - `analytics-hub-ux.spec.ts` — "Live Wire selection coordinates one inspector" (L340+) asserts lane-chip selection linkage.
   - `analytics-hub-chart-contract.spec.ts` — L54–55, L80 assert lane chips / `--new` badge behavior.
   - Any lane-selection unit test asserting `selectedMomentKey` wiring on the hub landing.
3. **Naming:** use **Live Wire**; remove "Pulse Wire" copy from this surface and from launch docs touched by this batch.
4. **Checker:** `streampulse-web/scripts/check-analytics-links.mjs` currently validates `/analytics/{login}` and `/analytics/{login}/s/{streamId}`. Align the spec's route contract to that real `buildAnalyticsHref` contract (do not claim a `#t={offset}` in-app route that the checker does not expect), and run it. Scope commands as `npm --prefix streampulse-web run check:analytics-links` / `check:analytics-overlap`.

## Responsive contract (single source of truth — P0)

| Viewport | Columns | Live Wire |
|----------|---------|-----------|
| **≥ 1440px** | `220px minmax(0,1fr) 320px` | **Sticky right rail** (3rd grid child). |
| **all < 1440px** (incl. 1100–1439) | `minmax(0,1fr)` (sidebar hidden at ≤1024) | **In-flow Live Wire section below the center column.** |

- **No drawer** in this batch. A slide-over drawer is explicitly deferred because it needs a trigger, `role="dialog"` semantics, focus trap/restoration, Escape + backdrop, and scroll lock — do not ship it half-specified.
- At `1100–1439` the rail is not persistent; Live Wire renders as a normal in-flow block section under the main column. This avoids the earlier contradiction.
- The left sidebar is hidden at `≤ 1024px` (existing rule, `figma-analytics.css` L908), so at 1024 the layout is a single column.

## AnalyticsFigmaShell — right-rail slot (P0)

- Add an optional, **landing-only** prop `rightRail?: ReactNode` to `AnalyticsFigmaShell` (default `undefined` → no change for channel/session routes).
- Add a **scoped** modifier: when `rightRail` is present, the frame gets class `figma-analytics__frame--with-right-rail`, and the grid becomes `220px minmax(0,1fr) 320px` **only at `≥ 1440px`**.
- Explicit grid placement: `grid-template-areas` for `"sidebar center rail"` at `≥1440`; `"sidebar center"` (or `"center"` when sidebar hidden) below; rail as a named grid item in the 3rd column.
- **Do not make a global three-column rule** — the existing channel/session routes must be unaffected. Only the landing page passes `rightRail`.

### Minimum-center-width policy (P0)

- The third column must never starve the center. Because the chart inspector reserves ~350px until `min-width: 1100px` and the embedded Pulse Moments grid needs `minmax(240px,0.72fr)+minmax(0,1.85fr)`, the persistent rail **only engages at `≥ 1440px`** on the current nested grids.
- **Expected center widths** (shell is `max-width: min(1520px,100%)`; sidebar hidden at ≤1024; 1.25rem gaps×2 + 1.25rem padding×2 at the rail breakpoint):

| Viewport | Sidebar | Rail | Center ≈ |
|----------|---------|------|----------|
| 1024px | hidden | none (in-flow below) | 1000px |
| 1100px | 220px | none (in-flow below) | 836px |
| 1440px | 220px | 320px sticky | 836px |
| 1520px | 220px | 320px sticky | 900px (shell cap) |
| 1600px | 220px | 320px sticky | 900px (capped at 1520) |

- Assert these in an E2E computed-layout test (with pad tolerance).

### Sticky rail mechanics (P0/P1)

- Rail is a **sticky grid child**: `position: sticky; top: <nav+header offset>`, aligned to the centered shell's right edge.
- **Never `position: fixed`** (misaligns on wide screens where the shell is centered/capped).
- **Scroll ownership:** the **document remains the page scroll owner**; the rail is a **second, intentional scroll owner** via `overflow-y: auto` with a **viewport-bounded height** (`max-height: calc(100vh - <top> - <footer-gap>)`). Ensure **no descendant creates a nested scroll container** (single internal scroller only).

## Moment card (Callout card)

Vertical card (320px rail / in-flow width below 1440; dark `--sp-surface-2`, teal `--sp-accent`):

```
[avatar]  display name            [2m ago] [NEW]
          Just Chatting ▸ category sub-line

Chat       ████████████░░  38k/min
Emotes     ████████░░░░░░  12k/min

[emoji][emoji][emoji]    [View moment] [Jump to VOD]
```

- **Header row:** `Avatar` + `displayName`; sub-line = **best-available category** (see §Category provenance).
- **Right of header:** `relativeTime(moment.at)` + `NEW` (see §Freshness & NEW).
- **Magnitude bars:** Chat / Emotes, each **normalized independently** against its own max in the visible set. Because backend numeric fields use `omitempty`, **absent and zero are indistinguishable on the wire** → **treat both as unavailable** ("—", no bar). No client-side score. Accessible bar labels ("Chat 38k/min").
- **Top emotes:** up to 1–3 thumbnails from `moment.topEmotes` via `EmoteImg` + `resolveMomentEmote`; omit entirely when no emote rollups.
- **Actions:** **sibling** (non-nested) controls; see §Navigation.

### Category provenance (P1)

`moment.category` may be **event-time data or a current fallback**; client enrichment can fall back to the **current roster** (`hub.liveChannels`, as the old lane did). Present it as **"best-available category"**, never claim it is the game played at the moment unless event-time provenance is added.

## Navigation (P0/P1)

- **No nested controls.** Render each card as a non-interactive `article` (`<ul role="list">` / `<li role="listitem">`) with **sibling** action elements. Never wrap the whole card in a link and nest another link inside.
- **`HubMomentRailBody` is NOT the reuse source** (it is currently unmounted and promotes VOD to primary when analytics is unavailable; it does not render sibling analytics+VOD). Instead build a **new shared action resolver** modeled on the **mounted inspector** (`FigmaMomentInspector`, which already computes `openMomentHref` and `vodHref = buildVodTimestampUrl(...)`), exposing both actions as siblings:
  - **Analytics action:** canonical in-app `buildAnalyticsHref({ login, streamId })` → `/analytics/{login}` or `/analytics/{login}/s/{streamId}` (the contract `check:analytics-links` validates). Prefer `moment.href` when present, else `buildAnalyticsHref`.
  - **VOD action:** external `buildVodTimestampUrl(vodId, offsetSeconds)` → `https://www.twitch.tv/videos/{vodId}?t={offset}s`, `target="_blank" rel="noreferrer"`, only when `vodId` is set.
  - If neither analytics nor VOD is available, render a **disabled state** ("Live tracking only" / "No VOD indexed yet") — **never `href="#"`**.

## Tiered freshness (P0)

- **Three-way timestamp classifier** (P0): given `momentAtMs(at)`:
  - **valid (`0 <= now - at <= 30m`)** → **Live now** band.
  - **valid (`now - at > 30m`)** → **Older retained** group.
  - **missing / invalid / non-finite / `<= 0` / future (`at > now`)** → **omitted entirely** (never placed in the older tier).
- **Live now:** newest first; new cards animate in on poll (max 3/poll — `MAX_NEW_ANIMATIONS_PER_POLL`).
- **Older retained (collapsed):** the **remaining actual payload rows** older than 30m. Honestly-labeled **partial** (per-poll snapshot of live peaks; no historical horizon/completeness/total in the payload); counts **only rendered rows**. A real historical tier needs a new backend contract — **out of scope**.

## Freshness & NEW (P0) — poll identity must actually be wired

- `usePublicHubData` exposes `pollSequence`, but `liveWireFeedProps` currently does **not** pass it to Live Wire. **Wire it through** so Live Wire can key "this row set came from poll sequence N".
- **NEW rule:** NEW is granted only to a moment **newly present in a successfully applied poll of a healthy, full network feed**. Required gates:
  - `loadSource === "full"` **and** healthy network (`!isHubNetworkDegraded(loadSource, hubEndpointOk)`).
  - A stable poll identity (on `pollSequence`).
- **Do NOT grant NEW** on: initial cache hydration, fallback/featured data, cache-only responses, degraded/no-network, or `stats-fallback`. **Cache hydration also increments `pollSequence` and reports `hubEndpointOk: true`**, so `pollSequence` alone is insufficient — always gate on `loadSource === "full"` + healthy network.
- **First-snapshot rule:** the first full-network snapshot after hydration is a baseline (rows establish the seen-set; they do not all flash NEW).
- **Cache→network transition:** when transitioning from cache to a full network poll, the *first* network-poll rows are the new seen-set; NEW applies from the poll *after* that (`prevSeen` captured at baseline).
- **Reduced motion:** suppress entrance animation but keep the semantic NEW label. NEW expires once the moment leaves the Live-now window (explicit expiration), regardless of animation state.

## Motion (P1)

- The existing `animateEnterHorizontal` animates from `x: -24` (enters from the **left**). The rail wants entry from the **right**. Add a **directional option** to `useAnalyticsMotion` (e.g. `animateEnterHorizontal(el, { from: 'right' })` → `x: +24`) or add a dedicated right-entry helper. Do **not** claim right-entry while reusing the left-entry helper unmodified.
- Respect `prefers-reduced-motion`.

## Data & errors

- Feed: reuse the `LivePulseMomentsResult` already built on the landing page (`liveWireFeed` / `liveWireFeedProps`), via `resolveLivePulseMoments`, and add `loadSource` + `pollSequence` to `liveWireFeedProps`.
- Degraded hub: `isHubNetworkDegraded` → honesty banner (existing `feed.banner` copy), no NEW, no entrance motion. Never fabricate moments on cache/fallback/degraded.

## Accessibility & performance

- Rail: semantic `<aside aria-label="Live Wire">`; cards are `article` list items with sibling focusable actions; `NEW` is a visible badge, not color-only.
- Single internal scroll owner; sticky grid child (never fixed); respect reduced motion.
- Reuse `useAnalyticsMotion` (with the new directional option); no new deps. The component's existing `:1000`-ms `now` interval is unchanged.

## Out of scope (later)

- Real historical "earlier today" tier (needs a new backend contract with horizon/completeness/total).
- Slide-over drawer with full dialog semantics (deferred).
- Lowering the persistent-rail threshold via container-query conversion of the nested chart/Pulse Moments grid.
- Persisting the disclosure open/closed state; server-driven ranking; category-filter chips.
