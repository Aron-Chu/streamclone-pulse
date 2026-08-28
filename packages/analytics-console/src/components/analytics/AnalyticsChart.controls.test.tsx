import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import type { AnalyticsStreamDetail } from '../../api.ts'
import type { AnalyticsViewMode } from './AnalyticsChart.tsx'
import AnalyticsChart from './AnalyticsChart.tsx'

vi.mock('../../hooks/useConsoleMotion.ts', () => ({
  useConsoleMotion: () => ({ motionEnabled: false }),
}))

const detail = {
  stream: {
    streamId: 'controls-chart-stream',
    startedAt: '2026-07-31T00:00:00.000Z',
    peakViewers: 200,
    avgViewers: 120,
  },
  rollups: [
    { minuteTs: '2026-07-31T00:00:00.000Z', viewerAvg: 100, chatCount: 10, totalEmoteCount: 2, emotes: { Kappa: 4, PogChamp: 1 } },
    { minuteTs: '2026-07-31T00:01:00.000Z', viewerAvg: 140, chatCount: 12, totalEmoteCount: 3, emotes: { Kappa: 7, PogChamp: 5 } },
  ],
  topEmotes: [
    { key: 'Kappa', name: 'Kappa', count: 11, provider: '7tv' },
    { key: 'PogChamp', name: 'PogChamp', count: 6, provider: 'twitch' },
  ],
  sources: [],
} as unknown as AnalyticsStreamDetail

afterEach(() => cleanup())

function Harness() {
  const [mode, setMode] = useState<AnalyticsViewMode>('overview')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  return (
    <AnalyticsChart
      detail={detail}
      selectedEmotes={selected}
      onSelectEmote={key => setSelected(current => {
        const next = new Set(current)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })}
      onClearEmotePlots={() => setSelected(new Set())}
      onResetEmotePlots={() => setSelected(new Set(['Kappa']))}
      selectedRollup={null}
      onSelectRollup={() => {}}
      viewMode={mode}
      onViewModeChange={setMode}
    />
  )
}

describe('AnalyticsChart unified controls', () => {
  it('renders one reversible spikes action and returns to overview', () => {
    const { container } = render(<Harness />)

    expect(screen.getAllByRole('button', { name: 'Show chart spikes' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Show chart spikes' }))
    expect(container.querySelector('[data-spikes-visible]')?.getAttribute('data-spikes-visible')).toBe('true')
    expect(screen.getByRole('button', { name: 'Hide chart spikes' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Hide chart spikes' }))
    expect(container.querySelector('[data-spikes-visible]')?.getAttribute('data-spikes-visible')).toBe('false')
    expect(screen.getByRole('button', { name: 'Show chart spikes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps cleared emote lanes empty across a mode change', () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: /emote overlays/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Plot Kappa on chart' }))
    expect(screen.getByRole('button', { name: 'Unplot Kappa on chart' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Clear emote lanes' }))
    expect(screen.getByRole('button', { name: 'Plot Kappa on chart' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /focus emotes\/min peak/i }))
    expect(screen.getByRole('button', { name: 'Plot Kappa on chart' })).toBeTruthy()
  })

  it('uses one focus bar and fades other lanes until the active focus is clicked again', () => {
    const { container } = render(<Harness />)
    const viewerFocus = screen.getByRole('button', { name: /focus viewers peak/i })
    const chatBar = container.querySelector<SVGRectElement>('[data-activity-bar="chat"]')
    const initialChatOpacity = Number(chatBar?.getAttribute('opacity'))

    fireEvent.click(viewerFocus)
    expect(viewerFocus.getAttribute('aria-pressed')).toBe('true')
    expect(Number(chatBar?.getAttribute('opacity'))).toBeLessThan(initialChatOpacity)
    expect(container.querySelectorAll('[data-chart-focus-bar]')).toHaveLength(1)

    fireEvent.click(viewerFocus)
    expect(viewerFocus.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps primary signals and utility actions visible above overlay focus', () => {
    const { container } = render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: /emote overlays/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Plot Kappa on chart' }))

    const primaryRow = container.querySelector('[data-chart-primary-focus-row]')
    const utilityRow = container.querySelector('[data-chart-focus-utilities]')
    const overlayRow = container.querySelector('[data-chart-overlay-focus-row]')
    expect(primaryRow?.textContent).toContain('Overview')
    expect(primaryRow?.textContent).not.toContain('Kappa')
    expect(utilityRow?.textContent).toContain('Spikes')
    expect(utilityRow?.textContent).toContain('Expand')
    expect(overlayRow?.textContent).toContain('Kappa')

    const kappaFocus = screen.getByRole('button', { name: /focus kappa peak/i })
    fireEvent.click(kappaFocus)
    expect(kappaFocus.getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps Emote overlays compact until explicitly expanded', () => {
    render(<Harness />)

    const disclosure = screen.getByRole('button', { name: /emote overlays/i })
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Plot Kappa on chart' })).toBeNull()

    fireEvent.click(disclosure)
    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: 'Plot Kappa on chart' })).toBeTruthy()
  })
})
