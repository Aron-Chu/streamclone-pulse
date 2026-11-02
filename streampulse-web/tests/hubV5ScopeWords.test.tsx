import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { HubV5Hero } from '../src/ui/components/hub/v5/HubV5Hero'

afterEach(cleanup)

function hero(poolSize: number) {
  return render(
    <MemoryRouter>
      <HubV5Hero live={[]} poolSize={poolSize} points={[]} />
    </MemoryRouter>,
  )
}

// The hub says what it covers in one set of words: the Twitch channels we track (W1, 11-02).
describe('hub scope words', () => {
  it('promises the channels we track, not any channel, in the line under the heading', () => {
    const { container } = hero(1000)
    expect(container.querySelector('.hv5-hero-sub')!.textContent)
      .toBe('Chat, emotes and top moments for the Twitch channels we track, minute by minute.')
    expect(container.textContent).not.toMatch(/any Twitch channel/i)
  })

  it('asks for streamers or games in the search box (Q1, 11-02)', () => {
    hero(1000)
    const field = screen.getByRole('combobox', { name: 'Search streamers or games' })
    expect(field.getAttribute('placeholder')).toBe('Streamers or games')
  })

  it('names the scope once, with no second total, and keeps "not all of Twitch"', () => {
    const { container } = hero(1000)
    const scope = container.querySelector('.hv5-scope')!
    expect(scope.textContent).toBe('The hub below covers the Twitch channels we track · not all of Twitch')
    expect(container.textContent).not.toMatch(/channels we follow|1,000/)
  })

  it('shows no scope line until the hub has told how many channels it follows', () => {
    const { container } = hero(0)
    expect(container.querySelector('.hv5-scope')).toBeNull()
  })
})
