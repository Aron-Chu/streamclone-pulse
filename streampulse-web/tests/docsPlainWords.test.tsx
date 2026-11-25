import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import Help from '../src/routes/public/Help'

afterEach(cleanup)

describe('Help: Use the Hub', () => {
  it('points at what the hub has (a search, and Busiest now), not at tabs it does not have', () => {
    render(<MemoryRouter><Help /></MemoryRouter>)
    const section = screen.getByRole('heading', { name: 'Use the Hub' }).closest('section')!
    const steps = within(section).getAllByRole('listitem').map((item) => item.textContent)
    expect(steps[0]).toBe('Search a channel, or pick one under Busiest now.')
    expect(section.textContent).not.toMatch(/Overview|Moments, Emotes, or Channels/)
  })
})
