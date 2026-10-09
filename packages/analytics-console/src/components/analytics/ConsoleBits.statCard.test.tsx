import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StatCard } from './ConsoleBits.tsx'

vi.mock('../../hooks/useConsoleMotion.ts', () => ({
  useConsoleMotion: () => ({ motionEnabled: false }),
}))

afterEach(() => cleanup())

describe('StatCard', () => {
  it('pins the value to the bottom of the card so a wrapped label does not lift it', () => {
    const { container } = render(<StatCard label="Measured emote uses" value="223.0K" />)
    const card = container.querySelector<HTMLElement>('.sc-stat-card')!
    const value = container.querySelector<HTMLElement>('.sc-stat-card__value')!
    // Cards in a grid row share a height; a column flex with an auto top
    // margin on the value puts every value on the same bottom line.
    expect(card.className).toMatch(/\bflex\b/)
    expect(card.className).toMatch(/\bflex-col\b/)
    expect(value.className).toMatch(/\bmt-auto\b/)
    expect(value.className).toMatch(/\bpt-1\b/)
    expect(value.className).not.toMatch(/\bmt-1\b/)
  })
})
