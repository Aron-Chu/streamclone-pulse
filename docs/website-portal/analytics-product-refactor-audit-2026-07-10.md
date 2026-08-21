# Analytics product refactor audit

Date: 2026-07-10  
Routes reviewed: `/analytics`, `/analytics/jasontheween/2026-07-10`  
Method: Playwright review at desktop and mobile widths, source tracing, and comparison with dense analysis products such as OpenRouter Rankings, Artificial Analysis, and TradingView market tools.

## Executive decision

Use a hybrid of directions A and C:

- **Live Wire becomes a truly live annotation layer for the activity chart.** It contains only events from the last 15-30 minutes. New events enter briefly above their chart bucket, then settle into chart markers. It is not a second moments list. *(Superseded 2026-08: Live Wire shipped as a responsive sticky **right-rail "catch-moment radar"** (`layout="rail"` via the shell `rightRail` slot) with tiered Live-now/Older disclosure and sibling Analytics + VOD actions — see [`analytics-command-center-layout.md`](analytics-command-center-layout.md). The annotation-lane wording below is the historical 2026-07 direction.)*
- **Pulse Moments remains the durable ranked investigation surface.** It can cover the selected chart range and owns filters, ranking, inspection, and VOD jumps.
- **Featured live channels becomes Hottest live in v1.** Rank it by a backend-owned activity ordering, not raw viewers and not a new client scoring formula.
- **Pool Wire remains lifecycle-only.** Keep it compact in the command header. An empty wire should read as a healthy quiet state, not consume another product section.
- **Do not build Jumpable peaks as the featured rail.** That would duplicate Pulse Moments again.
- **Do not promise Real top clips yet.** Add a clip shelf only after a sanitized public clip-candidate contract exists.

The product test for every strip should be: **what unique question does this answer?** If two surfaces answer the same question, merge them.

## Playwright evidence

### Hub

The live page showed:

- Live Wire events at `1h`, `17h`, `18h`, `19h`, `20h`, `21h`, and `22h` old.
- `NEW` labels on 17-18-hour-old events.
- HasanAbi, zackrawrr, Jynxzi, and jasontheween emote spikes repeated in Pulse Moments immediately below.
- Featured live channels ordered primarily by viewers.
- A more useful **Top live by activity** ranking already exists inside the chart inspector, but is hidden in a secondary location.
- The 390px review has a good contained horizontal rail, but the featured cards, Live Wire ticker, range controls, chart, and moments table create several consecutive horizontal interaction models.

The important semantic bug is in [HubLiveWireFeed.tsx](../../streampulse-web/src/ui/components/analytics/HubLiveWireFeed.tsx): `NEW` means newly observed in the current client poll, not newly occurred. A stale event can therefore be presented as live and new.

### Channel session

The session route repeats the same facts across:

- Six top KPI cards.
- Chart maximum/average labels and legend pills.
- Stream Recap metrics.
- The recap's top-moment sentence.
- Pulse Moments rows.
- The selected-moment inspector after interaction.

The page also rendered the same viewer-coverage notice twice: `Viewer samples started at 00:08:12; chat may begin earlier.`

On mobile, the sequence is functional but long: identity, six KPI cards, archive summary, two quality notices, chart controls, chart, recap, and moments. The user has to pass repeated summaries before reaching the first investigative action.

## Surface charter

| Surface | Unique question | Content | Freshness | Interaction |
|---|---|---|---|---|
| Command header | Is the system live and trustworthy? | Coverage, update age, pool totals, lifecycle heartbeat | Current poll | Search and status details |
| Hottest live | Where is attention accelerating now? | Backend-ranked live channels, activity rate, rank delta | 1-2 polls | Open channel/session |
| Live annotations | What just changed on the network? | At most 3-5 events from the last 15-30m | Hard expiry | Select chart bucket or open moment |
| Activity chart | When did the network move? | Viewers, chat, emotes, provider lanes | Range-dependent | Hover, lock bucket, compare signals |
| Bucket inspector | What explains this point? | Top channels and emotes for one bucket | Same as chart | Drill into channel/moment |
| Pulse Moments | Which events deserve investigation? | Ranked, filterable event table | Selected range | Inspect, VOD jump, analytics link |
| Emote Market | Which reactions are spreading or rotating? | Breadth, concentration, velocity, leaders | Range-dependent | Filter provider/channel, inspect trend |
| Channel Screener | Which tracked channels match a condition? | Sortable live/coverage table | Current poll | Filter, compare, open |
| Coverage | Can these numbers be trusted? | Collection state, gaps, source quality | Current poll | Diagnose only |

## Recommended hub composition

### 1. Command header

Keep the command-center identity, search, collection status, and primary network totals.

