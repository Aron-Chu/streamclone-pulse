import { describe, expect, it } from 'vitest'
import type { ExtensionRollup, PulsePayload } from '../src/shared/messages.ts'
import {
  formatAgo,
  formatClock,
  formatCount,
  formatSince,
  formatUptime,
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

  it('picks the highest-scoring peak and says how long ago it was on a live stream', () => {
    const summary = summarizeChannel('fixturechan', livePayload({
      peaks: [
        { offsetSeconds: 60 * 60, score: 40, reasons: [], dominantSignal: 'chat' },
        { offsetSeconds: 102 * 60, seekOffsetSeconds: 101 * 60 + 50, score: 90, reasons: [], dominantSignal: 'chat', reasonLabel: 'Peak chat' },
      ],
    }), null, NOW)
    expect(summary.biggest).toEqual({ label: 'Peak chat', offsetSeconds: 101 * 60 + 50, agoSeconds: 18 * 60 + 10 })
  })

  it('summarises a finished stream across its whole length', () => {
    const rollups = Array.from({ length: 96 }, (_, minute) => rollup(minute, minute % 2 ? 10 : 30))
    const summary = summarizeChannel('fixturechan', livePayload({
      isLive: false,
      endedAt: '2026-10-01T20:00:00.000Z',
      durationSeconds: 96 * 60,
      rollups: [],
      fullRollups: rollups,
      peaks: [{ offsetSeconds: 3_600, score: 70, reasons: [], dominantSignal: 'chat' }],
    }), null, NOW)
    expect(summary.isLive).toBe(false)
    expect(summary.viewers).toBeNull()
    expect(summary.uptime).toBeNull()
    expect(summary.spark).toHaveLength(48)
    expect(summary.spark.every(value => value === 20)).toBe(true)
    expect(summary.sparkMinutes).toBe(96)
    expect(summary.endedAt).toBe(Date.parse('2026-10-01T20:00:00.000Z'))
    expect(summary.biggest).toEqual({ label: 'Chat spike', offsetSeconds: 3_600, agoSeconds: null })
  })

  it('falls back to fresh Helix viewers when no recent minute has a sample', () => {
    const coverage = { login: 'fixturechan', coverageTier: 'active', hostedCap: { activeLimit: 1, activeCount: 0, activeAvailable: true } }
    const payload = livePayload({ rollups: [rollup(120, 50)] })
    expect(summarizeChannel('fixturechan', payload, { ...coverage, liveMetadata: { isLive: true, viewerCount: 1_200 } }, NOW).viewers).toBe(1_200)
    expect(summarizeChannel('fixturechan', payload, { ...coverage, liveMetadata: { isLive: true, viewerCount: 1_200, freshnessSeconds: 900 } }, NOW).viewers).toBeNull()
  })

  it('marks channels outside the hosted roster and survives a missing payload', () => {
    expect(summarizeChannel('fixturechan', livePayload({ rosterEligible: false }), null, NOW).tracked).toBe(false)
    expect(summarizeChannel('fixturechan', null, null, NOW)).toMatchObject({ displayName: 'fixturechan', isLive: false, spark: [], biggest: null })
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
  it('formats counts, clocks and relative times', () => {
    expect(formatCount(1_240)).toBe('1,240')
    expect(formatCount(41_200)).toBe('41.2K')
    expect(formatClock(2 * 3600 + 41 * 60 + 5)).toBe('2:41:05')
    expect(formatClock(75)).toBe('1:15')
    expect(formatAgo(30)).toBe('just now')
    expect(formatAgo(18 * 60)).toBe('18m ago')
    expect(formatAgo(80 * 60)).toBe('1h 20m ago')
    expect(formatSince(NOW - 90 * 60_000, NOW)).toBe('1 h ago')
    expect(formatSince(NOW - 26 * 3_600_000, NOW)).toBe('yesterday')
    expect(formatSince(NOW - 4 * 86_400_000, NOW)).toBe('4 days ago')
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
