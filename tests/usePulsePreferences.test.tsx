// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePulsePreferences } from '../src/ui/usePulsePreferences.ts'

vi.mock('../src/content/bridge.ts', () => ({
  sendBackgroundMessage: vi.fn(async () => ({ ok: true })),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function Probe({ id }: { id: string }) {
  const preferences = usePulsePreferences()
  return (
    <div data-probe={id} data-accent={preferences.accent} data-status={preferences.status}>
      <button type="button" onClick={() => void preferences.setAccent('volt')}>Use Volt</button>
    </div>
  )
}

describe('shared Pulse preferences', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null
  let syncStore: Record<string, unknown>
  let storageListeners: Set<(changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void>
  let rejectWrites: boolean

  beforeEach(() => {
    syncStore = {}
    storageListeners = new Set()
    rejectWrites = false
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension' },
      storage: {
        sync: {
          get: vi.fn(async (keys: string | string[] | Record<string, unknown> | null) => {
            if (keys === null) return { ...syncStore }
            const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys)
            return Object.fromEntries(list.map(key => [key, syncStore[key]]))
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            if (rejectWrites) throw new Error('write failed')
            Object.assign(syncStore, items)
          }),
        },
        onChanged: {
          addListener: vi.fn((listener: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) => { storageListeners.add(listener) }),
          removeListener: vi.fn((listener: (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void) => { storageListeners.delete(listener) }),
        },
      },
    })
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
    vi.unstubAllGlobals()
  })

  async function renderProbes(): Promise<void> {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<><Probe id="overlay" /><Probe id="options" /></>)
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('synchronizes storage changes across mounted settings surfaces', async () => {
    await renderProbes()
    expect(container?.querySelector('[data-probe="overlay"]')?.getAttribute('data-accent')).toBe('aurora')
    expect(container?.querySelector('[data-probe="options"]')?.getAttribute('data-accent')).toBe('aurora')

    syncStore.themePreference = 'volt'
    await act(async () => {
      for (const listener of storageListeners) {
        listener({ themePreference: { oldValue: 'aurora', newValue: 'volt' } }, 'sync')
      }
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container?.querySelector('[data-probe="overlay"]')?.getAttribute('data-accent')).toBe('volt')
    expect(container?.querySelector('[data-probe="options"]')?.getAttribute('data-accent')).toBe('volt')
    expect(document.documentElement.style.getPropertyValue('--pulse-accent')).toBe('#f97316')
  })

  it('rolls an optimistic preference change back when persistence fails', async () => {
    await renderProbes()
    rejectWrites = true
    const button = container?.querySelector<HTMLButtonElement>('[data-probe="overlay"] button')
    await act(async () => {
      button?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    const probe = container?.querySelector('[data-probe="overlay"]')
    expect(probe?.getAttribute('data-accent')).toBe('aurora')
    expect(probe?.getAttribute('data-status')).toBe('Could not save')
  })
})
