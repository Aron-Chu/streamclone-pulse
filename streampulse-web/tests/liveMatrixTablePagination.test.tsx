import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { HubLiveChannel } from '../src/lib/publicHub'
import { LiveMatrixTable } from '../src/ui/components/analytics/LiveMatrixTable'

const channels: HubLiveChannel[] = Array.from({ length: 500 }, (_, index) => ({
  login: `table${index.toString().padStart(3, '0')}`,
  displayName: `Table ${index.toString().padStart(3, '0')}`,
  category: 'Just Chatting',
  viewers: 500 - index,
  chatPerMin: index,
  emotesPerMin: index / 2,
  seventvPerMin: 0,
  coverageState: 'synced',
  trendPct: 0,
}))

describe('LiveMatrixTable pagination', () => {
  it('bounds 500 rows, reaches every page, survives a reference-only refresh, and resets on sort/filter', () => {
    const { container, rerender } = render(<MemoryRouter><LiveMatrixTable channels={channels} /></MemoryRouter>)
    const seen = new Set<string>()
    for (let page = 1; page <= 20; page += 1) {
      const rows = container.querySelectorAll('.dash-tbl tbody tr')
      expect(rows.length).toBeLessThanOrEqual(25)
      rows.forEach((row) => seen.add(row.textContent ?? ''))
      if (page < 20) fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    }
    expect(seen.size).toBe(500)
    expect(screen.getByText(/Page 20 of 20/)).toBeTruthy()

    rerender(<MemoryRouter><LiveMatrixTable channels={[...channels]} /></MemoryRouter>)
    expect(screen.getByText(/Page 20 of 20/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Chat\/min/ }))
    expect(screen.getByText(/Page 1 of 20/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('tab', { name: /Chat tracked/ }))
    expect(screen.getByText(/Page 1 of 20/)).toBeTruthy()
  })
})
