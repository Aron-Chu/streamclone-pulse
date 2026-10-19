import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { SessionShowOnChart, SESSION_MARKERS_OFF, type SessionMarkers } from './SessionShowOnChart.tsx'

afterEach(() => cleanup())

function Harness({ live = true, onChange = vi.fn() }: { live?: boolean; onChange?: (next: SessionMarkers) => void }) {
  const [markers, setMarkers] = useState<SessionMarkers>(SESSION_MARKERS_OFF)
  return (
    <div>
      <SessionShowOnChart
        markers={markers}
        liveAvailable={live}
        onChange={next => {
          onChange(next)
          setMarkers(next)
        }}
      />
      <button type="button">outside</button>
    </div>
  )
}

describe('SessionShowOnChart (d3-v2 session-original Show on chart)', () => {
  it('starts with every marker off and counts the ones turned on', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const button = screen.getByRole('button', { name: 'Show on chart' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const panel = screen.getByRole('group', { name: 'Show on chart' })
    expect(button.getAttribute('aria-controls')).toBe(panel.id)
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.map(b => [b.closest('label')?.textContent, b.checked])).toEqual([
      ['Momentspins and leader lines', false],
      ['Averagesdotted line per lane', false],
      ['Live edgethe newest measured minute', false],
    ])
    fireEvent.click(boxes[0]!)
    fireEvent.click(boxes[2]!)
    expect(onChange).toHaveBeenLastCalledWith({ moments: true, avg: false, live: true })
    expect(button.getAttribute('aria-label')).toBe('Show on chart, 2 on')
    expect(button.querySelector('.ssc-cnt')?.textContent).toBe('2')
  })

  it('lists Live edge only while the stream has one', () => {
    render(<Harness live={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show on chart' }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.queryByText('Live edge')).toBeNull()
  })

  it('closes on Escape (focus back to the button), on an outside press, and when Tab leaves the list', () => {
    render(<Harness />)
    const button = screen.getByRole('button', { name: 'Show on chart' })
    // a hidden element has no accessible name, so find the panel through aria-controls
    const panel = () => document.getElementById(button.getAttribute('aria-controls')!)!
    fireEvent.click(button)
    const box = screen.getAllByRole('checkbox')[0]!
    box.focus()
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(panel().hidden).toBe(true)
    expect(document.activeElement).toBe(button)

    fireEvent.click(button)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }))
    expect(panel().hidden).toBe(true)

    fireEvent.click(button)
    fireEvent.blur(screen.getAllByRole('checkbox')[1]!, { relatedTarget: screen.getByRole('button', { name: 'outside' }) })
    expect(panel().hidden).toBe(true)
  })
})
