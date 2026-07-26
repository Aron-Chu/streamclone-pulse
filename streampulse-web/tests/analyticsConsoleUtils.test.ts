import { describe, expect, it } from 'vitest'
import {
  isDateSlugUnresolved,
  resolveMatchedStream,
  resolveTargetQueryStreamId,
} from '@streampulse/analytics-console/utils/streamRouteResolution'
import {
  streamHasSyncedMinutes,
  streamSyncBadgeState,
  streamSyncBadgeLabel,
} from '@streampulse/analytics-console/utils/syncedLiveStream'
import type { AnalyticsStream } from '@streampulse/analytics-console/apiTypes'

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

describe('displayStreamTitle', () => {
  it('never surfaces Syncing... placeholders as the stream title', async () => {
    const { displayStreamTitle } = await import('@streampulse/analytics-console/utils/consoleFormat')
    expect(
      displayStreamTitle(
        {
          streamId: '1',
          login: 'xqc',
          startedAt: '2026-07-10T01:00:00Z',
          title: 'Syncing...',
        },
        'xqc',
        ['Untitled stream'],
      ),
    ).toBe('Untitled stream')
    expect(
      displayStreamTitle(
        {
          streamId: '1',
          login: 'xqc',
          startedAt: '2026-07-10T01:00:00Z',
          title: '🐆LIVE🐆LOCK IN🐆',
        },
        'xqc',
      ),
    ).toBe('🐆LIVE🐆LOCK IN🐆')
  })
})

describe('resolveCanonicalLiveSessionTarget', () => {
  it('prefers synced row matching live stream id', async () => {
    const { resolveCanonicalLiveSessionTarget } = await import(
      '@streampulse/analytics-console/utils/syncedLiveStream'
    )
    const target = resolveCanonicalLiveSessionTarget(sampleStreams, {
      liveStreamId: '12345',
      channelLive: true,
    })
    expect(target?.streamId).toBe('12345')
  })

  it('does not borrow another sidebar stream when current live row has no vod', async () => {
    const { resolveCanonicalLiveSessionTarget } = await import(
      '@streampulse/analytics-console/utils/syncedLiveStream'
    )
    const target = resolveCanonicalLiveSessionTarget(
      [
        { streamId: '222', login: 'x', startedAt: '2026-07-08T10:00:00Z', viewerSamples: 10, chatMessages: 10 },
        { streamId: '111', login: 'x', startedAt: '2026-07-08T12:00:00Z', viewerSamples: 0, chatMessages: 0 },
      ],
      {
        liveStreamId: '999',
        channelLive: true,
        channelLogin: 'x',
        startedAt: '2026-07-08T14:00:00Z',
      },
    )
    expect(target?.streamId).toBe('999')
  })
})

// resolveCanonicalSessionSlug was removed from analytics-console; live-route slug
// redirects are covered by integration/e2e. Drop unit block until API is restored.

describe('emotePlotSelection', () => {
  const topEmotes = [
    { key: 'twitch:1:LUL' },
    { key: 'twitch:2:Kappa' },
    { key: 'seventv:3:KEKW' },
    { key: 'twitch:4:Clap' },
  ]

  it('defaults to top 3 on spikes view', async () => {
    const { resolveChartEmoteKeys } = await import(
      '@streampulse/analytics-console/utils/emotePlotSelection'
    )
    const keys = resolveChartEmoteKeys('auto', topEmotes, 'spikes')
    expect(Array.from(keys)).toEqual(['twitch:1:LUL', 'twitch:2:Kappa', 'seventv:3:KEKW'])
  })

  it('defaults to top 4 on emotes view', async () => {
    const { resolveChartEmoteKeys } = await import(
      '@streampulse/analytics-console/utils/emotePlotSelection'
    )
    const keys = resolveChartEmoteKeys('auto', topEmotes, 'emotes')
    expect(Array.from(keys)).toEqual(['twitch:1:LUL', 'twitch:2:Kappa', 'seventv:3:KEKW', 'twitch:4:Clap'])
  })

  it('allows clearing all plotted emotes', async () => {
    const { resolveChartEmoteKeys, toggleEmotePlotSelection } = await import(
      '@streampulse/analytics-console/utils/emotePlotSelection'
    )
    let selection = toggleEmotePlotSelection('auto', 'twitch:1:LUL', topEmotes, 'spikes')
    selection = toggleEmotePlotSelection(selection, 'twitch:2:Kappa', topEmotes, 'spikes')
    selection = toggleEmotePlotSelection(selection, 'seventv:3:KEKW', topEmotes, 'spikes')
    expect(selection).toBe('none')
    expect(resolveChartEmoteKeys(selection, topEmotes, 'spikes').size).toBe(0)
  })

  it('expands activity zone fraction when expanded', async () => {
    const { activityZoneFraction, activityBandFractions } = await import(
      '@streampulse/analytics-console/utils/emotePlotSelection'
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
