import { describe, expect, it } from 'vitest'
import { buildSelectedMomentDisplay } from '@streampulse/analytics-console/utils/selectedMomentDisplay'
import type { AnalyticsMinuteRollup } from '@streampulse/analytics-console/apiTypes'

const rollup: AnalyticsMinuteRollup = {
  minuteTs: '2026-07-04T04:05:00.000Z',
  chatCount: 589,
  totalEmoteCount: 115,
  emotes: { KEKW: 29, PepeHands: 16 },
}

describe('buildSelectedMomentDisplay', () => {
  it('formats activity line and offset without ?t= when alignment is unverified', () => {
    const display = buildSelectedMomentDisplay({
      rollup,
      rollups: [rollup],
      startedAt: '2026-07-04T00:00:00.000Z',
      vodLinkState: { status: 'linked', label: 'Open VOD', vodId: '123456789', detail: '' },
    })
    expect(display.activityLine).toBe('589 chat · 115 emotes')
    expect(display.offsetSeconds).toBe(14_700)
    expect(display.offsetStr).toBe('4h5m0s')
    expect(display.vodUrl).toContain('123')
    expect(display.vodUrl).not.toContain('t=')
  })

  it('adds ?t= only when vodAlignSeconds is verified', () => {
    const display = buildSelectedMomentDisplay({
      rollup,
      rollups: [rollup],
      startedAt: '2026-07-04T00:00:00.000Z',
      vodLinkState: { status: 'linked', label: 'Open VOD', vodId: '123456789', detail: '' },
      vodAlignSeconds: 0,
    })
    expect(display.vodUrl).toContain('t=4h5m0s')
  })
})

describe('emote plot cap', () => {
  const topEmotes = [
    { key: 'twitch:1:LUL' },
    { key: 'twitch:2:Kappa' },
    { key: 'seventv:3:KEKW' },
    { key: 'twitch:4:Clap' },
    { key: 'twitch:5:Pog' },
    { key: 'twitch:6:MonkaS' },
    { key: 'twitch:7:EZ' },
  ]

  it('allows up to six plotted emotes', async () => {
    const { MAX_PLOTTED_EMOTES, toggleEmotePlotSelection, resolveChartEmoteKeys } = await import(
      '@streampulse/analytics-console/utils/emotePlotSelection'
    )
    expect(MAX_PLOTTED_EMOTES).toBe(6)
    let selection = toggleEmotePlotSelection('none', 'twitch:1:LUL', topEmotes, 'spikes')
    for (const key of ['twitch:2:Kappa', 'seventv:3:KEKW', 'twitch:4:Clap', 'twitch:5:Pog', 'twitch:6:MonkaS']) {
      selection = toggleEmotePlotSelection(selection, key, topEmotes, 'spikes')
    }
    expect(resolveChartEmoteKeys(selection, topEmotes, 'spikes').size).toBe(6)
    const blocked = toggleEmotePlotSelection(selection, 'twitch:7:EZ', topEmotes, 'spikes')
    expect(resolveChartEmoteKeys(blocked, topEmotes, 'spikes').size).toBe(6)
  })
})
