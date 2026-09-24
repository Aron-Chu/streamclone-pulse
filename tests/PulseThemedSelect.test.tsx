// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { PulseThemedSelect, __test } from '../src/ui/PulseThemedSelect.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

it('portals outside transformed settings panels but stays inside a native modal', () => {
  const panel = document.createElement('div')
  panel.style.transform = 'translateY(0)'
  const trigger = document.createElement('button')
  panel.append(trigger)
  document.body.append(panel)
  expect(__test.resolveMenuHost(document, trigger)).toBe(document.body)
  const dialog = document.createElement('dialog')
  dialog.setAttribute('open', '')
  dialog.append(trigger)
  panel.append(dialog)
  expect(__test.resolveMenuHost(document, trigger)).toBe(dialog)
  panel.remove()
})

it('falls back to the first enabled option when the stored value is disabled', () => {
  expect(__test.indexForValue([
    { value: 'paid', label: 'Paid', disabled: true },
    { value: 'free', label: 'Free' },
  ], 'paid')).toBe(1)
})

it('keyboard navigation skips paid disabled options and Escape returns focus without selecting', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const changed = vi.fn()
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 10, top: 10, left: 10, bottom: 42, right: 210, width: 200, height: 32, toJSON() {} })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1000 })
  try {
    await act(async () => root.render(<PulseThemedSelect ariaLabel="Retention" value="7" onChange={changed} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days', disabled: true }, { value: '90', label: '90 days' }]} />))
    const trigger = host.querySelector('button')!
    const key = async (value: string) => { await act(async () => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })) }) }
    trigger.focus()
    await key('Enter')
    expect(document.querySelector('[role="option"][disabled]')?.textContent).toContain('30 days')
    await key('ArrowDown')
    await key('Enter')
    expect(changed).toHaveBeenCalledExactlyOnceWith('90')
    await key('Enter')
    await key('Escape')
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(changed).toHaveBeenCalledTimes(1)
  } finally {
    await act(async () => root.unmount())
    host.remove()
    bounds.mockRestore()
  }
})

it('selects a portaled option through a pointer click without closing on trigger blur', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 10, top: 10, left: 10, bottom: 42, right: 210, width: 200, height: 32, toJSON() {} })
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 1000 })
  try {
    function Harness() {
      const [value, setValue] = useState<'60m' | 'full'>('full')
      return (
        <PulseThemedSelect
          ariaLabel="Chart time range"
          value={value}
          onChange={setValue}
          options={[
            { value: '60m', label: '1 hour' },
            { value: 'full', label: 'Full stream' },
          ]}
        />
      )
    }
    await act(async () => root.render(<Harness />))
    const trigger = host.querySelector<HTMLButtonElement>('[role="combobox"]')!
    await act(async () => { trigger.click() })
    const option = document.querySelector<HTMLButtonElement>('[role="option"][aria-selected="false"]')!
    await act(async () => {
      option.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
      option.click()
    })
    expect(host.querySelector('[role="combobox"]')?.textContent).toContain('1 hour')
  } finally {
    await act(async () => root.unmount())
    host.remove()
    bounds.mockRestore()
  }
})
