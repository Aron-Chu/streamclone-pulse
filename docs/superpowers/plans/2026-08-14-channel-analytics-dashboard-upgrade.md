# StreamPulse Channel Analytics Dashboard — Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the public channel-analytics dashboard (`/analytics/{login}/{streamId}`) from a read-only chart+table MVP into a production-grade full-stream analysis surface — with accurate date/session resolution, honest per-signal coverage + quality, sync/backfill CTAs, recap + game segments + heatmap layers, and QOL affordances (clip-to-ReplayForge, copy deep link, export) — reusing the existing `@streampulse/analytics-console` primitives where possible.

**Architecture:** The curated dashboard (`FigmaChannelDashboard`) already has a strong data layer (`useChannelPageData` → `fetchPortalSessionViewModel` + `fetchPortalStreamSummary` + `fetchPortalStreamRecap`). This plan adds (1) **date→session resolution** in `useChannelPageData` so `/analytics/:login/:date` resolves to the session whose `startedAt` matches, (2) a **per-signal coverage + quality strip** from summary/coverage-truth, (3) **sync/backfill CTA actions** reusing the console's action handlers, (4) **recap + game segments + heatmap sections** layered onto the dashboard, and (5) **QOL affordances** (clip to ReplayForge via existing `clipCandidates` lib, copy deep link, CSV export). Design tokens/classes come from the existing `figma-analytics.css`; all new sections follow the established `.figma-panel` pattern.

**Tech Stack:** React 18 + TypeScript, react-router-dom v6, Vite 8 (portal at `127.0.0.1:5174`), `@streampulse/analytics-console` (chart/bucket primitives, sync actions, game segments), `@streampulse/pulse-charts` (smooth paths, bucket rendering), hosted backend `https://api.streampulse.stream` (portal BFF `/v1/portal/analytics/*`).

---

## Global Constraints

- **One UI stack per surface.** Do not add a second analytics mount. Run `cd streampulse-web && npm run check:analytics-overlap` before deploy. This is enforced by `.cursor/rules/analytics-no-duplicate-stack.mdc`.
- **Portal analytics must be sanitized server-side** (`/v1/portal/analytics/*`). Never strip in client-only code.
- **Do not require Twitch OAuth for MVP.** Public `/analytics` is no-login. Bookmarks (`/v1/pulse/clips`, candidate queue) require a beta key — gate clip-queue UI behind `portalBookmarksSupported()` (already in `streamcloneAnalytics.ts:219`).
- **Reuse `@streampulse/analytics-console` primitives** (`AnalyticsConsole`, sync actions, game segments) rather than reimplementing. Do not duplicate its scoring engine.
- **Do not make the default live poll `?window=full`.** Full-timeline fetches are only OK on explicit navigation to a channel session (`SS9`).
- **Use backend peaks/coverage/sync/backfill states as source of truth.** Never invent client-side quality.
- **No secrets / host IPs.** Keep everything in `streamclone-pulse` public.
- **Commit policy:** Aron-Chu only — no `Co-authored-by:` trailers. Follow `docs/website-portal/release-commit-slices.md` if committing.
- **Verify with the existing e2e patterns** (`npm run test:e2e:audit` local-only; do not add to GitHub Actions). Playwright uses Chrome via `RF_E2E_BROWSER=chrome`.
- **Current branch:** `track-b/hub-ux-hygiene` (main `streamclone-pulse` checkout). Portal dev server: `cd streampulse-web && npm run dev` → `127.0.0.1:5174`. Must run `npm run check:package-cohort` before start (runbook).

---
---

## Deep Audit — Current State (verified 2026-08-14)

### Data flow (read this first)

```
URL /analytics/:login/:streamId   (streamId may be a real id OR an ISO date like 2026-08-14)
  → ChannelAnalyticsPage (src/routes/analytics/ChannelAnalyticsPage.tsx) — ?console=1 switch
  → FigmaChannelView (default) — src/routes/analytics/FigmaChannelView.tsx
  → useChannelPageData(login, streamId) — src/hooks/useChannelPageData.ts:72
      1. GET /v1/portal/analytics/channels/{login}/streams?limit=24  (portalChannelStreamsPath)
      2. preferred = exact streamId match → live stream → streams[0]
      3. Promise.all: fetchPortalSessionViewModel(preferred) + fetchPortalStreamSummary(preferred) + fetchPortalStreamRecap(preferred)
  → FigmaChannelDashboard (src/ui/components/analytics/FigmaChannelDashboard.tsx)
```

### Current dashboard sections (all `figma-analytics.css`)

| Section | Component | File | Notes |
|---|---|---|---|
| Session strip (tabs) | inline in `FigmaChannelDashboard` | `FigmaChannelDashboard.tsx:242-260` | `role="tablist"`, links per session |
| Header strip (stats) | `FigmaSessionHeaderStrip` | `FigmaSessionHeaderStrip.tsx` | viewers / chat-per-min / 7TV-per-min / peaks / VOD-conf; **Export button is `disabled`**; "vod synced" hardcoded |
| Multi-signal chart | `FigmaSignalChart` | `FigmaSignalChart.tsx` | chat/viewers/emotes normalized 0-100, zoom/pan, keyboard; **viewers lane is 0 when no samples** |
| Metrics panel | `SessionMetricsPanel` | `FigmaChannelDashboard.tsx:33-64` | reaction score, 7TV share, momentum, minutes-with-data, viewer samples, sync state |
| Coverage truth | `CoverageTruthPanel` | `CoverageTruthPanel.tsx` | **almost always empty** ("featured session only") |
| Most-reacted minutes | `MostReactedMinutesTable` | `MostReactedMinutesTable.tsx` | table + selection |
| Moment inspector | `FigmaMomentInspector` | `FigmaMomentInspector.tsx` | VOD jump, top emote, KPIs |
| Top emote bursts / Top emotes | `TopEmoteBurstsPanel` / inline | `TopEmoteBurstsPanel.tsx` / `FigmaChannelDashboard.tsx:66-90` | |

### Known gaps (the "worry" — verified in code + live API)

1. **Date-in-URL is a lie.** `/analytics/ohnepixel/2026-08-14` treats the date as a `streamId`, finds no exact match, and falls back to **live/first session** (`useChannelPageData.ts:107-110`). The URL promises a date but shows whatever is most recent. **Fix: resolve date → sessionId by matching `startedAt`'s date part; highlight the URL-matched session; show an honest "no session on this date — showing most recent" notice.**
2. **Coverage is invisible.** Live streams show `viewerSamples: 1` (near-zero viewer rollups); chat coverage may be partial. Only "minutes with data" appears in the header. **Fix: per-signal coverage strip (Chat / Viewers / Emotes / VOD) with % and gap marking.**
3. **No quality score.** Requirements SS5/AQ1/AQ2 define Good/Partial/Limited/No-data with per-signal reasons; not implemented on the dashboard. Backend already returns `analyticsQuality` on stream detail + summary (`streamcloneAnalytics.ts:106,142`).
4. **No sync/backfill CTAs on the dashboard.** "Upgrade this stream", "Load missed moments", "Refresh viewer chart" exist in requirements §10.7 + console (`enableSyncActions`), not on curated view.
5. **Recap is fetched but not surfaced as a section.** `fetchPortalStreamRecap` is called, but `FigmaChannelDashboard` only uses `topEmotes`. Recap has `topMoments`, `biggestChatSpike`, `funniestEmoteBurst`, `clipCandidates` (`streamcloneAnalytics.ts:158-182`).
6. **No game segments** (SS4). `AnalyticsConsole` has `showGameSegments`; `FigmaChannelDashboard` doesn't.
7. **No heatmap** (SS1). `fetchReplayHeatmapDetail` exists (`figmaSessionAnalytics.ts:559`) but unused.
8. **Export is a dead button.** `FigmaSessionHeaderStrip.tsx:70-72` renders `<button disabled>Export</button>`.
9. **`7TV / min` vs `Emotes / min` inconsistency** across header/metrics/inspector.
10. **Accessibility nits:** session strip tabs aren't arrow-key managed; chart is decent (role=img + keyboard + aria-live).

### Reusable assets (do NOT reimplement)

