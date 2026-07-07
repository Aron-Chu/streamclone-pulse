# Analytics command center layout

| | |
|---|---|
| **Status** | Active (2026-07) |
| **Surface** | `/analytics` hub landing — `AnalyticsLandingPage` + `figma-activity-hub` |
| **Code** | `streampulse-web/src/routes/analytics/AnalyticsLandingPage.tsx`, `PulseMomentsLivePanel`, `FigmaGlobalActivityPanel` |

## Live Wire placement (2026-07)

`HubLiveWireFeed` on hub landing — label **Live Wire** (`section-live-wire`, `hub-live-wire`).

| Viewport | Placement |
|----------|-----------|
| **All widths** | Full-width **horizontal ticker** inside `figma-activity-hub`, **above** the Network Activity chart (`layout="ticker"`) |

The sticky right rail and third frame column are **removed** — the chart and Pulse Moments grid use the full center column width at every breakpoint.

Ticker behavior: **static** horizontal **moments feed** (newest first) with hidden scroll when chips overflow. Each chip is a detected **network peak** — event type, streamer, moment-specific detail (top emote name, chat/m, viewers), and relative time. It does **not** repeat the emote-velocity leaderboard (`topMovers` lives only in Emote Signal). New network moments slide in from the left on poll only (max 3 per poll).

**Section roles (avoid duplication):**
- **Live rail** — who's live in the pool (viewer-ordered cards)
- **Live Wire** — chronological network peaks / moments feed above the chart
- **Emote Signal → Top movers** — emote velocity leaderboard (paired with Emote economy donut)

## Section order (top → bottom)

1. Command-center hero (search, live rail, coverage strip)
2. **Network activity** — `figma-activity-hub`: **Live Wire ticker** → chart → Pulse Moments embedded two-up
3. Emote Signal, Tracked Channels, Coverage

## Pulse Moments embedded layout (2026-07)

Side-by-side grid inside `.pulse-moments-live--embedded`:

| Column | Component | Behavior |
|--------|-----------|----------|
| **Left (~1.85fr)** | `MostReactedMinutesTable` | Full-width table; `align-self: start` so rows do not stretch when the side column is taller |
| **Right (~0.72fr, min 240px)** | Moment inspector + Selected minute emotes | Flex column; inspector fixed height; bursts panel **fills remaining column height** |

### Moment inspector (pulse-live)

- KPI row uses `pulse-moments__inspector-kpi-row--live-compact`: **Emotes / min**, **Chat / min**, and **Viewers** stay on **one row** (container queries must not wrap live-compact to 2 columns).
- Top emote hero + action buttons (`View moment`, VOD jump, Analytics) sit above the bursts panel.

### Selected minute emotes

- `TopEmoteBurstsPanel` variant `pulse-live` — title **Selected minute emotes**, subtitle **Emote breakdown (by share)**.
- Embedded hub: panel is `flex: 1` in the side column; list body scrolls inside the filled area (`overflow-y: auto`), not a fixed `max-height` chip.
- Empty state still expands to column bottom with centered hint copy.

### Do not regress

- Do not move moment inspector into the chart rail on hub landing (side panel stays in Pulse Moments grid).
- Do not reintroduce `min-height: 11.5rem` on embedded bursts body (session/`?figma=1` dashboards may keep reserved height).
- Do not stretch the moments **table** to match side height (no dead gap under table rows).

## Chart bucket inspector rail (2026-07)

Right column of network activity chart (~350px):

- **Selected / preview bucket:** thin **1px full-panel outline** (not thick left bar).
- Footer: **Top streamers this bucket** (from bucket-filtered Pulse Moments), not provider mix bars.
- **Selected bucket load:** streamers use optimistic live-pool moments + hover prefetch cache immediately; no skeleton row swap (label-only pending state); empty state copy when corpus returns no peaks.
- Emote rank list may use `fill` to distribute rows; provider mix removed from rail.

### Default range inspector (no bucket)

- Footer: **Top live by activity** — live pool channels ranked by chat/emote rate (subtitle: chat & emote rate — live pool).
- Emote list stays compact; footer fills the rail bottom.

## Verification

```bash
cd streampulse-web
npm run dev:hosted
npx playwright test tests/e2e/analytics-hub-ux.spec.ts tests/e2e/hub-audit-regression.spec.ts --workers=1
```

Manual: default rail shows **Top live by activity**; lock a chart bucket → rail shows streamer footer (instant when live pool overlaps, skeleton otherwise); select a Pulse Moments row → three KPIs on one line; Selected minute emotes fills to bottom of side column.

## Related

- [`analytics-figma-parity-requirements.md`](analytics-figma-parity-requirements.md)
- [`design.md`](design.md)
- [`../design/streampulse-analytics-hub-design.md`](../design/streampulse-analytics-hub-design.md)
