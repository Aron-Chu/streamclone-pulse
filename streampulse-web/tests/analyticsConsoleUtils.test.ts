import { describe, expect, it } from 'vitest'
import {
  isDateSlugUnresolved,
  resolveMatchedStream,
  resolveTargetQueryStreamId,
} from '../../../twitch-7tv-clone/packages/analytics-console/src/utils/streamRouteResolution.ts'
import {
  streamHasSyncedMinutes,
  streamSyncBadgeState,
  streamSyncBadgeLabel,
  resolveCanonicalSessionSlug,
  getAnalyticsStreamDateSlug,
} from '../../../twitch-7tv-clone/packages/analytics-console/src/utils/syncedLiveStream.ts'
import type { AnalyticsStream } from '../../../twitch-7tv-clone/packages/analytics-console/src/apiTypes.ts'

const sampleStreams: AnalyticsStream[] = [
  {
    streamId: '12345',
    login: 'xqc',
    startedAt: '2026-07-02T14:30:00.000Z',
    viewerSamples: 120,
    chatMessages: 450,
  },
  {
    streamId: '67890',
    login: 'xqc',
    startedAt: '2026-07-01T10:00:00.000Z',
    viewerSamples: 80,
    chatMessages: 0,
  },
]

describe('streamRouteResolution', () => {
  it('resolves numeric stream id directly', () => {
    expect(resolveTargetQueryStreamId('12345', undefined, [], false)).toBe('12345')
  })

  it('resolves date slug to matched stream id', () => {
    const localDate = '2026-07-02'
    const matched = resolveMatchedStream(localDate, sampleStreams)
    expect(matched?.streamId).toBe('12345')
    expect(resolveTargetQueryStreamId(localDate, matched, [], false)).toBe('12345')
  })

  it('falls back to history items for date slug', () => {
    const slug = '2026-07-02'
    expect(
      resolveTargetQueryStreamId(slug, undefined, [{ id: '99999', startedAt: '2026-07-02T08:00:00.000Z' }], false),
    ).toBe('99999')
  })

  it('marks unresolved date slug after lists load', () => {
    expect(isDateSlugUnresolved('2026-07-03', undefined, false)).toBe(true)
    expect(isDateSlugUnresolved('2026-07-03', undefined, true)).toBe(false)
  })
})

describe('syncedLiveStream badges', () => {
  it('requires both viewer and chat for synced minutes', () => {
    expect(streamHasSyncedMinutes(sampleStreams[0])).toBe(true)
    expect(streamHasSyncedMinutes(sampleStreams[1])).toBe(false)
  })

  it('classifies partial and stats-only badges', () => {
    expect(streamSyncBadgeLabel(streamSyncBadgeState(sampleStreams[0]))).toBe('Synced')
    expect(streamSyncBadgeLabel(streamSyncBadgeState(sampleStreams[1]))).toBe('Partial')
    expect(
      streamSyncBadgeLabel(
        streamSyncBadgeState({ streamId: 'x', login: 'x', startedAt: '', viewerSamples: 0, chatMessages: 0 }),
      ),
    ).toBe('Stats only')
  })
})

