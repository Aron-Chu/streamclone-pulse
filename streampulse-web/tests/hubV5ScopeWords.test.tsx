/**
 * W1 (11-02): the lines that say what the hub covers name "the Twitch channels we track".
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { summarizeActivity } from '../src/lib/hubActivitySummary'
import { normalizePublicHub, type HubLiveChannel } from '../src/lib/publicHub'
import { HubActivityPanelV5 } from '../src/ui/components/analytics/HubActivityPanelV5'
import { HubV5Hero } from '../src/ui/components/hub/v5/HubV5Hero'
import { createHubV5SearchStore, HubV5SearchContext } from '../src/ui/components/hub/v5/hubV5SearchStore'

afterEach(() => cleanup())

function hero(poolSize: number, { waiting = false, live = [] as HubLiveChannel[] } = {}) {
  return render(
    <HubV5SearchContext.Provider value={createHubV5SearchStore()}>
      <MemoryRouter>
        <HubV5Hero live={live} poolSize={poolSize} points={[]} waiting={waiting} />
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

  it('while the first answer loads, keeps the Try row’s and the scope line’s room, hidden and with no count', () => {
    const { container } = hero(0, { waiting: true })
    const tryRow = container.querySelector('.hv5-hero-try')!
    const scope = container.querySelector('.hv5-scope')!
    for (const el of [tryRow, scope]) {
      expect(el.hasAttribute('data-wait')).toBe(true)
      expect(el.getAttribute('aria-hidden')).toBe('true')
    }
    expect(tryRow.children).toHaveLength(0)
    expect(scope.textContent).toBe('The hub below covers the channels we track · not all of Twitch')
  })

  it('drops the waiting marks once the answer is in', () => {
    const live = normalizePublicHub({ liveChannels: [{ login: 'caedrel', displayName: 'Caedrel', viewers: 900 }] } as unknown as Parameters<typeof normalizePublicHub>[0]).liveChannels
    const { container } = hero(500, { waiting: false, live })
    expect(container.querySelector('[data-wait]')).toBeNull()
    expect(container.querySelector('.hv5-hero-try')!.textContent).toContain('Caedrel')
    expect(container.querySelector('.hv5-scope')!.textContent).toBe('The hub below covers 500 channels we track · not all of Twitch')
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