Change Pool Wire into a compact lifecycle line inside the header:

```text
POOL  +3 joined  -1 left  |  last change 4m ago
```

When nothing changed:

```text
POOL  Stable for 22m
```

This is more informative than a large `Waiting for lifecycle changes` block.

### 2. Hottest live

This should be the v1 job for Featured live channels.

Each card should answer why the channel is hot:

```text
#2  zackrawrr        +3 ranks
580 chat/m  225 emotes/m
Emote-led breakout  |  2m ago
```

Recommended fields:

- Backend rank and previous rank or rank delta.
- Chat/min and emotes/min.
- One reason label derived by the backend, such as `chat breakout`, `emote-led`, or `viewer surge`.
- Viewer count as context, not rank authority.
- Category and live duration in secondary text.

Do not create a new Pulse score in React. Prefer a backend `hottestLive` ordering or explicit `hotRank`, `rankDelta`, and `reason` fields. Until that contract exists, reuse the backend order behind the existing Top live by activity inspector rather than adding a different formula.

### 3. Live annotations

> **Superseded 2026-08:** this section is the historical 2026-07 direction (chart-attached annotation lane). The shipped contract is the **Live Wire right rail** — tiered cards in the shell's `rightRail` slot (sticky at ≥ 1440px, in-flow below the center column below that), `NEW` gated on a healthy full network feed + first observation this poll (baselined, no initial burst, max 3 animated per poll, right-entry), and never `href="#"` (sibling Analytics / VOD actions or a disabled state). See [`analytics-command-center-layout.md`](analytics-command-center-layout.md).

Remove the full-width stale ticker. Add a narrow annotation lane attached to the chart.

Behavior:

1. A fresh event enters near the right edge with streamer, signal, and value.
2. It animates to the matching chart bucket.
3. It settles into a small marker.
4. It disappears from the live lane after 15-30 minutes, while remaining available in Pulse Moments for the selected range.

Example:

```text
12s  zackrawrr  LUL 47  emote breakout
```

Hard rules:

- Never show `NEW` when event age exceeds the live threshold.
- Use server time or a server-provided `expiresAt` to avoid client clock ambiguity.
- Cap simultaneous animated entries at three.
- Do not run a perpetual marquee.
- Pause motion while the tab is hidden.
- Respect `prefers-reduced-motion` with an immediate marker update.

If there are no fresh events, render a quiet one-line state:

```text
No network breakouts in the last 15m
```

That empty state is more honest and more useful than filling the wire with yesterday's peaks.

### 4. Activity chart and inspector

Keep this as the primary analytical object. It already has the right interaction model: hover, select a bucket, inspect, then drill down.

Improvements:

- Make moment markers first-class chart annotations rather than a disconnected ticker.
- Use a vertical crosshair shared by chart, inspector, and Pulse Moments.
- Selecting a marker should select the same row in Pulse Moments.
- Selecting a Pulse Moment should focus the chart bucket and update the inspector.
- Add a `Compare signals` mode inspired by Artificial Analysis quadrant charts:
  - x-axis: chat velocity.
  - y-axis: emote velocity.
  - bubble size: viewers.
  - color: category or dominant provider.
- Keep chart-range freshness visible beside the range control, not repeated in several cards.

### 5. Pulse Moments

Pulse Moments owns durable event investigation.

Keep:

- Ranking.
- Chat/emote/opening filters.
- Selected-moment inspector.
- Bucket filtering.
- VOD and analytics links.

Improve:

- Add `Newest` and `Strongest` ordering, with the selected order explicit.
- Show the score basis or reason in plain language.
- Use one selected state shared with the chart.
- Remove labels from Live Wire that merely repeat the same moment kind.
- Rename ambiguous recap text such as `Top 57` to `Top Pulse score 57`.

### 6. Emote Market

The current Emote Signal area should own market structure, not another list of moments.

Borrow the useful distinction from market tools: leaders, breadth, concentration, and rotation are different questions.

Candidate modules:

- **Leaders:** top emotes by uses and velocity.
- **Breadth:** percentage of measured live channels using an emote in the range.
- **Concentration:** share held by the top 1, 5, and 10 emotes.
- **Rotation:** new entrants, rank gainers, and rank losers since the prior equal window.
- **Provider regime:** Twitch/7TV/BTTV/FFZ share over time.
- **Co-movement:** emotes that surge in the same buckets.

This creates a genuinely different product from Pulse Moments. Some fields require backend aggregation; do not infer cross-channel breadth from a partial browser payload.

### 7. Channel Screener

Treat the tracked-channel table like TradingView's screener rather than a second live-card directory.

Suggested views:

