import { describe, expect, it } from 'vitest'
import type { ExtensionRollup, PulsePayload } from '../src/shared/messages.ts'
import {
  formatCount,
  formatUptime,
  notChartedNote,
  popupShowsDeviceHistory,
  popupTabView,
  safeImageUrl,
  sparkGeometry,
  summarizeChannel,
} from '../src/popup/popupModel.ts'

const NOW = Date.parse('2026-10-02T20:00:00.000Z')

function rollup(minute: number, chatCount: number, extra: Partial<ExtensionRollup> = {}): ExtensionRollup {
  return { offsetSeconds: minute * 60, chatCount, sevenTvEmoteCount: 0, ...extra }
}

function livePayload(overrides: Partial<PulsePayload> = {}): PulsePayload {
  return {
    login: 'fixturechan',
    isLive: true,
    tracking: true,
    startedAt: '2026-10-02T17:00:00.000Z',
    category: 'Just Chatting',
    currentOffsetSeconds: 120 * 60,
    rollups: [rollup(118, 900, { viewerCount: 41_200, viewerSamples: 1 }), rollup(119, 1_000), rollup(120, 1_240)],
    lanes: {} as PulsePayload['lanes'],
    recap: null,
    ...overrides,
  }
}

describe('popup tab view', () => {
  it('recognises channel pages and lowercases the login', () => {
    expect(popupTabView('https://www.twitch.tv/xQc')).toEqual({ kind: 'channel', login: 'xqc' })
    expect(popupTabView('https://twitch.tv/some_streamer/videos')).toEqual({ kind: 'channel', login: 'some_streamer' })
  })
  it('treats Twitch product pages as browsing and other sites as elsewhere', () => {
    expect(popupTabView('https://www.twitch.tv/directory/following')).toEqual({ kind: 'browsing' })
    expect(popupTabView('https://www.twitch.tv/videos/2806037629?t=1h2m3s')).toEqual({ kind: 'vod', vodId: '2806037629' })
    expect(popupTabView('https://www.twitch.tv/videos')).toEqual({ kind: 'browsing' })
    expect(popupTabView('https://www.twitch.tv/')).toEqual({ kind: 'browsing' })
    expect(popupTabView('https://www.twitch.tv/not-a-login')).toEqual({ kind: 'browsing' })
    expect(popupTabView('https://example.com/xqc')).toEqual({ kind: 'elsewhere' })
    expect(popupTabView('http://www.twitch.tv/xqc')).toEqual({ kind: 'elsewhere' })
    expect(popupTabView('chrome-extension://abc/popup/index.html')).toEqual({ kind: 'elsewhere' })
    expect(popupTabView(undefined)).toEqual({ kind: 'elsewhere' })
  })
})

describe('popup device history', () => {
  it('asks for Jump back in only away from a stream in a regular window', () => {
    expect(popupShowsDeviceHistory({ kind: 'elsewhere' }, false)).toBe(true)
    expect(popupShowsDeviceHistory({ kind: 'browsing' }, false)).toBe(true)
    expect(popupShowsDeviceHistory({ kind: 'channel', login: 'fixturechan' }, false)).toBe(false)
    expect(popupShowsDeviceHistory({ kind: 'vod', vodId: '2806037629' }, false)).toBe(false)
  })

  it('never shows this profile\'s history or saves in a private window', () => {
    expect(popupShowsDeviceHistory({ kind: 'elsewhere' }, true)).toBe(false)
    expect(popupShowsDeviceHistory({ kind: 'browsing' }, true)).toBe(false)
  })

  it('treats a window it could not identify as private', () => {
    expect(popupShowsDeviceHistory({ kind: 'elsewhere' }, undefined)).toBe(false)
    expect(popupShowsDeviceHistory({ kind: 'browsing' }, undefined)).toBe(false)
  })
})

