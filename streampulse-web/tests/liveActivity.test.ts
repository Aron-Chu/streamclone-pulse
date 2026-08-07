import { describe, expect, it } from 'vitest'
import {
  diffNewLiveActivityIds,
  filterLiveActivityEvents,
  formatCoverageDiagnostic,
  formatLiveActivityRelativeTime,
  isLiveActivityPortalReadEnabled,
  liveActivityKindLabel,
  liveActivityPrecisionLabel,
  normalizeLiveActivityResponse,
  resolveCoverageMetadataLabel,
  seedLiveActivityBaseline,
  type LiveActivityEvent,
} from '../src/lib/liveActivity'

function sampleEvent(overrides: Partial<LiveActivityEvent> = {}): LiveActivityEvent {
  return {
    id: 'evt-1',
    kind: 'went_live',
    channel: {
      id: 'chan-1',
      login: 'xqc',
      displayName: 'xQc',
      avatarUrl: 'https://example.com/a.png',
    },
    streamId: 'stream-a',
    occurredAt: '2026-07-23T11:53:12.000Z',
    detectedAt: '2026-07-23T11:54:01.000Z',
    lastSeenLiveAt: null,
    timestampPrecision: 'twitch_started_at',
    title: 'Ranked',
    category: 'Just Chatting',
    source: 'metadata_poll',
    ...overrides,
  }
}

function sampleResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    asOf: '2026-07-23T12:00:00.000Z',
    window: '6h',
    completeness: 'tracked_channels_only',
    metadata: {
      state: 'current',
      lastSuccessfulPollAt: '2026-07-23T11:59:40.000Z',
    },
    events: [sampleEvent()],
    ...overrides,
  }
}

describe('liveActivity normalize/parse', () => {
  it('normalizes a valid response including empty events', () => {
    const empty = normalizeLiveActivityResponse(sampleResponse({ events: [] }))
    expect(empty.events).toEqual([])
    expect(empty.metadata.state).toBe('current')
    expect(empty.completeness).toBe('tracked_channels_only')

    const withEvents = normalizeLiveActivityResponse(sampleResponse())
    expect(withEvents.events).toHaveLength(1)
    expect(withEvents.events[0]?.channel.login).toBe('xqc')
    expect(withEvents.events[0]?.occurredAt).toBe('2026-07-23T11:53:12.000Z')
  })

  it('rejects invalid shapes', () => {
    expect(() => normalizeLiveActivityResponse(null)).toThrow(/live_activity_invalid/)
    expect(() => normalizeLiveActivityResponse({ ...sampleResponse(), events: 'nope' })).toThrow(
      /live_activity_invalid:events/,
    )
    expect(() =>
      normalizeLiveActivityResponse({
        asOf: '2026-07-23T12:00:00.000Z',
        window: '6h',
        completeness: 'tracked_channels_only',
        metadata: { state: 'mystery' },
        events: [],
      }),
    ).toThrow(/live_activity_invalid:metadata.state/)
    expect(() =>
      normalizeLiveActivityResponse(
        sampleResponse({
          events: [{ ...sampleEvent(), kind: 'entered_live_set' as never }],
        }),
      ),
    ).toThrow(/live_activity_invalid:kind/)
  })

  it('rejects completeness other than tracked_channels_only', () => {
    expect(() =>
      normalizeLiveActivityResponse(sampleResponse({ completeness: 'all_twitch' })),
    ).toThrow(/live_activity_invalid:completeness/)
  })

  it('rejects invalid source and timestampPrecision', () => {
    expect(() =>
      normalizeLiveActivityResponse(
        sampleResponse({
          events: [{ ...sampleEvent(), source: 'irc' as never }],
        }),
      ),
    ).toThrow(/live_activity_invalid:source/)
    expect(() =>
      normalizeLiveActivityResponse(
        sampleResponse({
          events: [{ ...sampleEvent(), timestampPrecision: 'guessed' as never }],
        }),
      ),
    ).toThrow(/live_activity_invalid:timestampPrecision/)
  })

  it('throws on malformed required timestamps', () => {
    expect(() =>
      normalizeLiveActivityResponse(sampleResponse({ asOf: 'not-a-date' })),
    ).toThrow(/live_activity_invalid:asOf/)
    expect(() =>
      normalizeLiveActivityResponse(
        sampleResponse({
          events: [{ ...sampleEvent(), occurredAt: 'yesterday' }],
        }),
      ),
    ).toThrow(/live_activity_invalid:occurredAt/)
  })

  it('coerces optional lastSeenLiveAt null/invalid to null', () => {
    const nullSeen = normalizeLiveActivityResponse(
      sampleResponse({
        events: [{ ...sampleEvent(), lastSeenLiveAt: null }],
      }),
    )
    expect(nullSeen.events[0]?.lastSeenLiveAt).toBeNull()

    const invalidSeen = normalizeLiveActivityResponse(
      sampleResponse({
        events: [{ ...sampleEvent(), lastSeenLiveAt: 'not-iso' as never }],
      }),
    )
    expect(invalidSeen.events[0]?.lastSeenLiveAt).toBeNull()

    const emptySeen = normalizeLiveActivityResponse(
      sampleResponse({
        events: [{ ...sampleEvent(), lastSeenLiveAt: '   ' as never }],
      }),
    )
    expect(emptySeen.events[0]?.lastSeenLiveAt).toBeNull()
  })
})

