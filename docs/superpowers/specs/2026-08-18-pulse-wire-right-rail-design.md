# Live Wire → fixed right-rail catch-moment radar

| | |
|---|---|
| **Status** | Approved design (brainstorming), revised per review |
| **Owner repo** | `streamclone-pulse` |
| **Surface** | `/analytics` hub landing — `AnalyticsLandingPage` |
| **Primary file** | `streampulse-web/src/ui/components/analytics/HubLiveWireFeed.tsx` |
| **Layout shell** | `AnalyticsFigmaShell` / `figma-analytics.css` (`figma-analytics__frame`) |
| **Data resolver** | `resolveLivePulseMoments` → `LivePulseMomentsResult` (source-aware; `livePulseMomentsFromPublicHub` is **deprecated**) |

## Summary

Turn **Live Wire** (the system's "Pulse Wire") from a horizontal chart-attached
annotation lane into a **fixed right rail** — a persistent, always-visible
"catch-moment radar." Each moment is a **Callout card** showing the channel,
**current category**, chat/emote magnitude, top emotes, and a clear
**leave to channel analytics / jump-to-VOD** action. The rail shows a tight
**"Live now"** band plus a compact **"Older retained moments"** disclosure.

Decisions (confirmed via interactive mockups): **Approach A fixed right rail**,
**Callout card anatomy**, **tiered Live now + older-retained** (renamed from
"Earlier today" — see §Tiered freshness for why).

This spec **supersedes** the hub-landing "Live Wire placement" contract in
`docs/website-portal/analytics-command-center-layout.md`, which mandated a
chart-attached lane, a shared `selectedMomentKey`, and removal of the third rail
column. The supersession is explicit and the affected tests/audit must be updated
in the **same implementation batch** (§Conflict supersession).

## Motivation

Currently Live Wire renders as one-line chips above the Global Activity chart
(`layout="lane"`) and its click **selects** the moment in place (shared
`selectedMomentKey`). That makes it a passive annotation, not a catch surface,
and it is cramped to one horizontal line. Users want a **glanceable radar** that
**launches to the channel analytics / VOD** rather than inspecting in place,
shows **categories**, and is detailed enough to be a real feature.

## Goals / non-goals

**Goals**
- Persistent right rail that mirrors the left sidebar, always on at desktop widths.
- Each moment card surfaces: channel, **current category**, Chat + Emotes magnitude, top emotes, age, NEW badge, and a clear jump/launch action.
- Tiered freshness: "Live now" (≤30m) + compact, honestly-labeled "Older retained moments" disclosure.
- Native to the existing theme (reuse `--sp-*` tokens and `hub-live-wire__*` / `figma-*` class conventions); restrained, consistent motion.
- Reuse existing data and helpers (`resolveLivePulseMoments`, `buildAnalyticsHref`, `buildVodTimestampUrl`, `formatChatRate`, `formatMomentViewersLabel`, `HubMomentRailBody`'s proven href logic).

**Non-goals**
- **No new backend API / new data fields.** Reuse `LivePulseMomentsResult`. This means the rail shows only **currently-retained** moment rows; it is **not** a full day archive.
- Do NOT keep the in-place moment inspection model on the rail. Chart + Pulse Moments keep their own selection; the rail is decoupled.
- Do NOT add a *second* right rail or a competing sticky column.
- No client-side derived "score" — display only backend-authored `moment.score` if present; otherwise omit, never invent.
- No `href="#"` fallbacks (see §Navigation).

## Conflict supersession (REQUIRED in same batch)

1. **Canonical layout contract:** Update `docs/website-portal/analytics-command-center-layout.md`'s "Live Wire placement (2026-07 P1)" section to mark it superseded on the hub landing by this spec (rail replaces the lane; selection decoupled; third column reintroduced). Update the "Do not regress" bullets accordingly.
2. **Refactor audit:** Update the relevant analytics refactor/unused-feature audits that still describe the lane model.
3. **E2E contract:** `streampulse-web/tests/e2e/analytics-hub-live-wire-ticker.spec.ts` currently **asserts the opposite** of the new design and must be **replaced**, not augmented:
   - line 29, 80: `expect('.figma-analytics__side-rail--right').toHaveCount(0)` (asserts no right rail) → flip to assert the new rail is present at desktop widths.
   - lines 30–53: asserts `#section-live-wire` is visible **inside** the chart col and the lane is **above the chart** → replace with rail-anchoring assertions.
   - Keep `assertNoPageHorizontalOverflow` and the viewport matrix.
4. **Naming:** Use **Live Wire** everywhere (matches the active liveness contract/`#section-live-wire`). "Pulse Wire" only appears as the product-facing label if a copy decision keeps it; otherwise it is deprecated in this surface. Use `resolveLivePulseMoments` (not the deprecated `livePulseMomentsFromPublicHub`).

## Layout

`figma-analytics__frame` is currently `grid-template-columns: 220px minmax(0, 1fr)` at wide widths. Extend to a three-column grid **only when there is enough room** for a viable center workspace.

### Breakpoints (no overlapping ranges)

| Viewport | Columns | Rail behavior |
|----------|---------|---------------|
| **≥ 1440px** | `220px minmax(0,1fr) 320px` | Sticky full-height rail, internally scrolls. |
| **1100 – 1439px** | `220px minmax(0,1fr)` | **No persistent rail.** The rail becomes a slide-over drawer opened by a "Live Wire" control. Center keeps full width. |
| **< 1100px** |`minmax(0,1fr)` | No rail in flow. Optional stacked "Live Wire" section below the main content (smallest coherent mobile flow), or the drawer control. |

### Minimum-center-width policy (P0 #3)

- The **third column must not engage unless the center workspace stays ≥ 720px** after the left sidebar + rail + shell gaps + padding.
- The chart inspector reserves ~350px until the `min-width: 1100px` breakpoint, and the embedded Pulse Moments grid needs `minmax(240px, 0.72fr) + minmax(0, 1.85fr)`. Because of these **nested fixed-width constraints**, do **not** force the rail at < 1440px with the current nested layouts; that is why the persistent rail starts at 1440px. (Container-query conversion of the nested grid is a documented future option to lower the persistent-rail threshold, out of scope here.)
- **Expected center-column widths** (document in tests, ±pad tolerance):
  - 1024px → no rail; center ≈ 1024 − shell/sidebar/padding (≈ 700–760px).
  - 1100px → no rail; center ≈ 220 + gaps (≈ 800px).
  - 1440px → rail 320px engaged; center ≈ 1440 − 220 − 320 − gaps − padding (≈ 800px).
  - 1520px → rail engaged; center ≈ 880px.
  - 1600px → rail engaged; center ≈ 960px.
- The Chart / Pulse Moments center column already uses `minmax(0, 1fr)`, so it flexes to the remaining width once the rail is gated correctly.

### Sticky rail mechanics (P0 #4)

- The rail is a **sticky grid child** (`position: sticky; top: <header offset>`), **not** `position: fixed` — a fixed element would misalign against the centered shell on wide screens.
- Aligned to the centered shell's right edge; define a `top` offset below the top nav, a `max-height: calc(100vh - <top> - <footer gap>)`, and **one internal scroll owner** (`overflow-y: auto`) so the page never double-scrolls.
- On mobile (< 1100px), the **stacked section** is the smallest coherent mobile flow: render Live Wire as a normal in-flow section below the main content; no drawer trigger, no dialog semantics, no focus trap, no scroll lock. (A slide-over drawer is explicitly listed as a **future** enhancement because it requires a trigger, `role="dialog"` semantics, focus trapping/restoration, Escape + backdrop handling, and scroll locking — do not ship it half-specified in this batch.)

## Moment card (Callout card)

Vertical card (320px rail / 260px fallback, dark `--sp-surface-2`, teal `--sp-accent`):

```
[avatar]  display name            [2m ago] [NEW]
          Just Chatting ▸ category sub-line

Chat      ████████████░░  38k/m
Emotes    ████████░░░░░░  12k/m

[emoji][emoji][emoji]      View moment →
```

- **Header row:** `Avatar` + `displayName`; sub-line shows the **category**. **Honesty (P0 #1/P1 #7):** the category comes from `moment.category`; for older retained rows it is the **current-roster** category (via `hub.liveChannels`), **not necessarily event-time metadata**. Do not present it as the game played at the moment unless `moment.category` is event-time. Where absent, show a neutral "—"/omit, never a placeholder.
- **Right of header:** `relativeTime(moment.at)` + `NEW` badge (see §Freshness & NEW for the deterministic rule).
- **Twin magnitude bars:** `Chat` / `Emotes` mini bars. **Normalize each dimension independently** across the currently-visible set (chat vs max-chat, emotes vs max-emotes). **Distinguish missing from zero** (missing → "—" and no bar; zero → 0 bar). Never derive a new client-side score.
- **Top emotes:** up to 1–3 thumbnails from `moment.topEmotes` via `EmoteImg` + `resolveMomentEmote`; omit row/emoji entirely when there are no emote rollups.
- **Accessibility:** each bar carries an accessible label ("Chat 38k/min"), not color-only.

## Navigation (P0 #5)

- **No nested controls.** Render the card as a non-interactive `article` (in a `role="list"`/`<ul>` of `role="listitem"`) with **sibling** action buttons/links — do NOT wrap the whole card in a link and nest a VOD link inside it.
- **Primary action** "View moment": use `moment.href`, falling back to `buildAnalyticsHref({ login, streamId, offsetSeconds })` (canonical `/analytics/{login}/{streamId}#t={offset}`). **Never fall back to `href="#"`** — if there is no href and no login, render a disabled state instead.
- **VOD action**: when `vodId` is present, a sibling **"Jump to VOD"** via `buildVodTimestampUrl(vodId, offsetSeconds)`, external (`target="_blank" rel="noreferrer"`).
- Reuse the href-resolution logic already proven in `HubMomentRailBody` (extract to a shared helper rather than reimplementing), including `primaryExternal` and disabled-state handling ("No VOD indexed yet"/"Live tracking only").

## Tiered freshness (P0 #1)

- **"Live now" (top):** moments where `0 <= now - at <= 30 min` (freshness window), **newest first**. New cards slide in from the right on poll (max 3 per poll — `MAX_NEW_ANIMATIONS_PER_POLL`, `useAnalyticsMotion` `animateEnterHorizontal`).
- **"Older retained moments" (below, collapsed):** the **remaining rows the payload actually holds** that are older than the Live-now window. Label it honestly as **partial retained rows** — the payload is a per-poll snapshot of currently-live peaks with **no historical horizon, completeness indicator, or total count**; it is **not a day archive**. The disclosure counts **only rows actually rendered** (no fabricated counts). Expanding lists them newest-first with a subtle age fade.
- **A real historical tier requires a new backend contract** (a `livePulseMoments` history endpoint with horizon + completeness + total). Explicitly **out of scope**; do not fake it client-side.

## Freshness & NEW (P0 #6) — deterministic contract

- **Live now** = a *valid* wall-clock timestamp satisfying `0 <= now - at <= 30min`. Validate `momentAtMs`: reject `null`, non-finite, `<= 0`, and **future** timestamps (`at > now`).
- **NEW** is granted only to a moment **first observed in a successfully applied poll** with a **stable poll identity** (e.g. the poll/fetch sequence that produced the current row set). NEW must **never** be granted on:
  - initial cache hydration,
  - fallback/featured data,
  - cache-only responses,
  - degraded endpoints (`isHubNetworkDegraded`).
- **Reduced motion** (`prefers-reduced-motion`): suppress entrance animation but **retain the semantic NEW label**. NEW has an **explicit expiration** (the Live-now window); after it expires the badge clears regardless of animation state.

## Optional data honesty (P1 #7)

- Avatar, category, emotes, viewers, and VOD are all **optional**. Define and render honest missing states ("—", disabled action, no emoji row) — never placeholders or fabricated values.
- `viewers`/`chatPerMin`/`emotesPerMin` may be absent → show "—", not "0".
- Live/current info (`profileImageUrl`, roster category) is enrichment for display, **not** event-time truth; label/derive conservatively.

## Data & errors

- Feed: reuse the `LivePulseMomentsResult` already built on the landing page (`liveWireFeed` / `liveWireFeedProps`), via `resolveLivePulseMoments`. No new fetching.
- Degraded hub: `isHubNetworkDegraded(loadSource, hubEndpointOk)` → rail shows the aggregate-only honesty banner (existing `feed.banner` copy) and **no NEW / no entrance motion**. Never fabricate moments on cache/fallback/degraded.

## Accessibility & performance

- Rail is semantic `<aside aria-label="Live Wire">` (page already uses `<aside>` for the left sidebar). Cards are `article` list items; actions are real links/buttons, focusable; `NEW` is a visible badge, not color-only.
- Single internal scroll owner; sticky grid child; respect reduced motion.
- Reuse `useAnalyticsMotion`; no new deps. Plain DOM + CSS; the component's existing `:1000`-ms `now` interval is unchanged.

## Conflict with existing right-recap rail

The **session console** has a separate "Pulse moments recap" right `aside` (see `analytics-session-pulse-moments.spec.ts`, `HubMomentRailBody`). That is a **different surface** (session dashboard recap) and is **unaffected** — this spec only changes the **hub landing** Live Wire. Do not confuse or merge the two; shared href helpers may be reused, but the session recap rail stays as-is.

## Testing (P2 #9 — replace, not just add)

- **Replace** the assertions in `analytics-hub-live-wire-ticker.spec.ts` (see §Conflict supersession) so the contract matches the rail, and keep `assertNoPageHorizontalOverflow` across the viewport matrix.
- Cover (new tests):
  - Timestamp boundaries: exactly 30:00, just-under, just-over, missing, invalid, zero, future.
  - Cache/degraded/fallback: no NEW, no entrance motion; honesty banner.
  - Poll identity: NEW only on successfully applied poll; expiration clears it.
  - Missing fields: no avatar/no category/no emotes/no VOD render honest states; missing vs zero bars.
  - Bar normalization: Chat and Emotes each normalize against their own max; accessible labels.
  - Canonical links: primary `buildAnalyticsHref` path, VOD `buildVodTimestampUrl` path, no `href="#"`.
  - Disclosure: "Older retained moments" collapses/expands; counts only rendered rows.
  - Non-nested controls: article + sibling actions (no link-in-link; `npm run check:analytics-links`).
  - Sticky/internal scroll: rail sticky, single scroll owner, no double scroll.
  - Reduced motion: animation suppressed, NEW retained.
  - **Computed layouts at 1024 / 1100 / 1280 / 1439 / 1440 / 1520 / 1600**, verifying center-width policy and rail presence/absence.
- **Run `npm run check:analytics-overlap`** (and `check:analytics-links`) as part of the batch.

## Out of scope (later)

- Real historical "earlier today" tier (requires new backend contract with horizon/completeness/total).
- Slide-over drawer with full dialog semantics (mobile/1100–1439). Documented future enhancement.
- Lowering the persistent-rail threshold via container-query conversion of the nested chart/Pulse Moments grid.
- Persisting the disclosure open/closed state.
- Server-driven ranking and category-filter chips inside the rail.