describe('popup channel summary', () => {
  it('reports live viewers, the latest chat minute, uptime and the top emote', () => {
    const summary = summarizeChannel('fixturechan', livePayload({
      topEmotes: [{ name: 'KEKW', count: 312, imageUrl: 'https://cdn.7tv.app/emote/abc/1x.webp' }],
    }), { login: 'fixturechan', displayName: 'FixtureChan', coverageTier: 'active', hostedCap: { activeLimit: 1, activeCount: 0, activeAvailable: true } }, NOW)
    expect(summary).toMatchObject({
      displayName: 'FixtureChan',
      isLive: true,
      tracked: true,
      category: 'Just Chatting',
      uptime: '3h 0m',
      viewers: 41_200,
      chatPerMinute: 1_240,
      topEmote: { name: 'KEKW', count: 312, imageUrl: 'https://cdn.7tv.app/emote/abc/1x.webp' },
    })
    expect(summary.spark).toEqual([900, 1_000, 1_240])
  })

  it('breaks the live sparkline at minutes Pulse did not see instead of drawing zeros', () => {
    const summary = summarizeChannel('fixturechan', livePayload({
      rollups: [rollup(116, 400), rollup(117, 0, { missing: true }), rollup(119, 600), rollup(120, 700)],
    }), null, NOW)
    expect(summary.spark).toEqual([400, null, null, 600, 700])
  })

  it('drops viewers older than five minutes and chat older than three', () => {
    const summary = summarizeChannel('fixturechan', livePayload({
      rollups: [rollup(100, 900, { viewerCount: 5_000, viewerSamples: 1 }), rollup(116, 800)],
    }), null, NOW)
    expect(summary.viewers).toBeNull()
    expect(summary.chatPerMinute).toBeNull()
  })

  // Two hours of minutes, so the live list is past its cold start.
  const liveMinutes = Array.from({ length: 121 }, (_, minute) => rollup(minute, 50))
  const chatPeak = (minute: number, score: number, extra: object = {}) =>
    ({ offsetSeconds: minute * 60, score, reasons: ['chat_spike'], dominantSignal: 'chat', chatCount: 400, ...extra })

  it('shows the panel’s #1 moment, never a viewer-only spike the panel does not list (M)', () => {
    const summary = summarizeChannel('fixturechan', livePayload({
      rollups: liveMinutes,
      peaks: [
        { offsetSeconds: 100 * 60, score: 96, reasons: ['viewer_spike'], dominantSignal: 'viewers' },
        chatPeak(45, 91),
      ],
    }), null, NOW)
    expect(summary.topMoment).toEqual({ label: 'Chat spike', clock: '0:45:00', approximate: true, edge: '' })
  })

  it('writes the second when the moment knows it, with no about (K1)', () => {
    const refined = chatPeak(45, 91, { reactionOnsetOffsetSeconds: 45 * 60 + 13, precisionSeconds: 5, refinementStatus: 'refined' })
    expect(summarizeChannel('fixturechan', livePayload({ rollups: liveMinutes, peaks: [refined] }), null, NOW).topMoment)
      .toMatchObject({ clock: '0:45:13', approximate: false })
  })

  it('gives a tied score to the earlier moment whatever order the peaks arrive in', () => {
    const earlier = chatPeak(60, 55)
    const later = chatPeak(100, 55)
    for (const peaks of [[earlier, later], [later, earlier]]) {
      expect(summarizeChannel('fixturechan', livePayload({ rollups: liveMinutes, peaks }), null, NOW).topMoment?.clock).toBe('1:00:00')
    }
  })

  it('ranks a hello spike last, and tags it Stream start when nothing else ranked (E1)', () => {
    const hello = { offsetSeconds: 60, score: 99, reasons: ['emote_spike'], dominantSignal: 'seventv', emoteCount: 300 }
    expect(summarizeChannel('fixturechan', livePayload({ rollups: liveMinutes, peaks: [hello, chatPeak(60, 40)] }), null, NOW).topMoment)
      .toMatchObject({ clock: '1:00:00', edge: '' })
    expect(summarizeChannel('fixturechan', livePayload({ rollups: liveMinutes, peaks: [hello] }), null, NOW).topMoment)
      .toEqual({ label: 'Emote spike', clock: '0:01:00', approximate: true, edge: 'Stream start' })
  })

  it('takes the recap’s #1 once the stream ends, ranking a goodbye spike last', () => {
    const rollups = Array.from({ length: 96 }, (_, minute) => rollup(minute, 20))
    const goodbye = { offsetSeconds: 94 * 60, score: 99, reasons: ['emote_spike'], dominantSignal: 'seventv', emoteCount: 300 }
    const ended = (peaks: object[]) => livePayload({ isLive: false, endedAt: '2026-10-01T20:00:00.000Z', rollups: [], fullRollups: rollups, peaks } as Partial<PulsePayload>)
    expect(summarizeChannel('fixturechan', ended([goodbye, chatPeak(50, 40)]), null, NOW).topMoment).toMatchObject({ clock: '0:50:00', edge: '' })
    expect(summarizeChannel('fixturechan', ended([goodbye]), null, NOW).topMoment).toMatchObject({ clock: '1:34:00', edge: 'Stream end' })
  })

  it('summarises a finished stream across its whole length', () => {
    const rollups = Array.from({ length: 96 }, (_, minute) => rollup(minute, minute % 2 ? 10 : 30))
    const summary = summarizeChannel('fixturechan', livePayload({
      isLive: false,
      endedAt: '2026-10-01T20:00:00.000Z',
      durationSeconds: 96 * 60,
      rollups: [],
      fullRollups: rollups,
      peaks: [{ offsetSeconds: 3_600, score: 70, reasons: ['chat_spike'], dominantSignal: 'chat' }],
    }), null, NOW)
    expect(summary.isLive).toBe(false)
    expect(summary.viewers).toBeNull()
    expect(summary.uptime).toBeNull()
    expect(summary.spark).toHaveLength(48)
    expect(summary.spark.every(value => value === 20)).toBe(true)
    expect(summary.sparkMinutes).toBe(96)
    expect(summary.endedAt).toBe(Date.parse('2026-10-01T20:00:00.000Z'))
    expect(summary.topMoment).toEqual({ label: 'Chat spike', clock: '1:00:00', approximate: true, edge: '' })
  })

  it('falls back to fresh Helix viewers when no recent minute has a sample', () => {
    const coverage = { login: 'fixturechan', coverageTier: 'active', hostedCap: { activeLimit: 1, activeCount: 0, activeAvailable: true } }
    const payload = livePayload({ rollups: [rollup(120, 50)] })
    expect(summarizeChannel('fixturechan', payload, { ...coverage, liveMetadata: { isLive: true, viewerCount: 1_200 } }, NOW).viewers).toBe(1_200)
    expect(summarizeChannel('fixturechan', payload, { ...coverage, liveMetadata: { isLive: true, viewerCount: 1_200, freshnessSeconds: 900 } }, NOW).viewers).toBeNull()
  })

  it('marks channels outside the hosted roster and survives a missing payload', () => {
    expect(summarizeChannel('fixturechan', livePayload({ rosterEligible: false }), null, NOW).tracked).toBe(false)
    expect(summarizeChannel('fixturechan', null, null, NOW)).toMatchObject({ displayName: 'fixturechan', isLive: false, spark: [], topMoment: null })
  })

  it('says why a channel off the list has no chart, and stays quiet otherwise', () => {
    expect(notChartedNote(summarizeChannel('fixturechan', livePayload({ rosterEligible: false }), null, NOW))).toEqual({
      title: 'Not charted',
      reason: 'StreamPulse only charts Twitch’s busiest channels.',
    })
    expect(notChartedNote(summarizeChannel('fixturechan', livePayload(), null, NOW))).toBeNull()
    expect(notChartedNote(summarizeChannel('fixturechan', null, null, NOW))).toBeNull()
    expect(notChartedNote(null)).toBeNull()
  })

  it('never renders emote images from hosts the extension does not trust', () => {
    const summary = summarizeChannel('fixturechan', livePayload({
      topEmotes: [{ name: 'Zero', count: 0 }, { name: 'Sus', count: 5, imageUrl: 'https://evil.example/e.png' }],
    }), null, NOW)
    expect(summary.topEmote).toEqual({ name: 'Sus', count: 5, imageUrl: null })
    expect(safeImageUrl('http://static-cdn.jtvnw.net/a.png')).toBeNull()
    expect(safeImageUrl('https://static-cdn.jtvnw.net/jtv_user_pictures/a.png')).toBe('https://static-cdn.jtvnw.net/jtv_user_pictures/a.png')
  })
})

