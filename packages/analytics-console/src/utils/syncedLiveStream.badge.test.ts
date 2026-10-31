import { describe, expect, it } from 'vitest'
import type { AnalyticsStream } from '../api.ts'
import { GOOD_COVERAGE_PCT, deriveAnalyticsQualityLabel } from './streamQuality.ts'
import {
  streamSyncBadgeLabel,
  streamSyncBadgeState,
  streamSyncBadgeTitle,
  type StreamSyncEvidence,
} from './syncedLiveStream.ts'

// (pick 11A, 10-30) The list badge uses the header's and the backend's 80%
// line, and its hover text reads the same evidence as the badge.

/** An open row as the stream list sends it: a viewer sample, no chat count. */
const OPEN_ROW: AnalyticsStream = {
  streamId: '316655688306',
  login: 'yuyuta0702',
  startedAt: '2026-10-30T04:20:06Z',
  viewerSamples: 1,
}

/** The open session's own minutes with no header verdict: the 80% fallback rule (AnalyticsConsole's activeSyncEvidence also passes `quality`). */
function sessionEvidence(coveragePct: number, syncHealthState = 'synced'): StreamSyncEvidence {
  return { hasViewerMinutes: true, hasChatMinutes: true, coveragePct, syncHealthState }
}

function badge(stream: AnalyticsStream, evidence?: StreamSyncEvidence) {
  const state = streamSyncBadgeState(stream, false, evidence)
  return { label: streamSyncBadgeLabel(state), title: streamSyncBadgeTitle(state, stream, evidence) }
}

describe('streamSyncBadgeState: the 80% line', () => {
  it('shares the header line', () => {
    expect(GOOD_COVERAGE_PCT).toBe(80)
  })

  it('calls the yuyuta0702 live session (99.44%, 178 of 179 minutes) Synced, as the header calls it Good', () => {
    const evidence = sessionEvidence(99.44)
    expect(badge(OPEN_ROW, evidence).label).toBe('Synced')
    expect(
      deriveAnalyticsQualityLabel({
        analyticsQuality: 'full_pulse',
        summaryMetrics: { data_coverage_pct: 99.44, sync_health_state: 'synced' },
        rollupCount: 178,
      }),
    ).toBe('Good')
  })

  it.each([
    [80, 'Synced', 'Good'],
    [79.99, 'Partial', 'Partial'],
    [85, 'Synced', 'Good'],
    [99.49, 'Synced', 'Good'],
  ])('at %s%% the row says %s and the header says %s', (pct, rowLabel, headerLabel) => {
    // The backend writes "partial" only under its own 80% line (summarizeStreamMetrics).
    const health = pct < 80 ? 'partial' : 'synced'
    expect(badge(OPEN_ROW, sessionEvidence(pct, health)).label).toBe(rowLabel)
    expect(badge(OPEN_ROW, sessionEvidence(pct, '')).label).toBe(rowLabel)
    expect(
      deriveAnalyticsQualityLabel({
        summaryMetrics: { data_coverage_pct: pct, sync_health_state: health },
        rollupCount: 100,
      }),
    ).toBe(headerLabel)
  })

  it('still trusts a partial health state above the line', () => {
    expect(badge(OPEN_ROW, sessionEvidence(92, 'chat_only')).label).toBe('Partial')
  })

  it('ignores a coverage number that is not finite', () => {
    expect(badge(OPEN_ROW, sessionEvidence(Number.NaN)).label).toBe('Synced')
  })
})

describe('streamSyncBadgeTitle: reads the badge evidence', () => {
  it('does not say chat is missing when the session has chat minutes the list row lacks', () => {
    const evidence: StreamSyncEvidence = { hasViewerMinutes: true, hasChatMinutes: true, coveragePct: 99.44, syncHealthState: 'synced' }
    const { title } = badge(OPEN_ROW, evidence)
    expect(title).not.toMatch(/chat rollups missing/i)
    // Even when a partial state comes from elsewhere, the chat minutes are not called missing.
    expect(streamSyncBadgeTitle('partial', OPEN_ROW, evidence)).not.toMatch(/chat rollups missing/i)
  })

  it('names the share in plain words under the line, rounded down', () => {
    expect(badge(OPEN_ROW, sessionEvidence(61.45, 'partial')).title).toBe(
      "Data in 61% of this stream's minutes; under 80% counts as partial.",
    )
    expect(badge(OPEN_ROW, sessionEvidence(79.6, 'partial')).title).toBe(
      "Data in 79% of this stream's minutes; under 80% counts as partial.",
    )
    expect(badge(OPEN_ROW, sessionEvidence(0.4, 'partial')).title).toBe(
      "Data in less than 1% of this stream's minutes; under 80% counts as partial.",
    )
  })

  it('keeps the generic line for a partial health state above the line', () => {
    expect(badge(OPEN_ROW, sessionEvidence(92, 'degraded')).title).toBe('Partial minute coverage — chart may be incomplete.')
  })

  it('still says chat is missing when the session itself has no chat minutes', () => {
    const evidence: StreamSyncEvidence = { hasViewerMinutes: true, hasChatMinutes: false, coveragePct: 90, syncHealthState: 'viewer_only' }
    expect(badge(OPEN_ROW, evidence)).toEqual({
      label: 'Partial',
      title: 'Viewer minutes synced; chat rollups missing or partial.',
    })
  })

  it('left alone: an unselected open row (no evidence, no chat count) keeps Partial and its old hover text', () => {
    expect(badge(OPEN_ROW)).toEqual({
      label: 'Partial',
      title: 'Viewer minutes synced; chat rollups missing or partial.',
    })
  })

  it('reads list counts alone when no evidence is passed', () => {
    const chatOnly: AnalyticsStream = { ...OPEN_ROW, viewerSamples: 0, chatMessages: 40 }
    expect(badge(chatOnly).title).toBe('Chat rollups synced; viewer minutes missing or partial.')
    const both: AnalyticsStream = { ...OPEN_ROW, viewerSamples: 120, chatMessages: 450 }
    expect(badge(both)).toEqual({
      label: 'Synced',
      title: 'Minute-level viewer, chat, and emote rollups are synced for charts.',
    })
  })
})

describe('streamSyncBadgeState: the header verdict (pick 11A review, 10-30)', () => {
  it('says Synced whenever the header says Good, even if the session minutes did not load', () => {
    const evidence: StreamSyncEvidence = { hasViewerMinutes: false, hasChatMinutes: false, coveragePct: 99.44, syncHealthState: 'synced', quality: 'Good' }
    // the hover text says the chart did not load, not that its rollups are synced (review 10-30)
    expect(badge(OPEN_ROW, evidence)).toEqual({ label: 'Synced', title: 'Data synced; the minute chart did not load on this page.' })
    expect(badge(OPEN_ROW, { ...sessionEvidence(99.44), quality: 'Good' }).title)
      .toBe('Minute-level viewer, chat, and emote rollups are synced for charts.')
  })

  it.each(['Partial', 'Limited', 'No data'] as const)('never says Synced while the header says %s, even above the line', (quality) => {
    expect(badge(OPEN_ROW, { ...sessionEvidence(92, ''), quality }).label).toBe('Partial')
  })

  it('a syncing row stays Syncing', () => {
    expect(streamSyncBadgeState(OPEN_ROW, true, { ...sessionEvidence(99), quality: 'Good' })).toBe('syncing')
  })
})
