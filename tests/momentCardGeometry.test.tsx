import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { LiveHeatPoint } from '@streampulse/pulse-core'
import { MomentInspectionTray } from '../src/ui/MomentInspectionTray.tsx'
import { SelectedMomentCard } from '../src/ui/SelectedMomentCard.tsx'
import { MOMENT_CARD_HEIGHT } from '../src/ui/momentCardLayout.ts'

const point: LiveHeatPoint = {
  minuteTs: '2026-08-15T12:00:00.000Z',
  offsetSeconds: 84,
  score: 80,
  estimated: true,
  reason: 'chat_spike',
  reasonLabel: 'Chat spike',
  chatCount: 705,
  emoteCount: 321,
  viewerCount: 64_900,
  collecting: false,
  topEmotes: [
    { key: 'a', name: 'VeryLongEmoteName', count: 70 },
    { key: 'b', name: 'AnotherLongEmoteName', count: 48 },
    { key: 'c', name: 'ThirdLongEmoteName', count: 40 },
  ],
}

function renderCard(mode: 'preview' | 'selected') {
  return renderToStaticMarkup(
    <SelectedMomentCard
      point={point}
      mode={mode}
      backendUrl="http://localhost:8081"
      onJump={vi.fn()}
      onAnalytics={vi.fn()}
    />,
  )
}

describe('moment card geometry contract', () => {
  it('keeps preview content and its selection footer inside the fixed card', () => {
    const markup = renderCard('preview')
    expect(markup).toContain(`height:${MOMENT_CARD_HEIGHT}px`)
    expect(markup).not.toContain('height:132px')
    expect(markup).toContain('Click to select this moment')
    expect(markup).toContain('justify-self:end')
  })

  it('uses the same minimum height for selected and idle states', () => {
    const selected = renderCard('selected')
    const idle = renderToStaticMarkup(<MomentInspectionTray />)
    expect(selected).toContain(`min-height:${MOMENT_CARD_HEIGHT}px`)
    expect(idle).toContain(`min-height:${MOMENT_CARD_HEIGHT}px`)
    expect(idle).toContain('Select a moment')
  })

  it('gives preview names their own row instead of shrinking beside usage counts', () => {
    const markup = renderCard('preview')
    expect(markup).toContain('grid-template-columns:minmax(0, 1fr)')
    expect(markup).toContain('VeryLongEmoteName')
    expect(markup).toContain('70 uses')
  })
})
