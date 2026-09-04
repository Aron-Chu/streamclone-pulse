# Analytics command center layout

| | |
|---|---|
| **Status** | Active (2026-07) |
| **Surface** | `/analytics` hub landing — `AnalyticsLandingPage` + `figma-activity-hub` |
| **Code** | `streampulse-web/src/routes/analytics/AnalyticsLandingPage.tsx`, `PulseMomentsLivePanel`, `FigmaGlobalActivityPanel` |

## Live Wire and the shared activity rail (2026-09)

Global Activity has one chart-side context slot. `ActivityContextRail` keeps the
working Live Wire mounted and exchanges the visible pane according to chart
state:

| Page state | Visible rail body |
|------------|-------------------|
| Idle | Complete filterable and sortable Live Wire |
| Hovered chart bucket | Transient `ActivityBucketInspector` preview; focus stays where it was |
| Locked chart or Live Wire moment | `ActivityBucketInspector` with **Back to Live Wire** and Escape support |

At a component width of 820px or more, the Global Activity body uses
`minmax(0, 1fr) clamp(288px, 30cqw, 340px)`. This intentionally preserves the
right rail at the ordinary 1119px application viewport, where the permanent
analytics navigation leaves about 840px for content. The desktop rail is
bounded to the viewport and only its moment list scrolls; header, controls,
summary, and explanation remain visible.

Below 820px the source order is chart, Live Wire/bucket inspector, then Pulse
Moments. Live Wire expands with the page at narrow widths, so a locked bucket
always replaces the wire immediately below the chart instead of appearing
after a long moment list.

### Pulse Explorer contract and routes

- `/analytics/explore` is the canonical broadcast index and
  `/analytics/explore/:broadcastId` is canonical detail. Retired
  `/analytics/newsroom` routes redirect while preserving identifier, query, and
  hash. All reserved routes precede dynamic channel routes.
- Explorer is the deeper companion to Live Wire, not an editorial news feed.
  Its default query is **24h**, **Strongest**, all signals, all categories, and
  all stream states. Every result is one exact stream session.
- The portal accepts only the strict `schemaVersion: 1` Explorer envelope and
  server-owned scores, comparisons, facets, and cursors. It never rebuilds
  qualification or rank in the browser.
- At 960px or wider, results and a sticky inspector form an independently
  scrollable two-pane workspace using
  `clamp(320px, 34cqw, 420px) minmax(0, 1fr)`. Narrow index routes show results;
  nested routes show detail with a Back action.
- Range, search, signal, category, stream state, and sort are URL-backed.
  Opening and closing the inspector preserves the list, loaded pages, filters,
  sort, and scroll position. Back/Forward, direct refresh, and Escape restore
  the same query.
- Detail renders every qualified moment chronologically. A trend appears only
  for at least two valid scored points; a single moment uses one concise
  evidence block. Every moment displays at most three backend-provided emotes.
- List and inspector requests fail independently. Loading, refreshing, stale,
  empty, unavailable, and malformed-contract states are explicit; a failed
  detail request never erases a valid list and a failed refresh retains valid
  content.
- Analytics, Watch live/VOD, and Copy link are separate actions. Matched Twitch
  clips and approved LSF/Reddit, YouTube, or news links are labeled context and
  never affect qualification, scores, ordering, or lifecycle. X is hidden until
  its approved ingestion adapter is enabled. Empty context appears only in
  detail.
- A compact network strip appears only when the latest two closed 30-minute
  windows have a valid comparison. The portal never fills missing comparison
  state with zeroes.
- `/analytics` does not request Explorer or deprecated Newsroom data. Its sole
  cross-link is the understated **Pulse Explorer** link in Live Wire.

**Section roles (avoid duplication):**
- **Hottest live** — activity-ranked live pool cards (shared `rankLiveChannelsByActivity` with chart inspector “Top live by activity”); viewers are secondary context
- **Live Wire** — filterable, sortable chart-side browse-and-focus view of backend-qualified moments from current streams; never a second scoring model
- **Pulse Explorer** — separate exact-broadcast search and evidence workspace over live/24h/7d qualified moments; never embedded in the overview rail
- **Pool Wire** — compact lifecycle heartbeat in the command header (`POOL Stable` when quiet)
- **Emote Market** — leaders / concentration / provider; breadth & rotation gated on backend market fields
- **Channel Screener** — multi-view tracked table (Overview / Momentum / Coverage / Anomalies)
- **Top clips** — only when sanitized public published clips exist (never beta candidate queue)

## Section order (top → bottom)

1. Command-center hero (search, Hottest live rail, coverage strip)
2. **Network activity** — `figma-activity-hub`: chart stack (plot + navigator + fixed provider lanes) with one shared Live Wire / bucket-inspector rail → Pulse Moments embedded two-up