- `@streampulse/analytics-console` (`/mnt/c/Users/Aron/streampulse-backend/packages/analytics-console`): `AnalyticsConsole` with props `showGameSegments` (default true), `enableSyncActions` (default false). Console view already wires these: `ConsoleChannelView.tsx:42-48` — `showGameSegments` on, `enableSyncActions={usesLocalAnalyticsBackend()}`. **For curated view we want sync actions on the hosted API too** (per requirements), so call the console's sync action handler directly (see Task 4).
- `@streampulse/pulse-charts`: `monotoneCubicPath` (used by `FigmaSignalChart`), bucket rendering.
- `src/lib/clipCandidates.ts`: `sendClipCandidateToReplayForge(id)` → `POST /v1/pulse/clips/{id}/replayforge`, `clipCandidateCanQueueReplayForge(candidate)`. **Requires beta key** (`portalBookmarksSupported()`).
- `src/lib/streamcloneAnalytics.ts`: `fetchPortalStreamSummary` (1122), `fetchPortalStreamRecap` (1139), `formatStreamOffset` (1149), `deriveClientGameSegments` (238), `PortalStreamRecapResponse` incl. `clipCandidates` (158-182).
- `src/lib/figmaSessionAnalytics.ts`: `fetchPortalStreamMinutes`, `chartPointsFromMinutes` (465), `fetchPortalStreamPeaks` (537), `fetchPortalStreamCoverageTruth` (547), `fetchReplayHeatmapDetail` (559), `fetchPortalSessionViewModel` (572), `buildVodTimestampUrl`, `formatOffsetLabel`, `sourceLabelFromDetail` (515).
- `src/lib/analyticsLinks.ts`: `buildAnalyticsHref` (10), `analyticsActionLabel` (23).
- `src/lib/pulseMomentsUtils.ts`: `resolveMomentEmote`, `momentHasEmoteRollups`, `vodStateLabel`, `momentWallClockLabel`, `formatMomentViewersLabel`, `formatChatRate`, `formatReactionScore` (in `momentMetricLabels.ts`).
- `src/ui/components/analytics/hubFormat.ts`: `compact`, `initial`.
- CSS: `figma-analytics.css` (dashboard), `analytics-console.css` (console, if reusing console subcomponents), `analytics-hub-home.css`.
- Existing `e2e` + unit test patterns (see Task 7 / Global Constraints).

### Backend endpoints (portal BFF — hosted, no auth)

All under `https://api.streampulse.stream/v1/portal/analytics`. (Verified live 2026-08-14 for ohnepixel; field names from code.)

| Endpoint | Response highlights |
|---|---|
| `GET /channels/{login}/streams?limit=24` | `items[]: {streamId, login, displayName, title, category, categoryId, gamesSummary, startedAt, endedAt, currentViewers, peakViewers, viewerSamples, chatMessages, vodId}` |
| `GET /streams/{streamId}/minutes` | `{streamId, startedAt, coverageStartOffsetSeconds, minutes[]: {offsetSeconds, viewerAvg, viewerMax, viewerLatest, viewerSamples, chatCount, totalEmoteCount, seventvEmoteCount, missing, topEmotes[]}, signalWatermarks}` |
| `GET /streams/{streamId}/peaks` | `{streamId, login, peaks[]: {offsetSeconds, score, reasons[], reasonLabel, dominantSignal, chatCount, emoteCount, vodState, topEmotes[]}}` |
| `GET /streams/{streamId}/coverage-truth` | `{dataCoveragePct, vodId, rows[]}` |
| `GET /streams/{streamId}/summary` | `{streamId, metrics: {chat_per_min, emotes_per_min, seventv_per_min, provider_share_pct, reaction_score_0_100, viewer_momentum_5m, data_coverage_pct, sync_health_state, minutesWithData, viewerSampleCount}, topEmotes[], analyticsQuality}` |
| `GET /streams/{streamId}/recap` | `{streamId, login, vodId, durationSeconds, totalMessages, peakChatPerMin, topMoments[], topEmotes[], biggestChatSpike, funniestEmoteBurst, clipCandidates[]}` |
| `GET /streams/{streamId}/replay-heatmap?window=60&detail=true` | heatmap lanes (chat/7TV/viewers) + buckets |
| `GET /streams/{streamId}/games` | game segments |
| `POST /v1/analytics/streams/{streamID}/sync` | "Upgrade this stream" full sync (chat+emotes+rollups). **NOT under `/v1/portal`** — the portal tree only exposes read-only `sync/status`. Query params: `channel`, `viewers_only`, `mode`, `force_chat`, `vod_id`. |
| `POST /v1/analytics/streams/{streamID}/prefetch-tracker` | "Refresh viewer chart" — requires `channel` query param. NOT under `/v1/portal`. |
| `POST /v1/extension/pulse/channels/{login}/backfill` | "Load missed moments" backfill job — **requires pulse-write + extension principal + rate limit**; 503 `pulse_backfill_disabled` / 429 `backfill_at_capacity` (Retry-After: 45). Body: `{streamId (req), vodId, mode}`. |
| `GET /v1/analytics/streams/{streamID}/sync/status` | raw `SyncStatus` (full object — phases `starting/scraping_tracker/parsing_tracker/resolving_vod/fetching_comments/writing_rollups/exporting_archive/export_pending/completed/failed`) |
| `GET /v1/portal/analytics/streams/{streamID}/sync/status` | portal's **sanitized 4-field** projection (`phase`, `message`, `updatedAt`, `stale`) — this is the one the dashboard should poll. |

> **⚠ Auth caveat for sync CTAs (verify before Task 3):** `/v1/analytics/*` (sync/prefetch) and `/v1/extension/*` (backfill) are **not** currently called by the hosted portal — `streamcloneAnalytics.ts` routes everything through `/v1/portal/analytics/*` on hosted, and the console only enables sync actions for a **local** backend (`usesLocalAnalyticsBackend()`). The portal is public no-login; firing `POST /v1/analytics/streams/{id}/sync` for arbitrary channels may be auth/principal-gated or violate the "no public unauthenticated collector admission" guardrail. **Task 3 must first probe the hosted endpoints** (curl a POST) to learn the auth posture; if gated, gate the CTAs behind `hasBetaKey()` (like clip queue) with an honest "available with beta access" fallback, and/or flag a backend wrapper as a prerequisite for a separate backend plan. Do not ship a button that fires a 401.

> **Note to implementer:** The three audit agents' reports (backend endpoints, e2e test inventory, QOL/clip affordances) are appended in the **Appendix** below. If a response shape differs from the table above, **trust the live response / code** — the appendix is the ground truth. The summary/recap field names above match `streamcloneAnalytics.ts` exactly.

---

## File Structure (new/modified)

- Modify: `streampulse-web/src/hooks/useChannelPageData.ts` — date→session resolution, expose `resolvedDateNotice`, `channelQuality`, `signalCoverage`, `syncActions`.
- Modify: `streampulse-web/src/routes/analytics/FigmaChannelView.tsx` — pass new props to dashboard; render date notice.
- Modify: `streampulse-web/src/ui/components/analytics/FigmaChannelDashboard.tsx` — new sections (quality strip, sync CTAs, recap, games, heatmap, export).
- Modify: `streampulse-web/src/ui/components/analytics/FigmaSessionHeaderStrip.tsx` — wire Export (CSV), fix "vod synced", unify emote metric label.
- Modify: `streampulse-web/src/ui/components/analytics/FigmaSignalChart.tsx` — gap rendering for missing minutes; raw-vs-normalized toggle.
- Modify: `streampulse-web/src/ui/components/analytics/figma-analytics.css` — styles for new sections.
- Modify: `streampulse-web/src/lib/streamcloneAnalytics.ts` — export a `syncStreamActions(streamId, login)` helper (wraps POST sync/backfill/prefetch) if not already exported.
- New: `streampulse-web/src/ui/components/analytics/ChannelQualityStrip.tsx` — per-signal quality + coverage.
- New: `streampulse-web/src/ui/components/analytics/SessionSyncActions.tsx` — "Upgrade this stream" / "Load missed moments" / "Refresh viewer chart" CTAs.
- New: `streampulse-web/src/ui/components/analytics/StreamRecapSection.tsx` — recap (top moments, biggest spike, funniest burst, clip candidates).
- New: `streampulse-web/src/ui/components/analytics/SessionGameSegments.tsx` — game/category segments from `/games` (with `deriveClientGameSegments` fallback).
- New: `streampulse-web/src/ui/components/analytics/SessionHeatmap.tsx` — compact full-stream heatmap from `/replay-heatmap`.
- New: `streampulse-web/src/lib/channelQuality.ts` — pure helpers: `signalCoverageFromMinutes`, `qualityLabelFromFields`, `perSignalQuality`.
- New: `streampulse-web/src/lib/sessionCsv.ts` — CSV serialization for minutes + moments + emotes.
- New: `streampulse-web/src/lib/sessionDateResolution.ts` — date-matching + notice builder (pure, unit-testable).
- New (tests): `streampulse-web/src/lib/__tests__/sessionDateResolution.test.ts`, `channelQuality.test.ts`, `sessionCsv.test.ts`.
- New (tests): `streampulse-web/src/ui/components/analytics/__tests__/ChannelQualityStrip.test.tsx` (vitest + RTL if the repo uses it; else component test in the e2e file).

> **Existing test conventions:** check the Appendix "e2e test inventory". Portal unit tests may use vitest; e2e uses Playwright with route interception (see Task 7). Match the repo's existing convention — do not invent a new framework.

---

## Task Decomposition

Each task is independently testable and carries its own test cycle. Tasks 1-3 are foundation (pure lib + hook) and can be **done in parallel** once the branch is ready; Tasks 4-6 build UI on top; Task 7 is verification/QA. **Do not merge tasks 4-6 before 1-3 land** (they depend on the new hook fields).

---

### Task 1: Date → session resolution + honest date notice