- Overview.
- Momentum.
- Coverage.
- Anomalies.

Useful filters:

- Chat acceleration.
- Emote acceleration.
- Viewer-to-chat divergence.
- Coverage state.
- Category.
- Newly live.
- Data freshness.

Rows should remain dense and sortable. Opening a row should carry the active time range and selected bucket into the channel page when possible.

## Channel-session refactor

### Current problem

[AnalyticsConsole.tsx](../../../streampulse-backend/packages/analytics-console/src/components/AnalyticsConsole.tsx) presents all available summaries at once. The chart is strong, but the surrounding cards repeatedly explain it.

### Proposed structure

```text
Session header + 4 primary KPIs
Session archive control

Chart workspace
  chart / event markers / category bands
  context rail: Overview | Moment | Emotes | Quality

Moment tape
  ranked events synchronized with chart

Detailed tables on demand
```

#### Reduce six KPI cards to four primary decisions

Recommended default:

- Current or average viewers, depending on live/historical state.
- Peak viewers.
- Total chat.
- Total emote uses.

Move duration into the session identity line. Put secondary averages in the Overview context rail.

#### Merge recap and selected inspector

Replace the standalone Stream Recap plus separate moment inspector with one context rail:

- **Overview:** session signature, biggest chat spike, emote burst, category mix.
- **Moment:** selected event, components, top emotes, VOD jump.
- **Emotes:** leaders and provider mix for the selected range.
- **Quality:** coverage, source, gaps, sync state.

The top moment should be a selected chart marker, not a sentence that repeats row #1 below.

#### Use a moment tape

Below the chart, show a compact horizontal or wrapped event tape ordered by stream time. This is different from the hub's ranked Pulse Moments table because it answers `what happened through this session?`

Each event should show:

- Offset.
- Signal type.
- Relative magnitude.
- Top reaction.
- VOD availability.

Clicking it updates the chart and context rail without adding another card.

#### Consolidate data-quality notices

The duplicated viewer-sample notice should have one owner. Prefer the Quality tab plus a single compact banner above the chart when the limitation materially affects interpretation.

## Motion system

Use animation to communicate state change, not to decorate static data.

| Event | Motion | Duration |
|---|---|---:|
| New live annotation | Enter from chart edge, settle onto bucket | 450-700ms |
| Hottest-live rank change | GSAP Flip reorder with rank delta flash | 300-450ms |
| Chart range change | Preserve old geometry, morph to new series | 250-400ms |
| Moment selection | Crosshair and inspector content transition together | 180-250ms |
| New lifecycle event | One restrained header pulse | 250ms |
| Stale/degraded transition | No flourish; direct status change | Immediate |

Avoid:

- Continuous ticker movement.
- Repeated glowing borders.
- Animating every number on every poll.
- Motion on old events merely because the browser first saw them.
- Layout shifts when labels or emote images load.

The existing GSAP/Flip system in [useAnalyticsMotion.tsx](../../streampulse-web/src/ui/motion/useAnalyticsMotion.tsx) is sufficient. No new animation library is needed.

## Thought experiments

### Quiet network

No qualifying peak occurs for 45 minutes.

- Correct: the live annotation lane says no recent breakouts.
- Incorrect: it backfills old peaks to stay visually busy.

### Large but quiet channel

A channel has 100K viewers but little chat or emote movement; a 5K-viewer channel suddenly triples activity.

- Hottest live should surface the 5K-viewer breakout.
- Viewer count remains visible so the user understands scale.

### One selected spike

The user clicks a zackrawrr emote marker.

- Chart locks the bucket.
- Bucket inspector explains the spike.
- Pulse Moments selects the same event.
- Channel link carries the offset.
- No second independent selection model appears.

### Delayed backend

The latest successful hub payload is eight minutes old.

- Fresh annotations stop entering.
- Existing recent markers remain but show the data watermark.
- Hottest live reports stale ordering.
- The UI does not label any event `NEW`.

### Mobile in 20 seconds

A user should be able to answer, without horizontal archaeology:

1. Is collection healthy?
2. What is hot now?
3. What just changed?
4. Where on the chart did it happen?

Everything else can be progressively disclosed.

### Empty clip shelf

There are no public clip candidates.

- Correct: no Top clips shelf exists.
- Incorrect: fake thumbnails or client-ranked moments imply rendered clips.

## Contract changes

Prefer explicit server-owned semantics:

```ts
type HubLiveAnnotation = {
  id: string
  at: number
  expiresAt: number
  bucketT: number
  login: string
  kind: 'chat_breakout' | 'emote_breakout' | 'viewer_breakout'
  label: string
  value: number
  topEmote?: HubEmote
  href?: string
}

type HubHottestLive = {
  rank: number
  previousRank?: number
  login: string
  viewers: number
  chatPerMin: number
  emotesPerMin: number
  reason: string
  measuredAt: number
}
```

