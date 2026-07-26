# Analytics command center layout

| | |
|---|---|
| **Status** | Active (2026-07) |
| **Surface** | `/analytics` hub landing — `AnalyticsLandingPage` + `figma-activity-hub` |
| **Code** | `streampulse-web/src/routes/analytics/AnalyticsLandingPage.tsx`, `PulseMomentsLivePanel`, `FigmaGlobalActivityPanel` |

## Live Wire placement (2026-07 P1)

`HubLiveWireFeed` on hub landing — label **Live Wire** (`section-live-wire`, `hub-live-wire--lane`).

| Viewport | Placement |
|----------|-----------|
| **All widths** | Chart-attached **annotation lane** inside `.figma-global-activity__chart-col` (under range controls / above the plot), `layout="lane"` |

The sticky right rail and third frame column are **removed** — the chart and Pulse Moments grid use the full center column width at every breakpoint.

Lane behavior: compact one-line chips for network peaks within the last **30 minutes**. Primary click **selects** the moment (shared `selectedMomentKey` with Pulse Moments + chart markers). Deep-link to channel analytics stays secondary (row/href elsewhere), not the default chip click. Quiet empty: `No network breakouts in the last 30m`. `NEW` requires event age ≤ 30m **and** first observation this poll. It does **not** repeat the emote-velocity leaderboard (`topMovers` lives only in Emote Market). New network moments slide in from the left on poll only (max 3 per poll).

### Shared moment selection

- Page owns `selectedMomentKey` / `onSelectMoment`.
- Annotation chip, chart `momentMarkers`, and Pulse Moments table share one selection.
- `accentBucketT` is derived from `activityBucketKey(selectedMoment.at, windowMinutes)`.
- Clearing the chart bucket (or selecting a different bucket) clears moment selection.
- Do **not** move the moment inspector into the chart rail.

**Section roles (avoid duplication):**
- **Hottest live** — activity-ranked live pool cards (shared `rankLiveChannelsByActivity` with chart inspector “Top live by activity”); viewers are secondary context
- **Live Wire** — fresh (≤30m) chart annotations + markers
- **Pool Wire** — compact lifecycle heartbeat in the command header (`POOL Stable` when quiet)
- **Emote Market** — leaders / concentration / provider; breadth & rotation gated on backend market fields
- **Channel Screener** — multi-view tracked table (Overview / Momentum / Coverage / Anomalies)
- **Top clips** — only when sanitized public published clips exist (never beta candidate queue)

## Section order (top → bottom)

1. Command-center hero (search, Hottest live rail, coverage strip)
2. **Network activity** — `figma-activity-hub`: chart stack (**annotation lane** → plot + markers) → Pulse Moments embedded two-up
3. Emote Market, Top clips (if any), Channel Screener, Coverage

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

- **Preview-only** — range / hover / locked bucket. Never becomes a second Moment Inspector.
- **Selected / preview bucket:** thin **1px full-panel outline** (not thick left bar).
- Emote rank list may use `fill` to distribute rows; provider mix removed from rail.
- Footer (default range): **Top live by activity** — live pool channels ranked by chat/emote rate.

### When a Pulse Moment is selected

- Full moment detail stays in the darker **Pulse Moments** side inspector only.
- Chart accent highlights the moment’s bucket.
- Rail shows **that bucket’s preview** (emotes + stats) plus a short **“Linked to selected moment”** strip (channel · label · Clear).
- No `HubMomentRailBody` / teal moment clone in the rail.

### Do not regress

- Do not move moment inspector into the chart rail on hub landing.
- Do not reintroduce `.activity-bucket-inspector--moment` as a full moment body.

## Verification

```bash
cd streampulse-web
npm run check:analytics-overlap
npm run dev:hosted
npx playwright test tests/e2e/analytics-hub-ux.spec.ts tests/e2e/analytics-hub-live-wire-ticker.spec.ts --workers=1
```

Manual: annotation lane sits above the plot; click a chip → dark Pulse Moments inspector fills + chart accent + rail linked strip (not a second moment card); clear linked / lock another bucket → selection clears as designed.

## Related

- [`analytics-figma-parity-requirements.md`](analytics-figma-parity-requirements.md)
- [`analytics-product-refactor-audit-2026-07-10.md`](analytics-product-refactor-audit-2026-07-10.md)
- [`design.md`](design.md)
- [`../design/streampulse-analytics-hub-design.md`](../design/streampulse-analytics-hub-design.md)
