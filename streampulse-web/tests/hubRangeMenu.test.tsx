import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HubRangeMenu, type HubActivityRangeControl } from '../src/ui/components/hub/HubRangeMenu'

function renderRangeMenu(onSelect = vi.fn()) {
  const control: HubActivityRangeControl = {
    active: '24h',
    options: [
      { key: '30m', label: '30m' },
      { key: '24h', label: '24h' },
      { key: '7d', label: '7d' },
    ],
    onSelect,
  }
  render(<HubRangeMenu control={control} />)
  return { onSelect, trigger: screen.getByRole('button', { name: 'Activity time window: 24h' }) }
}

describe('HubRangeMenu keyboard contract', () => {
  it('opens on Enter, starts on the selected option, and commits ArrowDown + Enter', () => {
    const { onSelect, trigger } = renderRangeMenu()

    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })

    const listbox = screen.getByRole('listbox', { name: 'Activity time window' })
    expect(document.activeElement).toBe(listbox)
    expect(listbox.getAttribute('aria-activedescendant')).toMatch(/-option-1$/)

    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    expect(listbox.getAttribute('aria-activedescendant')).toMatch(/-option-2$/)

    fireEvent.keyDown(listbox, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith('7d')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('supports ArrowUp from the trigger and Escape without changing the range', () => {
    const { onSelect, trigger } = renderRangeMenu()

    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    const listbox = screen.getByRole('listbox', { name: 'Activity time window' })
    expect(listbox.getAttribute('aria-activedescendant')).toMatch(/-option-1$/)

    fireEvent.keyDown(listbox, { key: 'Escape' })
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})
