import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ExtensionPeak, ExtensionRollup, PulsePayload } from '../src/shared/messages.ts'
import { LiveStatsBand } from '../src/ui/LiveStatsBand.tsx'
import { momentStrength } from '../src/ui/momentStrength.ts'
import { shadowStyles } from '../src/ui/theme.ts'

const MINUTES = 40
const MOMENT_MINUTE = 30
// The recent window alone (minutes 16 to 40) holds the moment and 14 measured
// minutes before it, enough for a pill of its own. Only the full-history guard
// can keep the row plain until the validated timeline arrives.
const RECENT_MINUTES = 25

function rollup(index: number): ExtensionRollup {
  return {
    offsetSeconds: index * 60,
    chatCount: index === MOMENT_MINUTE ? 168 : 40,
    sevenTvEmoteCount: 4,
    totalEmoteCount: 10,
  }
}

const peak: ExtensionPeak = {
  offsetSeconds: MOMENT_MINUTE * 60,
  score: 95,
  reasons: ['chat_spike'],
  reasonLabel: 'Chat spike',
  dominantSignal: 'chat',
  // The peak's own counts disagree with its minute; the pill reads the minute.
  chatCount: 900,
  emoteCount: 3,
}

function payload(withFullHistory: boolean): PulsePayload {
  const all = Array.from({ length: MINUTES + 1 }, (_, i) => rollup(i))
  return {
    login: 'test',
    streamId: 'stream-1',
    isLive: true,
    tracking: true,
    currentOffsetSeconds: MINUTES * 60,
    coverageStartOffsetSeconds: 0,
    startedAt: '2026-06-11T12:00:00.000Z',
    rollups: all.slice(-RECENT_MINUTES),
    ...(withFullHistory ? { fullRollups: all } : {}),
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
    peaks: [peak],
    topEmotes: [{ id: '1', name: 'KEKW', count: 12 }],
  }
}

function featuredRow(markup: string): string {
  const start = markup.indexOf('data-featured-moment="true"')
  expect(start).toBeGreaterThan(-1)
  return markup.slice(start, markup.indexOf('</button>', start))
}

function render(withFullHistory: boolean): string {
  return renderToStaticMarkup(
    <LiveStatsBand
      payload={payload(withFullHistory)}
      backendUrl="https://api.example.test"
      currentOffsetSeconds={MINUTES * 60}
      onMomentSelect={vi.fn()}
    />,
  )
}

/** Declarations of the single shadow-style rule whose selector is `selector`. */
function shadowRule(selector: string): Record<string, string> {
  const rules = [...shadowStyles.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, head]) => head.split(',').some(part => part.trim() === selector))
  expect(rules).toHaveLength(1)
  return Object.fromEntries(rules[0][2].split(';').map(d => d.split(':').map(v => v.trim())).filter(([k, v]) => k && v))
}

describe('Live now strongest moment strength pill', () => {
  it('shows "<N>× usual" under the time once validated full history is loaded', () => {
    const row = featuredRow(render(true))
    expect(row).toContain('class="pulse-strength-two"')
    expect(row).toContain('Strongest loaded moment · 00:30:00')
    // 168 in the moment minute over the 30 minutes before it at 40 a minute.
    expect(row).toMatch(/<span class="pulse-strength-pill" data-lvl="3">4\.2× usual<\/span>/)
    expect(row).toContain('title="168 chats in the minute at 00:30:00. The 30 measured minutes before it averaged 40 a minute."')
  })

  it('keeps the plain row until full history is loaded, so the number never jumps', () => {
    // The recent rollups by themselves would already give a pill, so a plain
    // row here proves the guard held it back rather than missing data.
    const recentOnly = momentStrength(payload(false).rollups, peak)
    expect(recentOnly).not.toBeNull()
    expect(recentOnly).toMatchObject({ label: '4.2×', minutes: 14 })
    const row = featuredRow(render(false))
    expect(row).not.toContain('pulse-strength')
    expect(row).not.toContain('usual')
    expect(row).not.toContain('title="')
    expect(row).toContain('<span style="flex:1">Strongest loaded moment · 00:30:00</span>')
  })

  it('passes the chat coverage, so viewer-only minutes before a late chat join are not a quiet usual', () => {
    // Chat joined at 00:25; the backend still sent viewer-only rows from 00:00
    // and reports 00:00-00:24 as missing chat. Five chat minutes precede the
    // moment, under the 10-minute minimum, so the row stays plain.
    const lateJoin = payload(true)
    const viewerOnly = (row: ExtensionRollup): ExtensionRollup => row.offsetSeconds < 25 * 60
      ? { ...row, chatCount: 0, sevenTvEmoteCount: 0, totalEmoteCount: 0, viewerCount: 4200, viewerSamples: 3 }
      : row
    lateJoin.fullRollups = lateJoin.fullRollups!.map(viewerOnly)
    lateJoin.rollups = lateJoin.rollups.map(viewerOnly)
    lateJoin.coverage = {
      state: 'waiting_for_vod',
      coverageStartOffsetSeconds: 25 * 60,
      coverageEndOffsetSeconds: MINUTES * 60,
      hasFullStreamCoverage: false,
      trackedFromStart: false,
      hasGaps: true,
      missingRanges: [{ fromOffsetSeconds: 0, toOffsetSeconds: 24 * 60 }],
      canBackfill: false,
      message: 'VOD chat not available yet',
    }
    // Read as quiet minutes, the 25 empty rows would make 168 look like 10×+.
    expect(momentStrength(lateJoin.fullRollups, peak)?.label).toBe('10×+')
    const row = featuredRow(renderToStaticMarkup(
      <LiveStatsBand
        payload={lateJoin}
        backendUrl="https://api.example.test"
        currentOffsetSeconds={MINUTES * 60}
        onMomentSelect={vi.fn()}
      />,
    ))
    expect(row).toContain('Strongest loaded moment · 00:30:00')
    expect(row).not.toContain('pulse-strength')
    expect(row).not.toContain('usual')
  })

  it('keeps the time line to one line, so a narrow or compact panel cannot grow the row', () => {
    // The chip sets white-space: normal; a wrapped first line would stack the
    // pill under two 12px lines (50px). It ellipsizes instead.
    expect(shadowRule('.pulse-strength-two > :first-child')).toMatchObject({
      overflow: 'hidden',
      'text-overflow': 'ellipsis',
      'white-space': 'nowrap',
    })
    expect(shadowRule('.pulse-strength-two')).toMatchObject({ 'line-height': '12px', 'min-width': '0' })
  })
})
