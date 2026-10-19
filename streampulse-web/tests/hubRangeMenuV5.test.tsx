import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HubRangeMenu, hubWindowSegOptions, type HubActivityRangeControl } from '../src/ui/components/hub/HubRangeMenuV5'

const OPTIONS = [
  { key: '30m', label: '30m' },
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
  { key: '1m', label: '1mo' },
  { key: '3m', label: '3mo' },
  { key: '1y', label: '1 year' },
]

function control(active: string, onSelect = vi.fn()): HubActivityRangeControl {
  return { active, options: OPTIONS, onSelect }
}

describe('HubRangeMenu: the window seg (30m / 24h / 7d)', () => {
  it('shows the three visible windows as a pressed-state group named Window', () => {
    render(<HubRangeMenu control={control('24h')} />)
    const group = screen.getByRole('group', { name: 'Window' })
    const buttons = [...group.querySelectorAll('button')]
    expect(buttons.map((button) => button.textContent)).toEqual(['30m', '24h', '7d'])
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
    expect(group.hasAttribute('data-hub-window-seg')).toBe(true)
  })

  it('selects another window on click and ignores a click on the pressed one', () => {
    const onSelect = vi.fn()
    render(<HubRangeMenu control={control('24h', onSelect)} />)
    fireEvent.click(screen.getByRole('button', { name: '7d' }))
    expect(onSelect).toHaveBeenCalledWith('7d')
    fireEvent.click(screen.getByRole('button', { name: '24h' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('shows an active URL-only long window as a fourth pressed button', () => {
    render(<HubRangeMenu control={control('3m')} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual(['30m', '24h', '7d', '3mo'])
    const fourth = buttons[3]!
    expect(fourth.getAttribute('aria-pressed')).toBe('true')
    expect(fourth.hasAttribute('data-hub-window-url-only')).toBe(true)
    expect(buttons.slice(0, 3).every((button) => button.getAttribute('aria-pressed') === 'false')).toBe(true)
  })

  it('never offers the long windows as buttons while a visible window is active', () => {
    expect(hubWindowSegOptions(control('7d')).map((option) => option.key)).toEqual(['30m', '24h', '7d'])
    expect(hubWindowSegOptions(control('1y')).map((option) => `${option.key}:${option.urlOnly}`)).toEqual(['30m:false', '24h:false', '7d:false', '1y:true'])
  })

  it('keeps a degraded option label the page passes (requested vs available)', () => {
    render(<HubRangeMenu control={{ active: '30m', options: [{ key: '30m', label: '30m' }, { key: '24h', label: '24h · 30m available' }], onSelect: vi.fn() }} />)
    expect(screen.getByRole('button', { name: '24h · 30m available' }).getAttribute('aria-pressed')).toBe('false')
  })
})