describe('popup formatting', () => {
  it('formats counts and uptime', () => {
    expect(formatCount(1_240)).toBe('1,240')
    expect(formatCount(41_200)).toBe('41.2K')
    expect(formatUptime('2026-10-02T19:15:00.000Z', NOW)).toBe('45m')
    expect(formatUptime('2026-09-29T19:15:00.000Z', NOW)).toBeNull()
  })
})

describe('sparkline geometry', () => {
  it('draws one run per contiguous stretch and closes each area to the baseline', () => {
    const geometry = sparkGeometry([10, 20, null, 5, 10], 104, 22, 2)
    expect(geometry.line).toBe('M2 11L27 2M77 15.5L102 11')
    expect(geometry.area).toBe('M2 20L2 11L27 2L27 20ZM77 20L77 15.5L102 11L102 20Z')
    expect(geometry.last).toEqual({ x: 102, y: 11 })
  })
  it('gives a lone minute a visible stroke and handles empty input', () => {
    expect(sparkGeometry([null, 4, null], 10, 10, 0).line).toBe('M4 0L6 0')
    expect(sparkGeometry([], 10, 10)).toEqual({ line: '', area: '', last: null })
    expect(sparkGeometry([null], 10, 10)).toEqual({ line: '', area: '', last: null })
  })
})
