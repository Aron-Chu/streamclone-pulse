import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ExtensionPeak, ExtensionRollup, PulsePayload } from '../src/shared/messages.ts'
import { LiveStatsBand } from '../src/ui/LiveStatsBand.tsx'

const MINUTES = 40
const MOMENT_MINUTE = 30

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
    rollups: all.slice(-10),
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
    const row = featuredRow(render(false))
    expect(row).not.toContain('pulse-strength')
    expect(row).not.toContain('usual')
    expect(row).not.toContain('title="')
    expect(row).toContain('<span style="flex:1">Strongest loaded moment · 00:30:00</span>')
  })
})