describe('liveActivity filters and copy', () => {
  const events = [
    sampleEvent({ id: 'a', kind: 'went_live' }),
    sampleEvent({
      id: 'b',
      kind: 'went_offline',
      timestampPrecision: 'observed_after_confirmation',
      lastSeenLiveAt: '2026-07-23T11:50:00.000Z',
    }),
  ]

  it('filters by kind', () => {
    expect(filterLiveActivityEvents(events, 'all')).toHaveLength(2)
    expect(filterLiveActivityEvents(events, 'went_live').map((e) => e.id)).toEqual(['a'])
    expect(filterLiveActivityEvents(events, 'went_offline').map((e) => e.id)).toEqual(['b'])
  })

  it('uses confirmed start / observed offline precision copy', () => {
    expect(liveActivityKindLabel('went_live')).toBe('Went live')
    expect(liveActivityKindLabel('went_offline')).toBe('Went offline')
    expect(liveActivityPrecisionLabel('twitch_started_at', 'went_live')).toBe('Confirmed start')
    expect(liveActivityPrecisionLabel('observed_after_confirmation', 'went_offline')).toBe(
      'Observed offline',
    )
  })

  it('formats relative time and coverage diagnostic', () => {
    const now = Date.parse('2026-07-23T12:00:00.000Z')
    expect(formatLiveActivityRelativeTime('2026-07-23T11:59:00.000Z', now)).toBe('1m ago')
    expect(formatCoverageDiagnostic(286, 'current')).toBe('286 tracked channels · metadata current')
  })

  it('resolves coverage metadata label honesty from request status', () => {
    expect(resolveCoverageMetadataLabel('unavailable', 'current')).toBe('unavailable')
    expect(resolveCoverageMetadataLabel('error', 'current')).toBe('unavailable')
    expect(resolveCoverageMetadataLabel('loading', 'current')).toBe('unavailable')
    expect(resolveCoverageMetadataLabel('ready', 'current')).toBe('current')
    expect(resolveCoverageMetadataLabel('empty', 'degraded')).toBe('degraded')
    expect(resolveCoverageMetadataLabel('degraded', 'degraded')).toBe('degraded')
    expect(resolveCoverageMetadataLabel('stale', 'stale')).toBe('stale')
    expect(resolveCoverageMetadataLabel(undefined, 'current')).toBe('current')
  })
})

describe('liveActivity New baseline', () => {
  it('does not mark initial seed ids as New', () => {
    const baseline = seedLiveActivityBaseline(['evt-1', 'evt-2'])
    expect(diffNewLiveActivityIds(baseline, ['evt-1', 'evt-2']).size).toBe(0)
    expect(diffNewLiveActivityIds(null, ['evt-1']).size).toBe(0)
  })

  it('marks only previously unseen stable ids after baseline', () => {
    const baseline = seedLiveActivityBaseline(['evt-1'])
    const fresh = diffNewLiveActivityIds(baseline, ['evt-1', 'evt-3'])
    expect([...fresh]).toEqual(['evt-3'])
  })
})

describe('liveActivity health labels (empty/degraded/stale/unavailable)', () => {
  it('preserves metadata states used by the panel', () => {
    for (const state of ['current', 'degraded', 'stale', 'unavailable'] as const) {
      const res = normalizeLiveActivityResponse(
        sampleResponse({
          metadata: { state, lastSuccessfulPollAt: '2026-07-23T11:59:40.000Z' },
          events: state === 'unavailable' ? [] : [sampleEvent()],
        }),
      )
      expect(res.metadata.state).toBe(state)
    }
  })
})

describe('liveActivity portal read gate', () => {
  afterEach(() => {
    window.sessionStorage.removeItem('sp.liveActivityPortalRead')
  })

  it('defaults OFF unless env is exactly true', () => {
    expect(isLiveActivityPortalReadEnabled({})).toBe(false)
    expect(isLiveActivityPortalReadEnabled({ VITE_LIVE_ACTIVITY_PORTAL_READ_ENABLED: 'false' })).toBe(
      false,
    )
    expect(isLiveActivityPortalReadEnabled({ VITE_LIVE_ACTIVITY_PORTAL_READ_ENABLED: 'true' })).toBe(
      true,
    )
  })

  it('honors session override only in non-production modes', () => {
    window.sessionStorage.setItem('sp.liveActivityPortalRead', 'true')
    expect(
      isLiveActivityPortalReadEnabled({
        VITE_LIVE_ACTIVITY_PORTAL_READ_ENABLED: 'false',
        DEV: true,
        MODE: 'development',
      }),
    ).toBe(true)
    window.sessionStorage.setItem('sp.liveActivityPortalRead', 'false')
    expect(
      isLiveActivityPortalReadEnabled({
        VITE_LIVE_ACTIVITY_PORTAL_READ_ENABLED: 'true',
        DEV: true,
        MODE: 'development',
      }),
    ).toBe(false)
  })

  it('ignores session override in production builds', () => {
    window.sessionStorage.setItem('sp.liveActivityPortalRead', 'true')
    expect(
      isLiveActivityPortalReadEnabled({
        VITE_LIVE_ACTIVITY_PORTAL_READ_ENABLED: 'false',
        PROD: true,
        MODE: 'production',
        DEV: false,
      }),
    ).toBe(false)
    expect(
      isLiveActivityPortalReadEnabled({
        VITE_LIVE_ACTIVITY_PORTAL_READ_ENABLED: 'true',
        PROD: true,
        MODE: 'production',
        DEV: false,
      }),
    ).toBe(true)
  })
})
