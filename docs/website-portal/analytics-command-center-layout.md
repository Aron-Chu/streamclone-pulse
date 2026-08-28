# Analytics command center layout

| | |
|---|---|
| **Status** | Active (2026-07) |
| **Surface** | `/analytics` hub landing — `AnalyticsLandingPage` + `figma-activity-hub` |
| **Code** | `streampulse-web/src/routes/analytics/AnalyticsLandingPage.tsx`, `PulseMomentsLivePanel`, `FigmaGlobalActivityPanel` |

## Pulse Newsroom and the shared activity sidecar (2026-08)

Global Activity has one existing inspector slot, not a second rail. `ActivityNewsroomSidecar` owns that slot and switches its only mounted body:

| Page state | Shared sidecar body |
|------------|---------------------|
| Idle | `LiveDeskRail`: one lead verified story and at most two secondary headlines |
| Hovered loaded bucket | `ActivityBucketInspector` preview |
| Locked loaded bucket | `ActivityBucketInspector` |
| Resolved Newsroom story moment | Locked `ActivityBucketInspector` with a **Back to Live Desk** action |
| Newsroom unavailable, absent, or malformed | Existing `HubLiveWireFeed` rendered vertically in the same slot |

The Global Activity component is a query container. It defaults to a stacked chart then sidecar. Only when its own content width reaches 1120px may it use `minmax(720px, 1fr) clamp(300px, 24cqw, 360px)`. A viewport width is never treated as proof that the chart has 720px after analytics navigation. The sidecar is neither sticky nor independently scrolling.

Mobile order is chart, lead Live Desk story, bucket inspector only after explicit selection, then **View Pulse Newsroom**. Live Desk and the bucket inspector must never be adjacent rails or simultaneously mounted.

### Story-to-chart resolution

- The page owns `selectedMomentKey`, bucket focus, and whether a Newsroom story initiated focus.
- A Live Desk story may select the chart only when its `publicMomentId` resolves to an already-loaded real moment, its `streamId` is an exact match, and that moment's bucket exists in the currently served activity points.
- Successful resolution reuses the loaded moment. It does not construct a synthetic `FigmaMomentRow`, request `/hub/moments`, or prefetch a historical bucket.
- Any failed identity, moment, or served-bucket check navigates to `/analytics/newsroom/:storyId`.
- **Back to Live Desk**, range changes, and ordinary chart/moment selection clear Newsroom-owned focus and restore normal bucket fetching behavior.

### Newsroom contract and routes

- `/analytics/newsroom` is the canonical live/24h/7d editorial index. `/analytics/newsroom/:storyId` is canonical detail. Both routes precede dynamic channel routes and use the analytics shell with `hideSidebar`.
- The portal accepts only `schemaVersion: 1` envelopes and strict server-owned comparisons. Every versioned envelope must carry a real writer `dataThrough` watermark, including `unavailable`; a response without that watermark fails closed to the existing Live Wire fallback.
- Story sparkline samples are backend-owned, chronological, and capped at twelve. Omitted minute timestamps break the line; the browser never fills gaps or calculates baselines.
- `ready` renders Live Desk, `empty` renders **Quiet now**, and `stale` preserves the last valid stories with their data-through age. `unavailable`, an absent endpoint, or malformed data uses the existing Live Wire fallback in the same sidecar.
- Initial loading may use a skeleton. Refresh preserves current content. The first healthy response silently establishes a baseline; only a new notification-eligible story or a lifecycle transition with a higher revision is announced. Polls, late corrections, ordinary signal updates, relative-time changes, and stale recovery are silent.
- Story actions are three distinct, aligned destinations: Analytics, Watch live/VOD (or disabled Replay unavailable), and Copy link. Numeric breakout scores are absent from Newsroom.

