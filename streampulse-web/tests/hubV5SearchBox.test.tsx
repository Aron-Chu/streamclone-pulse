import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HubLiveChannel } from '../src/lib/publicHub'
import type { ChannelLookup } from '../src/lib/channelLookup'

const lookup = vi.hoisted(() => ({
  lookupChannel: vi.fn(),
  readChannelLookup: vi.fn(),
}))
vi.mock('../src/lib/channelLookup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/channelLookup')>()),
  lookupChannel: lookup.lookupChannel,
  readChannelLookup: lookup.readChannelLookup,
}))

import { HUB_SEARCH_PLACEHOLDER, HubV5SearchBox, LOOKUP_DELAY_MS } from '../src/ui/components/hub/v5/HubV5SearchBox'
import { HubV5SearchContext, createHubV5SearchStore, type HubV5SearchStore } from '../src/ui/components/hub/v5/hubV5SearchStore'

const live = (login: string, viewers: number, category = 'Just Chatting'): HubLiveChannel => ({
  login,
  displayName: login.toUpperCase(),
  viewers,
  category,
} as HubLiveChannel)

const LIVE = [live('shroud', 900, 'VALORANT'), live('pokimane', 700), live('summit1g', 500, 'Grand Theft Auto V')]
const GAMES = [{ name: 'Grand Theft Auto V', n: 12 }, { name: 'VALORANT', n: 1 }]
const EMOTES = [{ name: 'KEKW', provider: '7tv', uses: 90 }, { name: 'OMEGALUL', provider: 'bttv', uses: 40 }]

let where = ''
function Where() {
  const l = useLocation()
  where = `${l.pathname}${l.search}`
  return null
}

function renderBox(store: HubV5SearchStore = createHubV5SearchStore()) {
  render(
    <HubV5SearchContext.Provider value={store}>
      <MemoryRouter initialEntries={['/']}>
        <Where />
        <Routes>
          <Route path="*" element={<HubV5SearchBox live={LIVE} variant="hero" games={GAMES} emotes={EMOTES} />} />
        </Routes>
      </MemoryRouter>
    </HubV5SearchContext.Provider>,
  )
  const input = screen.getByRole('combobox', { name: HUB_SEARCH_PLACEHOLDER })
  const list = document.querySelector<HTMLElement>('[role="listbox"]')!
  expect(list.getAttribute('aria-label')).toBe('Search suggestions')
  return { input, list, store }
}

const type = (input: HTMLElement, value: string) => {
  fireEvent.focus(input)
  fireEvent.change(input, { target: { value } })
}

beforeEach(() => {
  lookup.lookupChannel.mockReset()
  lookup.readChannelLookup.mockReset()
  lookup.readChannelLookup.mockReturnValue(undefined)
  where = ''
})
afterEach(() => cleanup())