describe('resolveCanonicalSessionSlug', () => {
  const syncedToday: AnalyticsStream = {
    streamId: '2640123456',
    login: 'caedrel',
    startedAt: '2026-07-05T18:00:00.000Z',
    viewerSamples: 420,
    chatMessages: 1200,
  }

  const syncedOlder: AnalyticsStream = {
    streamId: '2639999999',
    login: 'caedrel',
    startedAt: '2026-07-04T14:00:00.000Z',
    viewerSamples: 300,
    chatMessages: 800,
  }

  const statsOnly: AnalyticsStream = {
    streamId: '2638888888',
    login: 'caedrel',
    startedAt: '2026-07-03T10:00:00.000Z',
    viewerSamples: 0,
    chatMessages: 0,
    peakViewers: 5000,
  }

  const sidebarStreams = [syncedToday, syncedOlder, statsOnly]

  it('returns date slug for live route with synced current stream', () => {
    expect(
      resolveCanonicalSessionSlug({
        isLiveRoute: true,
        listsLoading: false,
        sidebarStreams,
        targetStreamId: syncedToday.streamId,
        liveHasChartMinutes: true,
      }),
    ).toBe(getAnalyticsStreamDateSlug(syncedToday.startedAt))
  })

  it('redirects empty live collector to newest synced session slug', () => {
    expect(
      resolveCanonicalSessionSlug({
        isLiveRoute: true,
        listsLoading: false,
        sidebarStreams,
        targetStreamId: 'live-collector-empty',
        liveHasChartMinutes: false,
        isActiveLiveCollector: false,
        currentViewers: 0,
        liveStreamId: 'live-collector-empty',
      }),
    ).toBe(getAnalyticsStreamDateSlug(syncedToday.startedAt))
  })

  it('returns undefined for stats-only stream on live route', () => {
    expect(
      resolveCanonicalSessionSlug({
        isLiveRoute: true,
        listsLoading: false,
        sidebarStreams: [statsOnly],
        targetStreamId: statsOnly.streamId,
        liveHasChartMinutes: true,
      }),
    ).toBeUndefined()
  })

  it('returns undefined on session (historical) route', () => {
    expect(
      resolveCanonicalSessionSlug({
        isLiveRoute: false,
        listsLoading: false,
        sidebarStreams,
        targetStreamId: syncedToday.streamId,
        liveHasChartMinutes: true,
      }),
    ).toBeUndefined()
  })

  it('returns undefined while stream lists are loading', () => {
    expect(
      resolveCanonicalSessionSlug({
        isLiveRoute: true,
        listsLoading: true,
        sidebarStreams,
        targetStreamId: syncedToday.streamId,
      }),
    ).toBeUndefined()
  })
})

describe('emotePlotSelection', () => {
  const topEmotes = [
    { key: 'twitch:1:LUL' },
    { key: 'twitch:2:Kappa' },
    { key: 'seventv:3:KEKW' },
    { key: 'twitch:4:Clap' },
  ]

  it('defaults to top 3 on spikes view', async () => {
    const { resolveChartEmoteKeys } = await import(
      '../../../twitch-7tv-clone/packages/analytics-console/src/utils/emotePlotSelection.ts'
    )
    const keys = resolveChartEmoteKeys('auto', topEmotes, 'spikes')
    expect(Array.from(keys)).toEqual(['twitch:1:LUL', 'twitch:2:Kappa', 'seventv:3:KEKW'])
  })

  it('defaults to top 4 on emotes view', async () => {
    const { resolveChartEmoteKeys } = await import(
      '../../../twitch-7tv-clone/packages/analytics-console/src/utils/emotePlotSelection.ts'
    )
    const keys = resolveChartEmoteKeys('auto', topEmotes, 'emotes')
    expect(Array.from(keys)).toEqual(['twitch:1:LUL', 'twitch:2:Kappa', 'seventv:3:KEKW', 'twitch:4:Clap'])
  })

  it('allows clearing all plotted emotes', async () => {
    const { resolveChartEmoteKeys, toggleEmotePlotSelection } = await import(
      '../../../twitch-7tv-clone/packages/analytics-console/src/utils/emotePlotSelection.ts'
    )
    let selection = toggleEmotePlotSelection('auto', 'twitch:1:LUL', topEmotes, 'spikes')
    selection = toggleEmotePlotSelection(selection, 'twitch:2:Kappa', topEmotes, 'spikes')
    selection = toggleEmotePlotSelection(selection, 'seventv:3:KEKW', topEmotes, 'spikes')
    expect(selection).toBe('none')
    expect(resolveChartEmoteKeys(selection, topEmotes, 'spikes').size).toBe(0)
  })

  it('expands activity zone fraction when expanded', async () => {
    const { activityZoneFraction, activityBandFractions } = await import(
      '../../../twitch-7tv-clone/packages/analytics-console/src/utils/emotePlotSelection.ts'
    )
    expect(activityZoneFraction(false)).toBe(0.36)
    expect(activityZoneFraction(true)).toBe(0.56)
    expect(activityBandFractions(true).trace).toBeGreaterThan(activityBandFractions(false).trace)
    expect(activityBandFractions(false, true).trace).toBeGreaterThan(activityBandFractions(false, false).trace)
    const collapsedEmoteArea = activityZoneFraction(false) * activityBandFractions(false).bars
    const expandedEmoteArea = activityZoneFraction(true) * activityBandFractions(true).bars
    expect(expandedEmoteArea).toBeGreaterThan(collapsedEmoteArea * 1.35)
  })
})
