import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FigmaSignalChart } from '../src/ui/components/analytics/FigmaSignalChart'

const points = [
  { offsetSeconds: 0, chatNorm: 10, viewersNorm: 20, emotesNorm: 15, heat: 30 },
  { offsetSeconds: 60, chatNorm: 40, viewersNorm: 35, emotesNorm: 50, heat: 70 },
  { offsetSeconds: 120, chatNorm: 25, viewersNorm: 45, emotesNorm: 30, heat: 55 },
]

describe('FigmaSignalChart', () => {
  it('renders empty state without points', () => {
    render(<FigmaSignalChart points={[]} />)
    expect(screen.getByText(/Chart lanes appear when backend rollups/i)).toBeTruthy()
  })

  it('selects nearest point on click', () => {
    const onSelectOffset = vi.fn()
    const { container } = render(
      <FigmaSignalChart points={points} onSelectOffset={onSelectOffset} />,
    )
    const wrap = container.querySelector('.figma-chart__svg-wrap')
    expect(wrap).toBeTruthy()
    fireEvent.click(wrap!, { clientX: 900, clientY: 40 })
    expect(onSelectOffset).toHaveBeenCalled()
  })

  it('moves selection with arrow keys', () => {
    const onSelectOffset = vi.fn()
    const { container } = render(
      <FigmaSignalChart points={points} selectedOffset={60} onSelectOffset={onSelectOffset} />,
    )
    const wrap = container.querySelector('.figma-chart__svg-wrap') as HTMLElement
    wrap.focus()
    fireEvent.keyDown(wrap, { key: 'ArrowRight' })
    expect(onSelectOffset).toHaveBeenCalledWith(120)
  })

  it('shows plotted emote legend and clears overlay', () => {
    const onClear = vi.fn()
    render(
      <FigmaSignalChart
        points={points}
        plottedEmote={{ code: 'KEKW', label: 'KEKW @ 01:00', peakOffsetSeconds: 60 }}
        onClearPlottedEmote={onClear}
      />,
    )
    expect(screen.getByText('KEKW @ 01:00')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Clear KEKW plot/i }))
    expect(onClear).toHaveBeenCalled()
  })
})
