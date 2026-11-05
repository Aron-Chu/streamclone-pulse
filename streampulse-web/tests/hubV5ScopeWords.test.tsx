/**
 * W1 (11-02): the lines that say what the hub covers name "the Twitch channels we track".
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { summarizeActivity } from '../src/lib/hubActivitySummary'
import { normalizePublicHub } from '../src/lib/publicHub'
import { HubActivityPanelV5 } from '../src/ui/components/analytics/HubActivityPanelV5'
import { HubV5Hero } from '../src/ui/components/hub/v5/HubV5Hero'
import { createHubV5SearchStore, HubV5SearchContext } from '../src/ui/components/hub/v5/hubV5SearchStore'

afterEach(() => cleanup())

function hero(poolSize: number) {
  return render(
    <HubV5SearchContext.Provider value={createHubV5SearchStore()}>
      <MemoryRouter>
        <HubV5Hero live={[]} poolSize={poolSize} points={[]} />
      </MemoryRouter>
    </HubV5SearchContext.Provider>,
  )
}

describe('the hub’s coverage words (W1, 11-02)', () => {
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

  it('the hero: the Twitch channels we track, and the scope line with the real count', () => {
    const { container } = hero(500)
    expect(container.querySelector('.hv5-hero-sub')!.textContent).toBe('Chat, emotes and top moments for the Twitch channels we track, minute by minute.')
    expect(container.querySelector('.hv5-scope')!.textContent).toBe('The hub below covers 500 channels we track · not all of Twitch')
    expect(container.textContent).not.toMatch(/we follow/i)
  })

  it('shows no scope line until the hub has told how many channels it follows', () => {
    const { container } = hero(0)
    expect(container.querySelector('.hv5-scope')).toBeNull()
  })

  it('How this is measured: we track the pool', () => {
    const hub = { ...normalizePublicHub(null), poolSize: 500 }
    const target = document.createElement('div')
    document.body.append(target)
    render(
      <MemoryRouter>
        <HubActivityPanelV5 hub={hub} activitySummary={summarizeActivity([], 30, 0)} suggestions={[]} loading={false} measuredTarget={target} />
      </MemoryRouter>,
    )
    expect(target.querySelector('[data-testid="hub-v5-measured-notes"] li')!.textContent).toBe('We track 500 live Twitch channels, not all of Twitch.')
    target.remove()
  })
})