**Section roles (avoid duplication):**
- **Hottest live** — activity-ranked live pool cards (shared `rankLiveChannelsByActivity` with chart inspector “Top live by activity”); viewers are secondary context
- **Live Desk / Pulse Newsroom** — clustered broadcast stories with a canonical timeline; Live Wire remains the compatibility fallback while Newsroom reads are unavailable
- **Pool Wire** — compact lifecycle heartbeat in the command header (`POOL Stable` when quiet)
- **Emote Market** — leaders / concentration / provider; breadth & rotation gated on backend market fields
- **Channel Screener** — multi-view tracked table (Overview / Momentum / Coverage / Anomalies)
- **Top clips** — only when sanitized public published clips exist (never beta candidate queue)

## Section order (top → bottom)

1. Command-center hero (search, Hottest live rail, coverage strip)
2. **Network activity** — `figma-activity-hub`: chart stack (plot + navigator + fixed provider lanes) with one shared Live Desk / bucket-inspector sidecar → Pulse Moments embedded two-up
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

Shared sidecar of network activity chart (300–360px only when its query container can preserve a 720px chart; otherwise stacked):

- **Idle state is Live Desk**; hover or a locked bucket replaces it with the preview-only Activity Bucket Inspector. Never becomes a second Moment Inspector.
- **Selected / preview bucket:** thin **1px full-panel outline** (not thick left bar).
- Emote rank list may use `fill` to distribute rows; provider mix removed from rail.
- Footer (default range): **Top live by activity** — live pool channels ranked by chat/emote rate.

### When a Pulse Moment is selected

- Full moment detail stays in the darker **Pulse Moments** side inspector only.
- Chart accent highlights the moment’s bucket.
- Rail shows **that bucket’s preview** (emotes + stats) plus a short **“Linked to selected moment”** strip (channel · label · Clear).
- No `HubMomentRailBody` / teal moment clone in the rail.

### Do not regress

- Do not place Live Desk and the bucket inspector in separate rails or render both at once.
- Do not synthesize or fetch a bucket solely to satisfy a Newsroom story click.
- Do not reintroduce `.activity-bucket-inspector--moment` as a full moment body.

## Global Activity navigator (2026-08)

The chart owns a client-side `HubChartNavigator` between the time axis and the fixed provider lanes. It changes only the visible subset of the already-loaded 30m / 24h / 7d response; it never changes the requested server range, coverage totals, Newsroom/Live Wire selection, or provider ordering.

- Purple capsule selection with no boxed end handles; invisible 44px handle targets expose visible focus indicators.
- Drag the full-range track or outside a zoomed selection to create a brush. Drag the selected window to pan. Drag either handle to resize with a minimum two-bucket span.
- Wheel over the plot or navigator zooms around the cursor; Shift+wheel (or horizontal wheel intent) pans. Ctrl/Meta+wheel remains available to browser zoom.
- Arrow keys adjust a focused handle, Shift+Arrow moves five buckets, Home/End clamp to the domain, and Reset or double-click restores the full loaded range.
- Pointer cancellation restores the last committed range. All mutations clamp indices and prevent inverted handles.
- The navigator exposes two ARIA sliders, a concise interaction hint, and a polite visible-range announcement.

## Verification

```bash
cd streampulse-web
npm run check:analytics-overlap
npm run dev:hosted
PORTAL_E2E_MOCKED=1 npx playwright test tests/e2e/analytics-newsroom.portal-mocked.spec.ts --workers=1
npx playwright test tests/e2e/analytics-hub-chart-contract.spec.ts tests/e2e/analytics-hub-live-wire-ticker.spec.ts --workers=1
```

Manual: confirm one shared sidecar at 390, 768, 1280, 1440, and 1600px; any side-by-side chart remains at least 720px wide. Exercise story selection, Back to Live Desk, canonical detail refresh and browser history, all fallback states, keyboard/focus behavior, and reduced motion. Verify a resolved loaded story makes no `/hub/moments` request, and that unavailable Newsroom reads preserve the current Live Wire behavior without adding a second rail.

## Related

- [`analytics-figma-parity-requirements.md`](analytics-figma-parity-requirements.md)
- [`analytics-product-refactor-audit-2026-07-10.md`](analytics-product-refactor-audit-2026-07-10.md)
- [`design.md`](design.md)
- [`../design/streampulse-analytics-hub-design.md`](../design/streampulse-analytics-hub-design.md)
