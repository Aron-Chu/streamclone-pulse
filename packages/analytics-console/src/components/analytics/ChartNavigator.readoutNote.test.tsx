import type { ReactNode } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChartNavigator } from './ChartNavigator.tsx'

afterEach(() => cleanup())

function renderNavigator(readoutNote?: ReactNode) {
  return render(
    <ChartNavigator
      pointCount={240}
      startIndex={0}
      endIndex={239}
      startLabel="Oct 7 8:36 PM"
      endLabel="Oct 8 8:30 PM"
      scrollZoomEnabled={false}
      onScrollZoomChange={vi.fn()}
      onChange={vi.fn()}
      onReset={vi.fn()}
      {...(readoutNote === undefined ? {} : { readoutNote })}
    />,
  )
}

describe('ChartNavigator readoutNote', () => {
  it('leaves the hub readout markup unchanged when the note is not passed', () => {
    const { container } = renderNavigator()
    const count = container.querySelector('.hx-chart-navigator__bucket-count')!
    expect(count.textContent).toBe('240 of 240 buckets')
    expect(count.innerHTML).toBe('240 of 240 buckets')
    expect(count.children).toHaveLength(0)
    const readout = container.querySelector('[role="status"]')!
    expect([...readout.children].map(child => child.className || child.tagName)).toEqual([
      'STRONG',
      'hx-chart-navigator__time-range',
      'hx-chart-navigator__bucket-count',
    ])
  })

  it('renders the note on the count line, inside the status readout', () => {
    const { container } = renderNavigator(<span data-note>bars 5-min avg</span>)
    const count = container.querySelector('[role="status"] .hx-chart-navigator__bucket-count')!
    expect(count.textContent).toBe('240 of 240 buckets · bars 5-min avg')
    expect(count.querySelector('[data-note]')).not.toBeNull()
  })
})
