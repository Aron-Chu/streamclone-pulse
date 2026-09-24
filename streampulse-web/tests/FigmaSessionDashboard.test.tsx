import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { FigmaSessionDashboard } from '../src/ui/components/analytics/FigmaSessionDashboard'
import type { FigmaSessionViewModel } from '../src/lib/figmaSessionAnalytics'

function readyModel(): FigmaSessionViewModel {
  return {
    state: 'ready',
    login: 'xqc',
    displayName: 'xQc',
    streamId: 'stream-1',
    vodId: 'vod-1',
    moments: [
      { offsetSeconds: 60, score: 70, label: 'First peak', login: 'xqc', streamId: 'stream-1' },
      { offsetSeconds: 300, score: 90, label: 'Second peak', login: 'xqc', streamId: 'stream-1' },
    ],
    chartPoints: [
      { offsetSeconds: 0, chatNorm: 10, viewersNorm: 10, emotesNorm: 10, heat: 20 },
      { offsetSeconds: 60, chatNorm: 40, viewersNorm: 30, emotesNorm: 50, heat: 70 },
      { offsetSeconds: 120, chatNorm: 25, viewersNorm: 35, emotesNorm: 30, heat: 55 },
      { offsetSeconds: 300, chatNorm: 80, viewersNorm: 70, emotesNorm: 60, heat: 90 },
    ],
    bursts: [{ code: 'KEKW', count: 42, peakOffset: '00:00', peakOffsetSeconds: 0 }],
    coverageTruth: [],
  }
}

describe('FigmaSessionDashboard chart selection', () => {
  it('snaps chart End key to the nearest backend moment row', () => {
    const { container } = render(<MemoryRouter><FigmaSessionDashboard model={readyModel()} /></MemoryRouter>)
    const wrap = container.querySelector('.figma-chart__svg-wrap') as HTMLElement
    wrap.focus()
    fireEvent.keyDown(wrap, { key: 'End' })
    const activeRow = container.querySelector('tr.is-active')
    expect(activeRow?.textContent).toContain('Second peak')
  })

  it('keeps exact table selection when its exact-identity review link is clicked', () => {
    render(<MemoryRouter><FigmaSessionDashboard model={readyModel()} /></MemoryRouter>)
    const review = screen.getByRole('link', { name: '5:00' })
    expect(review.getAttribute('href')).toBe('/analytics/moments?view=recent&login=xqc&stream=stream-1&offset=300')
    fireEvent.click(review)
    const activeRow = document.querySelector('tr.is-active')
    expect(activeRow?.textContent).toContain('Second peak')
  })

  it('plots bursts anchored at stream start', () => {
    render(<MemoryRouter><FigmaSessionDashboard model={readyModel()} /></MemoryRouter>)
    fireEvent.click(screen.getByTitle('Plot KEKW on chart'))
    expect(screen.getByText('KEKW @ 00:00')).toBeTruthy()
  })
})
