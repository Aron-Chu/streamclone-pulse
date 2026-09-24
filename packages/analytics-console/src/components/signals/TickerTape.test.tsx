import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TickerTape } from './TickerTape.tsx'

describe('TickerTape', () => {
  afterEach(cleanup)

  it('offers Pause and Resume only when overflow auto-pan is eligible', () => {
    const { rerender } = render(
      <TickerTape itemIds={['one']} overflowing motionEnabled autoScroll="overflow">
        <span>One</span>
      </TickerTape>,
    )

    const pause = screen.getByRole('button', { name: 'Pause ticker' })
    expect(pause.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(pause)
    expect(screen.getByRole('button', { name: 'Resume ticker' }).getAttribute('aria-pressed')).toBe('true')

    rerender(
      <TickerTape itemIds={['one']} overflowing motionEnabled={false} autoScroll="overflow">
        <span>One</span>
      </TickerTape>,
    )
    expect(screen.queryByRole('button', { name: /ticker/i })).toBeNull()
  })

  it('assigns item ids to one direct track and exposes polite deduplicated updates', () => {
    const { rerender } = render(
      <TickerTape itemIds={['one', 'two']} announcement="Two arrived">
        <span>One</span>
        <span>Two</span>
      </TickerTape>,
    )

    const track = screen.getByTestId('ticker-track')
    expect([...track.children].map(child => child.getAttribute('data-tape-id'))).toEqual(['one', 'two'])
    expect(screen.getByRole('status').textContent).toBe('Two arrived')

    rerender(
      <TickerTape itemIds={['one', 'two']} announcement="Two arrived">
        <span>One</span>
        <span>Two</span>
      </TickerTape>,
    )
    expect(screen.getByRole('status').textContent).toBe('')
  })
})