describe('HubV5SearchBox: one box that knows more (3A, 11-02)', () => {
  it('says what it searches, without promising every Twitch channel', () => {
    const { input } = renderBox()
    expect(input.getAttribute('placeholder')).toBe('Search streamers or games')
    expect(document.body.textContent).not.toMatch(/any Twitch/i)
  })

  it('looks a login up once typing pauses, then shows the real row', async () => {
    const answer: ChannelLookup = {
      state: 'recorded',
      login: 'xqc',
      profile: { displayName: 'xQc' },
      stream: { streamId: '42', startedAt: '2026-10-31T20:00:00Z', category: 'GTA V', ended: true },
    }
    lookup.lookupChannel.mockResolvedValue(answer)
    const { input, list } = renderBox()
    type(input, 'xq')
    type(input, 'xqc')
    const row = within(list).getByRole('option', { name: /Open analytics for xqc/ })
    expect(row.getAttribute('data-state')).toBe('pending')
    expect(lookup.lookupChannel).not.toHaveBeenCalled()
    await waitFor(() => expect(lookup.lookupChannel).toHaveBeenCalledTimes(1), { timeout: LOOKUP_DELAY_MS + 1000 })
    expect(lookup.lookupChannel).toHaveBeenCalledWith('xqc')
    const done = await within(list).findByRole('option', { name: /xQc/ })
    expect(done.getAttribute('data-state')).toBe('recorded')
    expect(done.textContent).toMatch(/last streamed Oct 31 · GTA V/)
    expect(done.getAttribute('href')).toBe('/analytics/xqc/42')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(where).toBe('/analytics/xqc/42')
  })

  it('says "can’t check right now" when the read fails, and still opens the login', async () => {
    lookup.lookupChannel.mockResolvedValue({ state: 'unknown', login: 'zzzqqqxx1' } satisfies ChannelLookup)
    const { input, list } = renderBox()
    type(input, 'zzzqqqxx1')
    const row = await within(list).findByRole('option', { name: /Can’t check right now/ }, { timeout: LOOKUP_DELAY_MS + 1000 })
    expect(row.getAttribute('data-state')).toBe('unknown')
    expect(row.textContent).not.toMatch(/doesn.t exist|no such/i)
    expect(row.getAttribute('href')).toBe('/analytics/zzzqqqxx1')
  })

  it('shows a kept answer at once', () => {
    lookup.readChannelLookup.mockReturnValue({ state: 'unrecorded', login: 'newbie', profile: null } satisfies ChannelLookup)
    const { input, list } = renderBox()
    type(input, 'newbie')
    expect(within(list).getByRole('option', { name: /Not recorded yet/ })).toBeTruthy()
    expect(lookup.lookupChannel).not.toHaveBeenCalled()
  })

  it('lists games live now and emotes under their own headings, as links off the hub', () => {
    const { input, list } = renderBox()
    type(input, 'gr')
    const game = within(list).getByRole('option', { name: /Grand Theft Auto V/ })
    expect(game.getAttribute('data-kind')).toBe('game')
    expect(game.textContent).toMatch(/12 channels live/)
    expect(game.getAttribute('href')).toBe('/analytics?game=Grand%20Theft%20Auto%20V')
    expect(list.textContent).toMatch(/Games live now/)
    type(input, 'KEK')
    const emote = within(list).getByRole('option', { name: /KEKW/ })
    expect(emote.getAttribute('data-kind')).toBe('emote')
    expect(emote.textContent).toMatch(/7TV/)
    expect(emote.getAttribute('href')).toBe('/analytics?emote=KEKW')
    expect(list.textContent).toMatch(/Emotes/)
  })

  it('on the hub, a game pick sets the filter in place and an emote pick finds it on the map', () => {
    const store = createHubV5SearchStore()
    const game = vi.fn()
    const emote = vi.fn()
    store.actions.game = game
    store.actions.emote = emote
    const { input, list } = renderBox(store)
    type(input, 'valo')
    // "valo" could be a login too: its row, then the game
    const options = within(list).getAllByRole('option')
    expect(options.map((o) => o.getAttribute('data-kind'))).toEqual(['login', 'game'])
    fireEvent.click(within(list).getByRole('option', { name: /VALORANT/ }))
    expect(game).toHaveBeenCalledWith('VALORANT')
    expect(where).toBe('/')
    expect(store.get().value).toBe('')
    type(input, 'omega')
    const kinds = within(list).getAllByRole('option').map((o) => o.getAttribute('data-kind'))
    expect(kinds).toEqual(['login', 'emote'])
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(emote).toHaveBeenCalledWith('OMEGALUL')
    expect(where).toBe('/')
  })

  it('Enter on text no login can be opens the first game', () => {
    const { input } = renderBox()
    type(input, 'grand theft')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(where).toBe('/analytics?game=Grand%20Theft%20Auto%20V')
  })

  it('says nothing live matches when the text is no login, game or emote', () => {
    const { input, list } = renderBox()
    type(input, 'just chatting!!')
    expect(within(list).queryAllByRole('option')).toHaveLength(0)
    expect(list.textContent).toBe('Nothing live matches “just chatting!!”.')
  })
})