Contract rules:

- Backend enforces annotation freshness.
- Backend owns hottest-live ordering and reason.
- Client may display and filter, but does not invent Pulse scores.
- Every time-sensitive collection carries a watermark.
- Public clips wait for a sanitized candidate or ReplayForge contract.

## Delivery sequence

### P0: semantic cleanup

- [x] Stop showing Live Wire events older than 30 minutes.
- [x] Fix `NEW` to mean event-fresh, not client-fresh.
- [x] Rename Featured live channels to Hottest live (activity-ranked via shared inspector comparator).
- [x] Remove the duplicate viewer-sample notice (chart banner removed; warmup suppressed when CoverageStartBanner owns late start).
- [ ] Rename ambiguous score labels (deferred — not in first density slice).
- [x] Compact Pool Wire quiet copy (`POOL Stable`).
- [x] Linear-inspired hub density tokens + hub font load (Inter / IBM Plex Mono).

### P1: one coordinated hub interaction

- [x] Move fresh events into a chart annotation lane.
- [x] Synchronize chart, inspector, and Pulse Moments selection (`selectedMomentKey` + markers + lane click).
- [x] Promote backend-ordered Top live by activity into Hottest live (P0).
- [x] Keep Pool Wire compact in the command header (P0).

### P2: differentiated analysis products

- [x] Turn Emote Signal into Emote Market with breadth and rotation (UI + contract; breadth/rotation gated until hub fields ship).
- [x] Turn Tracked Channels into a multi-view screener (Overview / Momentum / Coverage / Anomalies).
- [ ] Add the channel-page context rail and moment tape (session route — out of hub slice).

### P3: clip product

- [x] Add a public sanitized published-clip read contract (`publicClipsContract` — rejects candidate/job fields).
- [x] Build Top clips shelf only from playback-verified public clips (omit when empty).
- [ ] Use ReplayForge output only when rendered assets actually exist (backend eligibility remains server-owned).

## Acceptance criteria

- Live Wire never displays an event older than its declared freshness window.
- `NEW` is impossible on an expired event.
- Live Wire and Pulse Moments no longer render the same rows as adjacent lists.
- Hottest live ordering is backend-owned and activity-led.
- Selecting a moment has one synchronized selected state across chart, inspector, and table.
- The channel page renders one viewer-coverage notice.
- No fake thumbnails, client Pulse ranking, or implied rendered clips.
- Motion passes `prefers-reduced-motion` and never runs solely because stale data was first loaded.
- Hub desktop and mobile Playwright checks cover quiet, stale, fresh-event, degraded, and empty states.

## Inspiration translated, not copied

- **OpenRouter Rankings:** separate popularity over time from the ranked leaderboard. For StreamPulse, the chart shows network movement while Hottest live is the current ranked list.
- **Artificial Analysis:** provide explicit metric lenses and comparison modes instead of repeating a composite rank. For StreamPulse, use chat, emote, viewer, breadth, and quality lenses plus a chat-vs-emote quadrant.
- **TradingView:** distinguish chart, screener, movers, heatmap, and news flow. Each is a different analysis job. For StreamPulse, chart, channel screener, Hottest live, Emote Market, and live annotations should likewise remain distinct.

## Primary implementation surfaces

- [AnalyticsLandingPage.tsx](../../streampulse-web/src/routes/analytics/AnalyticsLandingPage.tsx)
- [HubLiveWireFeed.tsx](../../streampulse-web/src/ui/components/analytics/HubLiveWireFeed.tsx)
- [FigmaGlobalActivityPanel.tsx](../../streampulse-web/src/ui/components/analytics/FigmaGlobalActivityPanel.tsx)
- [PulseMomentsLivePanel.tsx](../../streampulse-web/src/ui/components/analytics/PulseMomentsLivePanel.tsx)
- [FigmaLiveChannelRail.tsx](../../streampulse-web/src/ui/components/analytics/FigmaLiveChannelRail.tsx)
- [AnalyticsConsole.tsx](../../../streampulse-backend/packages/analytics-console/src/components/AnalyticsConsole.tsx)
- [StreamRecapPanel.tsx](../../../streampulse-backend/packages/analytics-console/src/components/analytics/StreamRecapPanel.tsx)
- [SelectedMomentPanel.tsx](../../../streampulse-backend/packages/analytics-console/src/components/analytics/SelectedMomentPanel.tsx)

This audit proposes product and contract changes only. It does not authorize exposing raw chat, adding client-side Pulse scoring, or creating a public clips surface without backend support.