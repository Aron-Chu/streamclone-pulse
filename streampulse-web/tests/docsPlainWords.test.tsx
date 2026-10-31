import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import Docs from '../src/routes/public/Docs'

afterEach(cleanup)

describe('Docs: Explore Analytics', () => {
  it('points at what the hub has (a search, and Busiest now), not at tabs it does not have', () => {
    render(<MemoryRouter><Docs /></MemoryRouter>)
    const section = screen.getByRole('heading', { name: /Explore Analytics/ }).closest('section')!
    const steps = within(section).getAllByRole('listitem').map((item) => item.textContent)
    expect(steps[0]).toBe('Search a channel, or pick one under Busiest now.')
    expect(section.textContent).not.toMatch(/Overview|Moments, Emotes, or Channels/)
  })
})
