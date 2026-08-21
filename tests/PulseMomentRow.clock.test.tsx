import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { LiveHeatPoint } from '@streampulse/pulse-core'
import { PulseMomentRow } from '../src/ui/PulseMomentRow.tsx'

describe('PulseMomentRow clock honesty', () => {
  it('shows stream-offset clocks with formatHeatOffset (HH:MM:SS)', () => {
    const point: LiveHeatPoint = {
      minuteTs: '2026-08-10T22:20:52.000Z',
      offsetSeconds: 11045,
      precisionSeconds: 60,
      score: 46,
      estimated: false,
      reason: 'emote_spike',
      reasonLabel: 'Emote spike',
      chatCount: 343,
      emoteCount: 1648,
      collecting: false,
      topEmotes: [],
    }
    const markup = renderToStaticMarkup(
      <PulseMomentRow
        point={point}
        backendUrl="http://localhost:8081"
        selected={false}
        onSelect={vi.fn()}
        onHighlight={vi.fn()}
      />,
    )
    expect(markup).toContain('03:04:05')
    expect(markup).not.toContain('~03:04')
  })

  it('keeps selection-driven row fill instead of always-on card chrome', () => {
    const point: LiveHeatPoint = {
      minuteTs: '2026-08-10T22:20:52.000Z',
      offsetSeconds: 120,
      precisionSeconds: 60,
      score: 40,
      estimated: false,
      reason: 'emote_spike',
      reasonLabel: 'Emote spike',
      chatCount: 20,
      emoteCount: 40,
      collecting: false,
      topEmotes: [
        { key: 'Kappa', name: 'Kappa', id: '25', count: 4, imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0' },
      ],
    }
    const rest = renderToStaticMarkup(
      <PulseMomentRow
        point={point}
        backendUrl="http://localhost:8081"
        selected={false}
        onSelect={vi.fn()}
        onHighlight={vi.fn()}
      />,
    )
    expect(rest).not.toMatch(/pulse-moment-row-selected/)
    expect(rest).not.toMatch(/box-shadow:inset/)

    const selected = renderToStaticMarkup(
      <PulseMomentRow
        point={point}
        backendUrl="http://localhost:8081"
        selected
        onSelect={vi.fn()}
        onHighlight={vi.fn()}
      />,
    )
    expect(selected).toContain('pulse-moment-row-selected')
  })
})