## Live Wire activity rail (2026-09)

`HubLiveWireFeed` uses its complete `rail` layout in the Global Activity side
slot. The
default **Current streams** scope exposes the complete bounded set returned for
the current live sessions, rather than reducing Live Wire to one current card
or one per channel. **Last 30m** is an explicit freshness filter.

- Filter by backend-authored reaction signal (**All signals / Chat / Emotes**)
  and by category.
- Order by **Newest**, **Strongest**, or deterministic **Category groups**.
- One dense editorial column with a bounded vertical moment-list scroller on
  desktop; no horizontal scroller.
- Hover or focus softly accents the resolved served Global Activity bucket.
  A detection in the omitted open chart interval may use the immediately
  preceding completed bucket and discloses that relationship. Click locks it
  and reuses the existing bucket and Pulse Moments inspectors. The
  card settles into a full outline while the chart draws a line, node, and one
  expanding ring; selection never uses a left-edge stripe.
- Cards that cannot prove exact stream identity plus a truthful loaded chart
  bucket remain visible but disabled as pending. Rail clicks never fall through
  to channel analytics.
- The browser filters and reorders only. Detection, qualification, comparison,
  confidence, and scores remain backend-owned.
- Reduced-motion mode skips both selection animations and preserves the static
  full outline and chart cue.
- Live Wire filters and list scroll position survive the temporary inspector
  view because the inactive pane stays mounted, inert, and hidden from assistive
  technology.
- Cards use flat neutral surfaces and equal full-perimeter borders. Signal color
  is limited to labels/icons; decorative gradients, glow, and left-edge accents
  are forbidden. Each card renders at most three backend-provided emotes.

The authoritative signal, scoring, peak qualification, category ordering, and
capacity contract is [`live-wire-moment-system.md`](live-wire-moment-system.md).
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

Shared activity rail of the network chart (288–340px from an 820px query-container breakpoint; otherwise stacked):

- **Idle state is Live Wire**; chart hover or a locked bucket replaces it with the preview-only Activity Bucket Inspector. Live Wire moment hover accents the chart without hiding the wire.
- **Selected / preview bucket:** thin **1px full-panel outline** (not thick left bar).
- Emote rank list may use `fill` to distribute rows; provider mix removed from rail.
- Footer (default range): **Top live by activity** — live pool channels ranked by chat/emote rate.

### When a Pulse Moment is selected

- Full moment detail stays in the darker **Pulse Moments** side inspector only.
- Chart accent highlights the moment’s bucket.
- Rail shows **that bucket’s preview** (emotes + stats) plus a short **“Linked to selected moment”** strip (channel · label · Clear).
- No `HubMomentRailBody` / teal moment clone in the rail.

### Do not regress

- Do not embed Live Desk, deprecated Newsroom stories, or Explorer results in the `/analytics` overview.
- Do not move Live Wire below the chart or back into an annotation lane.
- Do not synthesize or fetch a bucket solely to make a Live Wire selection appear to resolve.
- Do not reintroduce `.activity-bucket-inspector--moment` as a full moment body.

## Global Activity navigator (2026-08)

The chart owns a client-side `HubChartNavigator` between the time axis and the fixed provider lanes. It changes only the visible subset of the already-loaded 30m / 24h / 7d response; it never changes the requested server range, coverage totals, Explorer/Live Wire selection, or provider ordering.

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
PORTAL_E2E_MOCKED=1 npx playwright test tests/e2e/analytics-explorer.portal-mocked.spec.ts --workers=1
npx playwright test tests/e2e/analytics-hub-chart-contract.spec.ts tests/e2e/analytics-hub-live-wire-ticker.spec.ts --workers=1
```

Manual: confirm one shared Live Wire / bucket-inspector rail and Pulse Explorer at 390, 768, 1119, 1280, 1440, and 1600px. The Live Wire rail must be beside a chart at least 520px wide at 1119px and stacked immediately after it at narrow widths. Exercise Live Wire preview/lock/Back/Escape and retained state. In Explorer, exercise every URL-backed control, desktop two-pane and mobile index/detail navigation, direct detail refresh, browser history, single- and multi-moment broadcasts, matched and empty context, and every fallback state. Verify `/analytics` makes no Explorer or Newsroom request and neither surface uses decorative gradients, glow, oversized avatars, or unequal selection borders.

## Related

- [`analytics-figma-parity-requirements.md`](analytics-figma-parity-requirements.md)
- [`analytics-product-refactor-audit-2026-07-10.md`](analytics-product-refactor-audit-2026-07-10.md)
- [`design.md`](design.md)
- [`../design/streampulse-analytics-hub-design.md`](../design/streampulse-analytics-hub-design.md)