**Files:**
- Create: `streampulse-web/src/lib/sessionDateResolution.ts`
- Test: `streampulse-web/src/lib/__tests__/sessionDateResolution.test.ts`
- Modify: `streampulse-web/src/hooks/useChannelPageData.ts` (add `resolvedDateNotice` to `ChannelPageData`, compute preferred session via date match)

**Interfaces:**
- Consumes: `ChannelStreamItem` shape from `useChannelPageData.ts` (`{streamId, startedAt, endedAt, ...}`), `FigmaSessionStripItem` (`{streamId, label, startedAt, endedAt, live, ...}`).
- Produces:
  - `export function isDateParam(value: string): boolean` — true iff value matches `/^\d{4}-\d{2}-\d{2}$/`.
  - `export function dateForStartedAt(iso: string): string` — returns `YYYY-MM-DD` in **UTC** (not local — the URL uses UTC dates; don't shift timezones). E.g. `dateForStartedAt('2026-08-14T14:54:54Z') === '2026-08-14'`.
  - `export function matchStreamIdByDate(items: Array<{streamId: string; startedAt?: string | null}>, date: string): string | undefined` — returns the streamId whose `startedAt` UTC date equals `date`; prefers a **live** (no `endedAt`) match, else the first ended match; `undefined` if none.
  - `export function dateNotice(matched: boolean, date: string): {kind: 'matched' | 'fallback' | 'no_sessions'; message: string} | null` — `matched` → null; `fallback` → `"No tracked session started on {date}. Showing the most recent session instead."`; `no_sessions` → `"No tracked sessions for this channel yet."`

- [ ] **Step 1: Write the failing test**

`streampulse-web/src/lib/__tests__/sessionDateResolution.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isDateParam, dateForStartedAt, matchStreamIdByDate, dateNotice } from '../sessionDateResolution'

describe('sessionDateResolution', () => {
  it('isDateParam', () => {
    expect(isDateParam('2026-08-14')).toBe(true)
    expect(isDateParam('317482878564')).toBe(false)
    expect(isDateParam('2026-8-14')).toBe(false)
    expect(isDateParam('')).toBe(false)
  })

  it('dateForStartedAt is UTC and stable', () => {
    expect(dateForStartedAt('2026-08-14T14:54:54Z')).toBe('2026-08-14')
    expect(dateForStartedAt('2026-08-14T23:59:59Z')).toBe('2026-08-14')
    expect(dateForStartedAt('2026-08-14T00:00:01Z')).toBe('2026-08-14')
    expect(dateForStartedAt('')).toBe('')
  })

  it('matchStreamIdByDate prefers live, falls back to ended', () => {
    const items = [
      { streamId: 'a', startedAt: '2026-08-13T10:00:00Z', endedAt: '2026-08-13T20:00:00Z' },
      { streamId: 'b', startedAt: '2026-08-14T09:00:00Z', endedAt: null },
      { streamId: 'c', startedAt: '2026-08-14T15:00:00Z', endedAt: '2026-08-14T23:00:00Z' },
    ]
    expect(matchStreamIdByDate(items, '2026-08-14')).toBe('b') // live wins
    expect(matchStreamIdByDate(items, '2026-08-13')).toBe('a')
    expect(matchStreamIdByDate(items, '2026-08-15')).toBe(undefined)
    expect(matchStreamIdByDate([], '2026-08-14')).toBe(undefined)
  })

  it('dateNotice', () => {
    expect(dateNotice(true, '2026-08-14')).toBeNull()
    expect(dateNotice(false, '2026-08-14')?.kind).toBe('fallback')
    expect(dateNotice(false, '2026-08-14')?.message).toContain('2026-08-14')
    expect(dateNotice(false, '2026-08-14')?.message).toContain('most recent')
    expect(dateNotice(false, '2026-08-14')?.kind).toBe('fallback')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd streampulse-web && npx vitest run src/lib/__tests__/sessionDateResolution.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`streampulse-web/src/lib/sessionDateResolution.ts`:

```ts
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isDateParam(value: string): boolean {
  return DATE_RE.test(value)
}

export function dateForStartedAt(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10) // UTC date
}

interface DateMatchItem {
  streamId: string
  startedAt?: string | null
  endedAt?: string | null
}

export function matchStreamIdByDate(items: DateMatchItem[], date: string): string | undefined {
  const onDate = items.filter((item) => item.startedAt && dateForStartedAt(item.startedAt) === date)
  if (onDate.length === 0) return undefined
  return onDate.find((item) => !item.endedAt)?.streamId ?? onDate[0].streamId
}

