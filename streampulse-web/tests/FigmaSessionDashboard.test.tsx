import { fireEvent, render, screen } from '@testing-library/react'
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
      { offsetSeconds: 60, score: 70, label: 'First peak' },
      { offsetSeconds: 300, score: 90, label: 'Second peak' },
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
    const { container } = render(<FigmaSessionDashboard model={readyModel()} />)
    const wrap = container.querySelector('.figma-chart__svg-wrap') as HTMLElement
    wrap.focus()
    fireEvent.keyDown(wrap, { key: 'End' })
    const activeRow = container.querySelector('tr.is-active')
    expect(activeRow?.textContent).toContain('Second peak')
  })

  it('keeps exact table selection when a moment VOD link is clicked', () => {
    render(<FigmaSessionDashboard model={readyModel()} />)
    fireEvent.click(screen.getByRole('link', { name: '5:00' }))
    const activeRow = document.querySelector('tr.is-active')
    expect(activeRow?.textContent).toContain('Second peak')
  })

  it('plots bursts anchored at stream start', () => {
    render(<FigmaSessionDashboard model={readyModel()} />)
    fireEvent.click(screen.getByTitle('Plot KEKW on chart'))
    expect(screen.getByText('KEKW @ 00:00')).toBeTruthy()
  })
})
