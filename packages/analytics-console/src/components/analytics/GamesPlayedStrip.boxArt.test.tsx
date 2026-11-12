// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChartGameSegment } from '@streampulse/pulse-charts'

const placeholder = vi.hoisted(() => ({ answer: vi.fn<(img: HTMLImageElement) => Promise<boolean>>() }))
vi.mock('../../utils/twitchBoxArt.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('../../utils/twitchBoxArt.ts')>()),
  isTwitchPlaceholderBoxArt: (img: HTMLImageElement) => placeholder.answer(img),
}))

const { GamesPlayedStrip } = await import('./GamesPlayedStrip.tsx')

const NAMED = 'https://static-cdn.jtvnw.net/ttv-boxart/Unknown%20Indie%20Game-144x192.jpg'
const NAMED_IGDB = 'https://static-cdn.jtvnw.net/ttv-boxart/Unknown%20Indie%20Game_IGDB-144x192.jpg'

// A game the backend sent with a name only: the name-based covers are the only candidates.
const nameOnly: ChartGameSegment[] = [{ gameName: 'Unknown Indie Game', offsetSeconds: 0, durationSeconds: 600 }]
// Shapes from the 10-30 games answers: the backend's looked-up cover, its id-built fallback, and an id with no cover.
const withArt: ChartGameSegment[] = [{ gameName: 'Just Chatting', categoryId: '509658', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/509658_IGDB-210x280.jpg', offsetSeconds: 0, durationSeconds: 600 }]
const idBuilt: ChartGameSegment[] = [{ gameName: 'Gakuen iDOLM@STER', categoryId: '1419480843', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/1419480843-210x280.jpg', offsetSeconds: 0, durationSeconds: 600 }]
const idOnly: ChartGameSegment[] = [{ gameName: 'Gakuen iDOLM@STER', categoryId: '1419480843', offsetSeconds: 0, durationSeconds: 600 }]

const art = () => screen.getByRole('button', { name: /Unknown Indie Game|Just Chatting|Gakuen/ }).querySelector('img')

async function load(img: HTMLImageElement | null) {
  await act(async () => {
    fireEvent.load(img!)
  })
}

beforeEach(() => placeholder.answer.mockReset())
afterEach(() => cleanup())

describe("GameArt and Twitch's '?' cover (fix, 10-30, GP-8)", () => {
  it('moves past a name-based cover that is the placeholder, then to initials', async () => {
    placeholder.answer.mockResolvedValue(true)
    render(<GamesPlayedStrip games={nameOnly} durationSeconds={600} headerless />)
    expect(art()?.getAttribute('src')).toBe(NAMED)
    // Read back from a canvas, so it must be a CORS load.
    expect(art()?.getAttribute('crossorigin')).toBe('anonymous')
    await load(art())
    expect(art()?.getAttribute('src')).toBe(NAMED_IGDB)
    await load(art())
    expect(art()).toBeNull()
    expect(screen.getByText('UG')).not.toBeNull()
    expect(placeholder.answer).toHaveBeenCalledTimes(2)
  })

  it('keeps a name-based cover that is real art, hidden only until it is checked', async () => {
    placeholder.answer.mockResolvedValue(false)
    render(<GamesPlayedStrip games={nameOnly} durationSeconds={600} headerless />)
    expect(art()?.style.opacity).toBe('0')
    await load(art())
    expect(art()?.getAttribute('src')).toBe(NAMED)
    expect(art()?.style.opacity).toBe('')
  })

  it("checks an id-based cover too: a newer game's standard cover is the placeholder, so the IGDB one shows", async () => {
    // Checked 10-30: ttv-boxart/1419480843-144x192.jpg redirects to 404_boxart; only the _IGDB cover is real.
    placeholder.answer.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    render(<GamesPlayedStrip games={idOnly} durationSeconds={600} headerless />)
    expect(art()?.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/1419480843-144x192.jpg')
    expect(art()?.getAttribute('crossorigin')).toBe('anonymous')
    await load(art())
    expect(art()?.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/1419480843_IGDB-144x192.jpg')
    await load(art())
    expect(art()?.style.opacity).toBe('')
  })

  it("leaves the backend's looked-up cover as it was: no CORS load and no check", async () => {
    render(<GamesPlayedStrip games={withArt} durationSeconds={600} headerless />)
    expect(art()?.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/509658_IGDB-210x280.jpg')
    expect(art()?.hasAttribute('crossorigin')).toBe(false)
    expect(art()?.style.opacity).toBe('')
    await load(art())
    expect(placeholder.answer).not.toHaveBeenCalled()
  })

  it("checks the backend's id-built cover (its fallback when the name lookup fails) and moves to the IGDB one", async () => {
    placeholder.answer.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    render(<GamesPlayedStrip games={idBuilt} durationSeconds={600} headerless />)
    expect(art()?.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/1419480843-210x280.jpg')
    expect(art()?.getAttribute('crossorigin')).toBe('anonymous')
    expect(art()?.style.opacity).toBe('0')
    await load(art())
    expect(art()?.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/1419480843_IGDB-210x280.jpg')
    await load(art())
    expect(art()?.style.opacity).toBe('')
    expect(placeholder.answer).toHaveBeenCalledTimes(2)
  })
})