export function dateNotice(
  matched: boolean,
  date: string,
): { kind: 'matched' | 'fallback' | 'no_sessions'; message: string } | null {
  if (matched) return null
  return {
    kind: 'fallback',
    message: `No tracked session started on ${date}. Showing the most recent session instead.`,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd streampulse-web && npx vitest run src/lib/__tests__/sessionDateResolution.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Wire into `useChannelPageData.ts`**

In `useChannelPageData.ts`:
- Import `isDateParam, dateForStartedAt, matchStreamIdByDate, dateNotice` from `../lib/sessionDateResolution`.
- After building `strip`, compute the preferred session:

```ts
const requestedIsDate = Boolean(streamIdParam && isDateParam(streamIdParam))
const requestedDate = requestedIsDate ? dateForStartedAt(streamIdParam as string) : ''
const dateMatchedId = requestedDate ? matchStreamIdByDate(data.items ?? [], requestedDate) : undefined
const preferred =
  (streamIdParam && !requestedIsDate && strip.find((s) => s.streamId === streamIdParam)?.streamId) ||
  dateMatchedId ||
  strip.find((s) => s.live)?.streamId ||
  strip[0]?.streamId
```

- Add to `ChannelPageData` interface + return value: `resolvedDateNotice: ReturnType<typeof dateNotice> | null` — computed as `requestedIsDate ? dateNotice(Boolean(dateMatchedId), requestedDate) : null`. (When the date matched, the notice is null; when no date requested, null.)
- When `dateMatchedId` is set and differs from `streamIdParam`, the strip should highlight the matched session (the existing `active` check uses `item.streamId === data.selectedStreamId`, and `selectedStreamId` is now `dateMatchedId` — so it just works). Keep `streamIdParam` in the URL untouched (no redirect needed; the dashboard shows the resolved session and the notice explains).

- [ ] **Step 6: Update `FigmaChannelView.tsx` to render the notice**

In `FigmaChannelView.tsx`, inside the `ChannelHubStatusShell`, render above the dashboard:

```tsx
{channelData.resolvedDateNotice ? (
  <div className="figma-channel-date-notice" role="note">
    {channelData.resolvedDateNotice.message}
  </div>
) : null}
```

- [ ] **Step 7: Style the notice in `figma-analytics.css`**

```css
.figma-channel-date-notice {
  margin: 0.5rem 0 0.25rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--fma-border, rgba(255,255,255,0.12));
  border-radius: 8px;
  background: var(--fma-surface-2, rgba(255,255,255,0.04));
  color: var(--fma-muted, rgba(255,255,255,0.7));
  font-size: 0.875rem;
}
```

- [ ] **Step 8: Run full unit test file + typecheck**

Run: `cd streampulse-web && npx vitest run src/lib/__tests__/sessionDateResolution.test.ts && npm run typecheck`
Expected: tests pass, typecheck clean.

- [ ] **Step 9: Manual verification (dev server)**

With `npm run dev` up on `127.0.0.1:5174`:
- `http://127.0.0.1:5174/analytics/ohnepixel/2026-08-14` → shows the **live 08-14 session** (the strip highlights the live session), no notice (matched).
- `http://127.0.0.1:5174/analytics/ohnepixel/2026-08-12` → shows the **08-12 VOD session**, strip highlights it, no notice.
- `http://127.0.0.1:5174/analytics/ohnepixel/2026-01-01` → falls back to most recent session, **notice shown** with the fallback copy.
- `http://127.0.0.1:5174/analytics/ohnepixel/317482878564` → still works (real streamId).

- [ ] **Step 10: Commit**

```bash
cd /mnt/c/Users/Aron/streamclone-pulse
git add streampulse-web/src/lib/sessionDateResolution.ts streampulse-web/src/lib/__tests__/sessionDateResolution.test.ts streampulse-web/src/hooks/useChannelPageData.ts streampulse-web/src/routes/analytics/FigmaChannelView.tsx streampulse-web/src/ui/components/analytics/figma-analytics.css
git commit -m "fix(analytics): resolve date URLs to sessions with honest fallback notice"
```

---

### Task 2: Per-signal coverage + quality strip (pure lib + component)

**Files:**
- Create: `streampulse-web/src/lib/channelQuality.ts`
- Test: `streampulse-web/src/lib/__tests__/channelQuality.test.ts`
- Create: `streampulse-web/src/ui/components/analytics/ChannelQualityStrip.tsx`
- Modify: `streampulse-web/src/ui/components/analytics/FigmaChannelDashboard.tsx` (render strip in grid col 1, above metrics)

**Interfaces:**
- Consumes: `PortalStreamSummary` (`streamcloneAnalytics.ts:136`), `PortalStreamSummaryMetrics` (`:145`), `PortalStreamMinutesResponse['minutes']` with `missing` flags, `FigmaSessionViewModel.coverageTruth` (rows `{label, value, ok}`).
- Produces:
  - `export type SignalCoverage = { signal: 'chat' | 'viewers' | 'emotes' | 'vod'; label: string; pct: number | null; ok: boolean; reason?: string }`
  - `export function signalCoverageFromSummary(summary: PortalStreamSummary | null): SignalCoverage[]` — chat% from `metrics.data_coverage_pct` (or chat-minutes / total-minutes), viewers% from `metrics.viewerSampleCount` vs minutes, emotes% from `metrics.seventv_per_min` > 0 or topEmotes presence, vod% from recap.vodId presence. When a metric is absent → `pct: null, ok: false, reason: 'No data'`. Never invent a number.
  - `export function qualityLabelFromFields(fields: { chat?: boolean; viewers?: boolean; emotes?: boolean; vod?: boolean }): 'Good' | 'Partial' | 'Limited' | 'No data'` — Good if all true; Partial if ≥2 true; Limited if 1 true; No data if none.
  - `export function perSignalQuality(summary, minutes): { label: string; signals: SignalCoverage[] }`

- [ ] **Step 1: Write the failing test**

`streampulse-web/src/lib/__tests__/channelQuality.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { qualityLabelFromFields, signalCoverageFromSummary } from '../channelQuality'

const summary = (metrics: Record<string, number | string | undefined> | null) => ({
  channel: 'ohnepixel',
  metrics: metrics as any,
  topEmotes: metrics && metrics.seventv_per_min ? [{ name: 'LUL', provider: 'twitch', count: 10 }] : [],
  updatedAt: 0,
})

describe('channelQuality', () => {
  it('qualityLabelFromFields', () => {
    expect(qualityLabelFromFields({ chat: true, viewers: true, emotes: true, vod: true })).toBe('Good')
    expect(qualityLabelFromFields({ chat: true, viewers: false, emotes: true, vod: false })).toBe('Partial')
    expect(qualityLabelFromFields({ chat: true, viewers: false, emotes: false, vod: false })).toBe('Limited')
    expect(qualityLabelFromFields({ chat: false, viewers: false, emotes: false, vod: false })).toBe('No data')
  })

  it('signalCoverageFromSummary never invents numbers', () => {
    const cov = signalCoverageFromSummary(null)
    expect(cov.every((c) => c.pct === null)).toBe(true)
    expect(cov.some((c) => c.label === 'Chat' && !c.ok)).toBe(true)
  })

  it('signalCoverageFromSummary uses real fields', () => {
    const cov = signalCoverageFromSummary(summary({ data_coverage_pct: 82, viewerSampleCount: 500 }))
    const chat = cov.find((c) => c.signal === 'chat')!
    expect(chat.pct).toBe(82)
    expect(chat.ok).toBe(true)
    const viewers = cov.find((c) => c.signal === 'viewers')!
    expect(viewers.pct).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd streampulse-web && npx vitest run src/lib/__tests__/channelQuality.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`streampulse-web/src/lib/channelQuality.ts`:

```ts
import type { PortalStreamSummary } from './streamcloneAnalytics'

export interface SignalCoverage {
  signal: 'chat' | 'viewers' | 'emotes' | 'vod'
  label: string
  pct: number | null
  ok: boolean
  reason?: string
}

const none = (signal: SignalCoverage['signal'], label: string): SignalCoverage => ({
  signal, label, pct: null, ok: false, reason: 'No data',
})

export function signalCoverageFromSummary(summary: PortalStreamSummary | null): SignalCoverage[] {
  const m = summary?.metrics
  const chatPct = m?.data_coverage_pct != null ? m.data_coverage_pct : null
  const chat: SignalCoverage = chatPct != null
    ? { signal: 'chat', label: 'Chat', pct: chatPct, ok: chatPct >= 50 }
    : none('chat', 'Chat')
  const viewerSamples = m?.viewerSampleCount ?? 0
  const viewers: SignalCoverage = viewerSamples > 0
    ? { signal: 'viewers', label: 'Viewers', pct: null, ok: true, reason: `${viewerSamples} samples` }
    : none('viewers', 'Viewers')
  const hasEmotes = (summary?.topEmotes?.length ?? 0) > 0 || (m?.seventv_per_min ?? 0) > 0
  const emotes: SignalCoverage = hasEmotes
    ? { signal: 'emotes', label: 'Emotes', pct: m?.seventv_per_min != null ? Math.min(100, m.seventv_per_min) : null, ok: true }
    : none('emotes', 'Emotes')
  // VOD: summary doesn't carry vodId; signalCoverageFromSummary accepts null and reports No data.
  return [chat, viewers, emotes, none('vod', 'VOD')]
}

export function qualityLabelFromFields(fields: { chat?: boolean; viewers?: boolean; emotes?: boolean; vod?: boolean }): 'Good' | 'Partial' | 'Limited' | 'No data' {
  const signals = [fields.chat, fields.viewers, fields.emotes, fields.vod]
  const ok = signals.filter(Boolean).length
  if (ok === signals.length) return 'Good'
  if (ok >= 2) return 'Partial'
  if (ok === 1) return 'Limited'
  return 'No data'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd streampulse-web && npx vitest run src/lib/__tests__/channelQuality.test.ts`
Expected: PASS.

- [ ] **Step 5: Build `ChannelQualityStrip.tsx`**

Render a `.figma-panel` titled **Analytics quality** with the quality label (Good/Partial/Limited/No data — tone-coded) and a 2×2 grid of `SignalCoverage` rows (signal icon + label + pct/ok + reason tooltip). Empty/No-data shows muted "No data yet — sync a session to unlock." Use existing classes: `figma-panel`, `figma-panel--coverage`, `emote-rank-list` for list feel, `hub-openbtn` for any link. Follow `CoverageTruthPanel` structure (it's the closest pattern). New CSS (in `figma-analytics.css`): `.figma-quality__label`, `.figma-quality__grid`, `.figma-quality__row`, `.is-good/.is-partial/.is-limited/.is-none`.

- [ ] **Step 6: Wire into `FigmaChannelDashboard`**

In `FigmaChannelDashboard.tsx` grid col 1 (above `SessionMetricsPanel`), add:

```tsx
<ChannelQualityStrip signals={qualitySignals} label={qualityLabel} />
```

where `qualitySignals`/`qualityLabel` come from `signalCoverageFromSummary(data.summary)` + `qualityLabelFromFields(...)` (compute with `useMemo` on `data.summary`).

- [ ] **Step 7: Style + verify**

Add `.figma-quality__*` styles. Run `npx vitest run src/lib/__tests__/channelQuality.test.ts` + `npm run typecheck`. Manual: with dev server, `/analytics/ohnepixel/317482878564` (live) → quality strip shows chat+emotes ok, viewers "1 sample"/partial, VOD "No data". `/analytics/ohnepixel/317442904418` (08-12 VOD, 245k chat) → Good-ish.

- [ ] **Step 8: Commit**

```bash
git add streampulse-web/src/lib/channelQuality.ts streampulse-web/src/lib/__tests__/channelQuality.test.ts streampulse-web/src/ui/components/analytics/ChannelQualityStrip.tsx streampulse-web/src/ui/components/analytics/FigmaChannelDashboard.tsx streampulse-web/src/ui/components/analytics/figma-analytics.css
git commit -m "feat(analytics): per-signal coverage + analytics quality strip"
```

---

### Task 3: Sync / backfill CTA actions

**Files:**
- Modify: `streampulse-web/src/lib/streamcloneAnalytics.ts` — export `syncStreamActions(streamId, login)` helper (or a `syncActionHandlers` object) if not already exported by the console.
- Create: `streampulse-web/src/ui/components/analytics/SessionSyncActions.tsx`
- Modify: `streampulse-web/src/ui/components/analytics/FigmaChannelDashboard.tsx` (render CTAs under the quality strip)

**Interfaces:**
- Consumes: `selectedStreamId`, `login` from `ChannelPageData`; backend `POST /v1/portal/analytics/streams/{streamId}/sync`, `POST /v1/portal/analytics/streams/{streamId}/prefetch-tracker`, `POST /v1/extension/pulse/channels/{login}/backfill`.
- Produces:
  - `export function syncStreamActions(streamId: string, login: string): { upgrade: () => Promise<{ok: boolean; message: string}>; refreshViewers: () => Promise<{ok: boolean; message: string}>; loadMissedMoments: () => Promise<{ok: boolean; message: string}> }` — each POSTs the corresponding endpoint via `apiClient`, returns `{ok, message}`. If `!streamId.trim()` or `!login.trim()` → `{ok: false, message: 'Missing session'}`. All failures → `{ok: false, message: 'Request failed'}` (never leak raw errors).

- [ ] **Step 0 (new): Probe hosted auth posture for sync endpoints**

Before writing code, curl the hosted endpoints from the portal's origin to learn whether they're reachable from a public no-login page:

```bash
curl -i -X POST "https://api.streampulse.stream/v1/analytics/streams/317482878564/sync?channel=ohnepixel" | head -20
curl -i -X POST "https://api.streampulse.stream/v1/analytics/streams/317482878564/prefetch-tracker?channel=ohnepixel" | head -20
```

Record the status codes (401/403 → principal-gated; 404 → not mounted; 202/200 → open). **Adjust the plan's Task 3 approach based on this:**
- If 202/200 (open): proceed with `syncStreamActions` calling the `/v1/analytics/*` paths directly.
- If 401/403 (gated, expected): implement the CTAs as **beta-gated** — render them only when `hasBetaKey()`, with a muted "Available with StreamPulse beta access" fallback when unsupported, and note in the commit/PR that a portal wrapper endpoint is a backend prerequisite. Do not fire a request that 401s.

- [ ] **Step 1: Write the failing test**

`streampulse-web/src/lib/__tests__/syncStreamActions.test.ts` (mock `apiClient`):

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../apiClient', () => ({ apiClient: vi.fn() }))
import { apiClient } from '../../apiClient'
import { syncStreamActions } from '../streamcloneAnalytics'

describe('syncStreamActions', () => {
  it('upgrade POSTs /streams/{id}/sync', async () => {
    (apiClient as any).mockResolvedValue({ data: { phase: 'syncing' } })
    const res = await syncStreamActions('s1', 'ohnepixel').upgrade()
    expect(apiClient).toHaveBeenCalledWith(expect.stringContaining('/v1/portal/analytics/streams/s1/sync'), expect.any(Object))
    expect(res.ok).toBe(true)
  })
  it('refreshViewers POSTs /prefetch-tracker', async () => {
    (apiClient as any).mockResolvedValue({ data: {} })
    await syncStreamActions('s1', 'ohnepixel').refreshViewers()
    expect(apiClient).toHaveBeenCalledWith(expect.stringContaining('/prefetch-tracker'), expect.any(Object))
  })
  it('loadMissedMoments POSTs backfill', async () => {
    (apiClient as any).mockResolvedValue({ data: { state: 'queued' } })
    await syncStreamActions('s1', 'ohnepixel').loadMissedMoments()
    expect(apiClient).toHaveBeenCalledWith(expect.stringContaining('/v1/extension/pulse/channels/ohnepixel/backfill'), expect.any(Object))
  })
  it('rejects missing ids', async () => {
    expect((await syncStreamActions('', 'ohnepixel').upgrade()).ok).toBe(false)
    expect((await syncStreamActions('s1', '').loadMissedMoments()).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd streampulse-web && npx vitest run src/lib/__tests__/syncStreamActions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `syncStreamActions` in `streamcloneAnalytics.ts`**

Add near the bottom (after `formatStreamOffset`):

```ts
export function syncStreamActions(streamId: string, login: string) {
  const base = streamId.trim()
  const channel = login.trim()
  const post = async (path: string) => {
    try {
      if (!base) return { ok: false as const, message: 'Missing session' }
      await apiClient(path, { method: 'POST' })
      return { ok: true as const, message: 'Requested' }
    } catch {
      return { ok: false as const, message: 'Request failed' }
    }
  }
  return {
    upgrade: () => post(portalPath(`/streams/${encodeURIComponent(base)}/sync`)),
    refreshViewers: () => post(portalPath(`/streams/${encodeURIComponent(base)}/prefetch-tracker`)),
    loadMissedMoments: () => {
      if (!channel) return Promise.resolve({ ok: false as const, message: 'Missing session' })
      return post(`/v1/extension/pulse/channels/${encodeURIComponent(channel)}/backfill`)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd streampulse-web && npx vitest run src/lib/__tests__/syncStreamActions.test.ts`
Expected: PASS.

- [ ] **Step 5: Build `SessionSyncActions.tsx`**

Props: `{ streamId?: string; login: string; onDone?: (message: string) => void }`. Renders a `.figma-panel` titled **Data actions** with three buttons (reuse `.figma-btn`):
- **Upgrade this stream** → `syncActions.upgrade()`, disabled while running, shows spinner + "Requested — sync running" state.
- **Load missed moments** → `syncActions.loadMissedMoments()`.
- **Refresh viewer chart** → `syncActions.refreshViewers()`.
- If `!streamId` → render nothing (no session).
- Show a one-line status under the buttons (`aria-live="polite"`) with the returned message. Use local `useState` for pending + message. Keep it honest: never claim success beyond "Requested" (the job runs async backend-side).

- [ ] **Step 6: Wire into `FigmaChannelDashboard`**

Render under the quality strip in grid col 1: `<SessionSyncActions streamId={data.selectedStreamId} login={data.login} />`.

- [ ] **Step 7: Verify + commit**

`npx vitest run src/lib/__tests__/syncStreamActions.test.ts` + `npm run typecheck`; manual click in dev. Commit with message `feat(analytics): sync/backfill CTA actions on channel dashboard`.

---

### Task 4: Stream recap section (top moments, spike, funniest burst, clip candidates)

**Files:**
- Create: `streampulse-web/src/ui/components/analytics/StreamRecapSection.tsx`
- Modify: `streampulse-web/src/ui/components/analytics/FigmaChannelDashboard.tsx` (render recap panel)

**Interfaces:**
- Consumes: `PortalStreamRecapResponse` (`streamcloneAnalytics.ts:169`) — `topMoments[] {offsetSeconds, score, reasons[], chatCount, emoteCount, viewerCount, topEmotes[]}`, `biggestChatSpike {offsetSeconds, chatPerMin}`, `funniestEmoteBurst {offsetSeconds, code, count, provider}`, `clipCandidates[]`, `totalMessages`, `peakChatPerMin`, `vodId`, `durationSeconds`; `formatStreamOffset` (`:1149`); `buildAnalyticsHref` (`analyticsLinks.ts:10`); `sendClipCandidateToReplayForge` (`clipCandidates.ts:134`); `portalBookmarksSupported` (`streamcloneAnalytics.ts:219`).
- Produces: a self-contained `.figma-panel` with:
  - Header: **Stream recap** (+ subtitle `top {n} moments · totals`).
  - Top moments list (top 5): time (`formatStreamOffset`), score, reasons joined, chat/emote counts. Each row links to the moment via `buildAnalyticsHref({login, streamId, offsetSeconds})`.
  - "Biggest chat spike" row: `{peakChatPerMin} chat/min @ {formatStreamOffset(biggestChatSpike.offsetSeconds)}`.
  - "Funniest emote burst" row: `{code} ×{count} @ {time}` (provider).
  - **Clip candidates** block (only if `clipCandidates.length > 0`): list of candidate moments, each with a **"Send to ReplayForge"** button (only when `portalBookmarksSupported()`); on click → `sendClipCandidateToReplayForge(id)` then `refreshClipCandidateReplayForgeJob(id)`; disabled while pending; show job state label via `clipCandidateCanQueueReplayForge`. When bookmarks unsupported, show a muted "Clip queue available with StreamPulse beta access." (This is the QOL/clipping affordance — see Appendix.)

- [ ] **Step 1: Write the failing test**

`streampulse-web/src/lib/__tests__/streamRecapSection.test.tsx` (RTL if repo uses it; else a pure-data test). Test the pure formatting + gating:

```ts
import { describe, expect, it } from 'vitest'
import { recapClipRows, recapSummaryRows } from '../streamRecapSection'
// recapSummaryRows(recap) → array of {key, label, value, offsetSeconds?}
// recapClipRows(recap, supported) → array of {id, label, canSend}
```

- [ ] **Step 2-4: Implement `StreamRecapSection.tsx` + tests**

Implement the pure helpers in the same file (or `streamRecapSection.ts`) and the component. Match `MostReactedMinutesTable`'s row styling. Ensure VOD jump links reuse `buildVodTimestampUrl`. Test: no recap → renders "No recap yet"; recap with clips + supported → clip rows with `canSend: true`; unsupported → `canSend: false`.

- [ ] **Step 5: Wire into dashboard**

In `FigmaChannelDashboard`, add a full-width recap panel after the chart/before the grid (or as a third grid column section). Prefer a full-width panel above the 3-col grid so the recap reads as "the story" before the details. Render only when `data.recap` has content.

- [ ] **Step 6: Verify + commit**

Manual: `/analytics/ohnepixel/317442904418` (08-12 VOD) should show recap with totalMessages ~245k, top moments, clip candidates (beta-gated). Commit `feat(analytics): stream recap section with clip-to-ReplayForge`.

---

### Task 5: Game segments + heatmap layers

**Files:**
- Create: `streampulse-web/src/ui/components/analytics/SessionGameSegments.tsx`
- Create: `streampulse-web/src/ui/components/analytics/SessionHeatmap.tsx`
- Modify: `streampulse-web/src/lib/streamcloneAnalytics.ts` — export `fetchPortalStreamGames` (uses `gamesEndpoint` pattern at `:260`) + reuse `deriveClientGameSegments` fallback.
- Modify: `streampulse-web/src/lib/figmaSessionAnalytics.ts` — reuse `fetchReplayHeatmapDetail` (`:559`).
- Modify: `streampulse-web/src/ui/components/analytics/FigmaChannelDashboard.tsx`

**Interfaces:**
- Consumes: `GameSegment[]` from `@streampulse/analytics-console`, `deriveClientGameSegments` (`streamcloneAnalytics.ts:238`), `ReplayHeatmapDetailResponse` from `figmaSessionAnalytics.ts:559`.
- Produces:
  - `export function fetchPortalStreamGames(streamId: string): Promise<GameSegment[] | null>`
  - `SessionGameSegments({ streamId, login, fallbackSegments })` — renders a horizontal segmented bar (game name + % of stream by duration) with hover tooltip; if empty → "Game segments unavailable."
  - `SessionHeatmap({ streamId, login, className })` — renders a compact full-stream heatmap. **Backend shape is a flat `points[]`** (one point per 60-s bucket: `{offsetSeconds, durationSeconds, score, reactionScore, viewerMomentumScore, confidence, reason, topEmotes[]}`) — there are **no chat/7TV/viewer lanes** in the response. `window` must be exactly `60` (any other value → 400 `unsupported_window`). So render one lane (intensity of `score`/`reactionScore` per bucket), with optional lane split by `reason` category — do NOT assume 3 lane types exist. `detail=true` adds `components` per point if you want per-signal weighting; prefer compact `detail=false` for the strip. Reuse `fetchReplayHeatmapDetail(streamId, 60)`; if empty → nothing (don't render an empty heatmap panel).

- [ ] **Step 1: Write the failing test** (pure helpers)

`streampulse-web/src/lib/__tests__/gameSegments.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { segmentSharePct, segmentColor } from '../gameSegments'
expect(segmentSharePct([{durationSeconds: 600},{durationSeconds: 400}])[0]).toBe(60)
```
(Helpers in `streamcloneAnalytics.ts` or a new `gameSegments.ts`.)

- [ ] **Step 2-4: Implement + verify**

`fetchPortalStreamGames` follows `fetchPortalStreamSummary`'s try/catch pattern; fallback to `deriveClientGameSegments` when the endpoint returns empty. `SessionHeatmap` fetches on mount via `fetchReplayHeatmapDetail(streamId, 60)`; render lanes with CSS grid; no new chart library — reuse `.figma-chart` surface + inline SVG rects or divs.

- [ ] **Step 5: Wire into dashboard**

Add `SessionGameSegments` + `SessionHeatmap` in the full-width recap/heatmap band (below chart, above grid). Show game segments only when present; heatmap only when data present.

- [ ] **Step 6: Verify + commit**

Manual on VOD sessions (games present, heatmap present). Commit `feat(analytics): game segments + full-stream heatmap on channel dashboard`.

---

### Task 6: Export CSV, emote-label unification, chart gap/raw fixes

**Files:**
- Modify: `streampulse-web/src/ui/components/analytics/FigmaSessionHeaderStrip.tsx` — wire Export (CSV), fix "vod synced", unify emote metric label.
- Modify: `streampulse-web/src/ui/components/analytics/FigmaSignalChart.tsx` — gap rendering for missing minutes + raw-vs-normalized toggle.
- Modify: `streampulse-web/src/ui/components/analytics/figma-analytics.css`.

**Interfaces:**
- Consumes: `PortalStreamMinutesResponse['minutes']` (with `missing`), `FigmaChartPoint` (`figmaSessionAnalytics.ts`), `data.summary` metrics, `sessionCsv.ts` helpers.
- Produces:
  - `export function sessionCsv(minutes, moments, emotes): string` in `streampulse-web/src/lib/sessionCsv.ts` — RFC-4180-ish CSV (quote fields with commas/quotes, CRLF or LF per repo convention; use LF). Columns: `offset_seconds, chat_count, emote_count, seventv_count, viewer_avg, viewer_samples, missing`.
  - `export function downloadCsv(filename: string, csv: string): void` — Blob + `URL.createObjectURL` + anchor click (and revoke). For tests, export `sessionCsv` pure and test the string.

- [ ] **Step 1: Write the failing test**

`streampulse-web/src/lib/__tests__/sessionCsv.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { sessionCsv } from '../sessionCsv'
const minutes = [
  { offsetSeconds: 6, chatCount: 29, seventvEmoteCount: 0, viewerSamples: 0, missing: false },
  { offsetSeconds: 66, chatCount: 482, seventvEmoteCount: 113, viewerSamples: 1, viewerAvg: 26000, missing: false },
]
it('emits header + rows', () => {
  const csv = sessionCsv(minutes, [], [])
  expect(csv.split('\n')[0]).toContain('offset_seconds')
  expect(csv).toContain('482')
  expect(csv).toContain('26000')
})
```

- [ ] **Step 2-4: Implement `sessionCsv.ts` + test**

Minimal CSV serializer (no external dep). Handle undefined numeric fields as empty strings. Test passes.

- [ ] **Step 5: Wire Export button**

In `FigmaSessionHeaderStrip`, replace the disabled button with:

```tsx
<button
  type="button"
  className="figma-btn"
  onClick={() => {
    const csv = sessionCsv(minutesFromProps, momentsFromProps, emotesFromProps)
    downloadCsv(`${model.login ?? 'session'}-${model.streamId}.csv`, csv)
  }}
  disabled={!hasData}
>
  <Download size={11} aria-hidden="true" /> Export
</button>
```

(Pass `minutes`/`moments`/`emotes` into the header strip as props from `FigmaChannelDashboard`. `disabled` when there's no minute data — but now the button is *wired*, not permanently disabled.)

- [ ] **Step 6: Unify emote label + fix "vod synced"**

- Replace header `7TV / min` label with **`Emotes / min`** to match metrics + inspector (keep the value from `model.seventvPerMin` — it's the same metric; just label it consistently).
- Replace the hardcoded `' · vod synced'` in `FigmaSessionHeaderStrip.tsx:56` with a real VOD state: use `model.vodState ?? (model.vodHref ? 'vod ready' : model.isLive ? 'live tracking' : 'no VOD')`. Add `vodState` + `isLive` to the header model.

- [ ] **Step 7: Chart gap + raw-vs-normalized**

In `FigmaSignalChart`:
- Treat `missing` minutes as **gaps** (split the path at missing points so the line doesn't connect across a gap) instead of zeros. In `chartPointsFromMinutes` (`figmaSessionAnalytics.ts:465`), add `missing` to `FigmaChartPoint`, and in the chart's `model` build, skip missing points when drawing chat/viewer/emote lines (or emit `null` breaks). Show a subtle gap indicator on the axis.
- Add a **`Raw` toggle** in the chart head: when on, lanes render raw values (chat/min, viewers avg, emotes/min) scaled to the session max; when off, normalized 0-100 (current). Persist to `sessionStorage` key `sp.chart.scale` = `'raw' | 'norm'` (default `'norm'`). Keep the tooltip always showing raw values.

- [ ] **Step 8: Verify + commit**

`npx vitest run src/lib/__tests__/sessionCsv.test.ts` + typecheck; manual: export produces a downloadable CSV; chart gaps show; Raw toggle flips scales. Commit `feat(analytics): CSV export, chart gaps, raw/normalized toggle, label fixes`.

---

### Task 7: End-to-end verification, a11y, e2e

**Files:**
- Modify: `streampulse-web/tests/e2e/` (new or extended spec — follow the existing pattern from the Appendix "e2e test inventory")
- Run: `npm run check:analytics-overlap`, `npm run typecheck`, `npx vitest run`, `npm run test:e2e:audit` (local-only), Playwright channel-analytics spec.

**Interfaces:** none new — verifies Tasks 1-6.

- [ ] **Step 1: Add/extend an e2e spec**

Create `streampulse-web/tests/e2e/analytics-channel-dashboard.spec.ts` (or extend an existing channel spec found in the Appendix). It must:
- Mock the hosted API (route interception — match the repo's existing pattern) for the stream list, minutes, peaks, summary, recap, games, heatmap.
- Assert: (a) `/analytics/{login}/{date}` resolves to the matched session (strip highlights it) and shows the date notice when no match; (b) quality strip renders with per-signal rows; (c) sync CTA buttons render and POST on click (assert request captured); (d) recap section shows top moments + biggest spike; (e) game segments render; (f) Export produces a download (assert `download` event); (g) no console errors.

- [ ] **Step 2: Run the e2e suite**

Run: `cd streampulse-web && npx playwright test tests/e2e/analytics-channel-dashboard.spec.ts --workers=1`
Expected: all pass. Then run the full audit: `npm run test:e2e:audit`.

- [ ] **Step 3: a11y pass**

- Session strip tabs: add `role="tab"` + arrow-key handling (`onKeyDown` for ArrowLeft/Right → move focus + select). Verify with the repo's a11y checks if any.
- Chart: ensure gap rendering + raw toggle keep `role="img"` + keyboard selection + aria-live.
- New panels: headings (`h3`) + proper `aria-label`s; color not the only signal (quality tones have text labels).
- Manual keyboard walk on all new sections.

- [ ] **Step 4: Full verification**

Run (in order): `npm run check:analytics-overlap`, `npm run typecheck`, `npx vitest run`, `npm run test:e2e:audit`. Then manual smoke on `127.0.0.1:5174` for: date URLs, live session, VOD session, empty session, `?console=1` still works.

- [ ] **Step 5: Commit**

```bash
git add streampulse-web/tests/e2e/analytics-channel-dashboard.spec.ts streampulse-web/src/ui/components/analytics/figma-analytics.css
git commit -m "test(analytics): e2e for date resolution, quality, sync CTAs, recap, export"
```

---

## QOL Backlog (post-MVP — not in Tasks 1-7, but design-approved)

Prioritized by user value vs effort. Add these in a follow-up plan once Tasks 1-7 land.

1. **Copy deep-link** — each moment row + the chart get a "Copy link" that copies `/analytics/{login}/{streamId}#t={offset}` (the `#t=` hash is already honored by `parseDeepLinkOffset`). Low effort, high value for sharing.
2. **Keyboard nav** — full arrow-key moment table navigation + `?` help overlay. Medium.
3. **Compare sessions** — side-by-side of two sessions (selected via the strip + a compare checkbox). Medium-high; needs a design pass.
4. **Annotations on chart** — moment markers on the chart (Signal Wire pattern from hub) so recap moments are visible on the timeline. Medium.
5. **Viewer source badges** — expose `viewerSource` (`live`/`tt`/`merged`/`restored`/`unknown`) as plain-language chips next to the quality strip. Low effort (data already in summary).
6. **Clip preview inline** — for clip candidates, a lightweight preview (thumbnail + duration) before sending to ReplayForge. Needs backend/design.
7. **Timezone toggle** — show session times in UTC vs local vs Twitch. Low-medium.
8. **Session compare export** — CSV of two sessions side-by-side. Low.

**QOL principles (from requirements):** always honest about coverage (no fake progress, no invented numbers), keyboard-accessible, deep-linkable, and every action maps to a real backend job.

---

## Size Estimate

| Scope | Rough effort |
|---|---|
| Task 1 (date resolution) | 0.5 day (pure lib + hook + notice) |
| Task 2 (quality strip) | 0.5 day |
| Task 3 (sync CTAs) | 0.5 day |
| Task 4 (recap + clips) | 1 day |
| Task 5 (games + heatmap) | 1-1.5 days |
| Task 6 (export + chart fixes) | 0.5-1 day |
| Task 7 (e2e + a11y) | 1 day |
| **Total** | **~5-6 engineer-days** (parallelizable: Tasks 1-3 foundation in parallel ~1 day, then 4-6 in parallel ~1.5 days, then 7) |

**Parallelization:** Tasks 1, 2, 3 are independent (different libs + components) → 3 agents in parallel. Tasks 4, 5, 6 depend on the hook fields from 1 (only `selectedStreamId`/`login` — already present) so can start once 1 lands; they don't block each other → parallel. Task 7 needs everything → after merge.

---

## Self-Review Checklist (run before dispatch)

- [ ] Spec coverage: date resolution (Task 1), coverage/quality (2), sync CTAs (3), recap+clips (4), games+heatmap (5), export+chart (6), e2e+a11y (7). QOL backlog covers the rest.
- [ ] No placeholders: every task has real code + real tests above. The Appendix is ground truth for endpoint shapes (from audit agents) — trust it over the table if they differ.
- [ ] Type consistency: `SignalCoverage`, `PortalStreamSummary`, `PortalStreamRecapResponse`, `GameSegment[]`, `FigmaChartPoint` all match the source files referenced. `buildAnalyticsHref({login, streamId, offsetSeconds})` matches `analyticsLinks.ts:10`.

---

## Appendix: Audit Agent Reports

> **These three reports are the ground-truth endpoint/test/QOL inventory.** If anything in the tables above conflicts with them, trust the Appendix (it was generated by reading the actual backend + portal code and probing the live API).

The audit agents (backend endpoints / e2e inventory / QOL+clip affordances) are running in the background and their structured reports are **appended here** as they complete. Until they land, the endpoint table + file map in this plan are the verified source of truth (read directly from `streamclone-pulse` code + live API probes on 2026-08-14).

---

### Appendix A: Backend analytics endpoint map (from audit agent — ground truth, 2026-08-14)

**Portal read tree** — `portal_analytics_api.go:207-226` (all under `/v1/portal/analytics`, hosted, no auth):
- `GET /v1/portal/analytics/channels/{login}/streams` — list (handler `:675-717`). `items[]` = `PortalStreamRecord` (`:56`): `streamId, login, displayName, title, category, categoryId, gamesSummary, startedAt, endedAt, currentViewers, peakViewers, viewerSamples, chatMessages, vodId`.
- `GET /v1/portal/analytics/streams/{streamId}/minutes` — `:545-601`; point `:82-93` (`offsetSeconds, viewerAvg/Max/Latest, viewerSamples, chatCount, totalEmoteCount, seventvEmoteCount, missing, topEmotes[]`), response `:96-104` adds `startedAt, coverageStartOffsetSeconds, signalWatermarks`.
- `GET /v1/portal/analytics/streams/{streamId}/peaks` — `portal_figma_session.go:250-300`; `PortalPeak :20-33` (`offsetSeconds, score, reasons[], reasonLabel, dominantSignal, chatCount, emoteCount, vodState, topEmotes[]`).
- `GET /v1/portal/analytics/streams/{streamId}/coverage-truth` — `:302-368`; rows from `ExtensionCoverage` (`pulse_coverage.go:37-53`), includes `dataCoveragePct` (camelCase).
- `GET /v1/portal/analytics/streams/{streamId}/summary` — via `model.go:105-116` metrics (`data_coverage_pct`, `sync_health_state`, `chat_per_min`, `emotes_per_min`, `seventv_per_min`, `provider_share_pct`, `reaction_score_0_100`, `viewer_momentum_5m`) + `topEmotes[]` + `analyticsQuality`.
- `GET /v1/portal/analytics/streams/{streamId}/recap` — `recap_handler.go:17-86`; `StreamRecap` (`recap/recap.go:28-43`): `topMoments[] (offsetSeconds, score, reasons[], chatCount, emoteCount, viewerCount, topEmotes[])`, `biggestChatSpike`, `funniestEmoteBurst`, `clipCandidates[]`, `totalMessages`, `peakChatPerMin`, `vodId`, `durationSeconds`, `emoteEnrichmentStatus`.
- `GET /v1/portal/analytics/streams/{streamId}/games` — `api.go:1056-1128`; `GameSegment` (`model.go:161-173`): `id, streamId, gameName, boxArtUrl, offsetSeconds, durationSeconds, createdAt`.
- `GET /v1/portal/analytics/streams/{streamId}/replay-heatmap?window=60&detail=true|false` — `heatmap_handler.go:26-150`; **window MUST be 60** (400 otherwise). Compact `HeatmapResponse` = `points[]` (`heatmap/score.go:35-49`): `{offsetSeconds, durationSeconds, score, reactionScore, viewerMomentumScore, confidence, reason, topEmotes[], vodId, streamId, minuteTs}`. Detail adds `components` map. **No lanes structure — flat points.**
- `GET /v1/portal/analytics/streams/{streamId}/sync/status` — **sanitized 4-field** projection: `{phase, message, updatedAt, stale}`.

**Clip handoff** (`bookmarks.go:66-79`, `clip_candidates_api.go:34-42`) — requires beta key:
- `POST /v1/pulse/clips/{id}/replayforge` — queue candidate → `ClipCandidateJob`.
- `GET /v1/pulse/clips/{id}/replayforge` — refresh job; re-polls RF `GetJob`; stored job `{job: {id, state, artifact_available, failure_code, error_code, error_message, message, reason}, events[]}`.
- `POST /v1/internal/replayforge/jobs/{jobID}` — inbound RF webhook (not a portal call).
- Service-mode projection under ReplayForge principal returns `projectClipCandidates` (enriched provider emote IDs).

**Sync/backfill (NOT under `/v1/portal`)** — `api.go:218-221`, `extension_api.go:235-236`:
- `POST /v1/analytics/streams/{streamID}/sync` — `syncStream` `api.go:1014-1036`; query `channel, viewers_only, mode, force_chat, vod_id`; `StartSyncResponse` `{accepted, status: SyncStatus}` (202 accepted / 200 already running).
- `GET /v1/analytics/streams/{streamID}/sync/status` — raw `SyncStatus` `sync_status.go:174-192` (full object incl. `chat/tracker/network` progress, `timing`, `phase`).
- `POST /v1/analytics/streams/{streamID}/prefetch-tracker` — `api.go:991-1012`; requires `channel`; 202 `{status: queued|skipped}`.
- `POST /v1/extension/pulse/channels/{login}/backfill` — `pulse_backfill_api.go:18-105`; body `{streamId (req), vodId, mode}`; guards pulse-write + extension principal + rate limit; 503 `pulse_backfill_disabled` / 429 `backfill_at_capacity` (Retry-After: 45); returns `PulseBackfillJob` `{jobId, streamId, login, mode, status, message, progress{segmentsDone, segmentsTotal, percent}, range, error, createdAt, updatedAt}` (202).
- `GET /v1/extension/pulse/backfill/{jobId}` — job status (404 `job_not_found`).

**Job status enums** (ordered):
- `PulseBackfillStatus`: `queued → already_available → resolving_vod → waiting_for_vod → ensuring_emotes → fetching_chat → tokenizing → writing_rollups → refreshing_moments → done → failed → cancelled`.
- `SyncPhase`: `starting → scraping_tracker → parsing_tracker → resolving_vod → fetching_comments → writing_rollups → exporting_archive → export_pending → completed → failed` (terminal = completed/export_pending/failed).

**Viewer-source / quality fields:**
- `viewerSource` values: `live`, `tt`, `merged`, `restored`, `unknown` (+ inferred `partial`/`""`) — `session.go:16-21`, `viewer_coverage.go:176-210`.
- `data_coverage_pct`: snake_case, `minutesWithData / expectedMinutes * 100`, clamped 0-100, round2 — `model.go:112`, `api.go:652-660`. Portal camelCase aliases: `chatCoveragePct` (detail), `dataCoveragePct` (coverage-truth).
- `sync_health_state`: `synced | partial | viewer_only | chat_only | stats_only | missing` — `model.go:113`, `api.go:661-671`.
- Rollup emote key format: `provider:id:name` (`splitEmoteKey`, `recap.go:401-411`).
- `vodId` on `StreamRecord.VodID` (`model.go:45`) with `VodSource` (`model.go:46`); portal blanking rule `portal_analytics_api.go:113-116`.
- Chat count: `chatMessages` (stream list), `recap.totalMessages`, per-minute `chatCount`.

**Key implications for the plan:**
1. **No `export` endpoint exists** — CSV must be client-side (`sessionCsv.ts`). Confirmed.
2. **Sync/prefetch/backfill are not portal-tree** — public no-login may 401; Task 3 Step 0 probe is mandatory.
3. **Heatmap is flat points, window=60** — the plan's `SessionHeatmap` renders one lane from `score`/`reactionScore`, not 3 lanes. Confirmed above.
4. **summary uses snake_case** metrics while most else is camelCase — Task 2's `channelQuality.ts` must read the snake_case keys exactly (`data_coverage_pct`, `sync_health_state`, `viewer_momentum_5m`).
5. **recap is same payload at `/v1/pulse/streams/{id}/recap` and portal path** — use the portal path.

---

### Appendix B: Portal test inventory & conventions (from audit agent — ground truth)

**E2E (Playwright, LOCAL-ONLY — never GitHub Actions):** `streampulse-web/tests/e2e/`
- `visual-analytics-smoke.spec.ts`, `analytics-figma-parity.spec.ts` (only checks overflow + `/s/` alias), `analytics-session-pulse-moments.spec.ts`, `hasanabi-stream-id-alias.spec.ts` (live hosted date-slug; **skips in mock-only runs** via `PLAYWRIGHT_MOCK_ONLY` / local-backend gate), `session-signal-tape.spec.ts`, plus hub specs.
- Mocking pattern: **`installPortalConsoleMock` + `installHubUxMock`** (deterministic, hosted-origin `page.route`). New mocked specs must follow this so they run in the default `test:e2e` invocation (CI runs no e2e at all).
- Playwright config at repo root; `RF_E2E_BROWSER=chrome`; `--workers=1` for gated suites. Snapshot baselines are **chromium-linux + chromium-win32** (new `toHaveScreenshot` needs both).

**Unit (vitest) — the PR gate:** `streampulse-web` `npm test` (static-check build chain in CI). Known coverage gaps to fill with this plan:
1. `buildAnalyticsHref` — **no unit test**; the mirrored copy in `check:analytics-links.mjs` is stale (legacy `/s/` form vs canonical `{streamId}` + `#t={offset}`).
2. `FigmaChannelDashboard` — **no unit test**.
3. `useChannelPageData` — only the URL-builder is tested.
4. `MostReactedMinutesTable` — only `pulse-live` variant; no `featured-session` variant / selection / aria-pressed tests.
5. Date-resolution — only package-level (`analyticsConsoleUtils.test.ts` via `streamRouteResolution`) + live hosted e2e that skips in mock-only. **No mocked e2e drives a date slug → resolved session.**
6. Sync CTA flow — **no test** exercises button → request → status update (portal console mock has a `sync/status` route but no spec clicks it).
7. Quality score — only label mapping (`deriveAnalyticsQualityLabel`), no UI-rendering test.

**Analytics-console package tests** (`/mnt/c/Users/Aron/streampulse-backend/packages/analytics-console`, `npm test` → vitest, jsdom): 23 files covering chart buckets, position rail, viewer-morph detail, recap strip, games strip, signals (`buildSessionSignals` A1–A18), `streamQuality.test.ts`, `twitchVodUrl.test.ts`, etc. **Portal `npm test` only covers package exports used by portal tests** (via `node_modules` symlink); the package's own tests run only via its own `npm test`.

**`check:analytics-overlap`** (`streampulse-web/scripts/check-analytics-overlap.mjs`, wired into `build` + `build:ci`): fails if `GlobalActivityChart.tsx` / `ChannelDatePage.tsx` / `ChannelSessionKeyRoute.tsx` re-appear. **New analytics routes/charts must route through surviving surfaces** (`FigmaChannelDashboard` / `AnalyticsConsole` / `HubActivityChart`), not a third implementation.

**Recommendation for new test files:** unit tests in `streampulse-web/tests/` (e.g. `analyticsLinks.test.ts`, `FigmaChannelDashboard.test.tsx`, expanded `useChannelPageData.test.ts`, `MostReactedMinutesTable` featured variant); new mocked e2e in `streampulse-web/tests/e2e/` using `installPortalConsoleMock` + `installHubUxMock` (date-slug resolution with `waitForURL`, a sync-CTA spec, a quality-display spec); any new console-side logic gets package tests in `packages/analytics-console/src/`.

---

### Appendix C: QOL & clip affordances (from audit agent — ground truth)

**Tier 2 — port extension QOL patterns (small, low-risk):**
7. **Sync-state pill set** — extension's `PulseStatusPill` enum (Tracking / Replay synced / Syncing replay / Partial coverage / No replay data / Backend unavailable). Console already has `SyncStatusPanel`, `VodAvailabilityChip`, `AnalyticsQualityChip`, `CoverageFacets` in `ConsoleBits.tsx` — **re-export from the console package**, don't rebuild.
8. **Per-moment quality/coverage badge** — port `confidenceTone`/`scoreTone` (`pulseMomentsUtils.ts`) into a small badge on `FigmaMomentRow` + `MostReactedMinutesTable`, mirroring `SelectedMomentCard`'s precision chip ("1s onset" / "Live · minute" / "~30s").
9. **Precision-honest moment inspector** — port `SelectedMomentCard`'s dual-action + precision chip into `FigmaMomentInspector` (it already has Jump-to-VOD + emote rows; add the precision chip, viewer-source honesty line, queue action).
10. **Emote "Plot on chart" overlay** — `PlotOnChartStrip` + `emoteChartColorForKey`/`orderedEmoteColors` (`chartTheme.ts`) exist in the console; expose via index and reuse (the extension proves this is the standout interactive feature).
11. **Keyboard nav for chart/rail** — port `ChartPositionRail`'s `role="slider"` contract (←/→ pan, `[`/`]` resize, Home/End, Escape reset) to the portal chart; console `AnalyticsChart` already implements it.

**Tier 3 — structural (needs plan sign-off):**
12. **Re-export console internals** — add index re-exports for `ConsoleBits`, `chartRollupUtils`, `chartTheme`, `SelectedMomentPanel`, `PlotOnChartStrip`, `SyncStatusPanel`, heatmap types (`types/heatmap.ts`) — the `exports` map forbids deep imports. Mostly zero new UI.
13. **Per-moment share page route** — `/moments/:id` (RF placeholder `StreamPulseImportForm` hints `https://streampulse.stream/moments/…`); V2 "shareable moment pages" item.
14. **ReplayForge Studio deep link** — RF→portal is wired (`StudioTopBar`, `Candidates`, `ClipperAuthHelp` link `/analytics/...`); **portal→Studio doesn't exist** (grep 8096 = 0). Needs `VITE_STREAMPULSE_PORTAL_ORIGIN`-style config; honor `INTEGRATION.md`'s "no Streamclone-owned studio" boundary.

**Constraints to respect:** no section reorder / `Figma*` renames / layout-contract changes; Figma Make file (`C35yDLsXdkoRyDvnlxd5gr`) wins over extension PNGs on `/analytics`; clip-handoff backend (`GET /v1/pulse/clips/{id}` + import) is still "code on branch — merge + hosted smoke pending", so any new "Send to ReplayForge" UI must be gated/graceful until that lands.

