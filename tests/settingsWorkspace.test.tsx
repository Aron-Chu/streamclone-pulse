// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsWorkspace } from '../src/ui/SettingsWorkspace.tsx'

vi.mock('../src/content/bridge.ts', () => ({
  sendBackgroundMessage: vi.fn(async ({ type }) => {
    if (type === 'HEALTH') return { type: 'HEALTH', ok: true }
    if (type === 'GET_UPDATE_CHECK_CAPABILITY') return { type: 'UPDATE_CHECK_CAPABILITY', supported: false, managedBy: 'development' }
    return { ok: true }
  }),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('SettingsWorkspace privacy and cache', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null
  let syncStore: Record<string, unknown>
  let sessionStore: Record<string, unknown>
  let rejectWrites: boolean

  beforeEach(() => {
    syncStore = { themePreference: 'volt', keepLocalCache: true }
    sessionStore = { 'pulse:channel-a': {}, 'pulse:channel-b': {} }
    rejectWrites = false
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-ext', getManifest: () => ({ version: '0.2.1' }) },
      storage: {
        sync: {
          get: vi.fn(async (keys: string | string[] | null) => {
            if (keys === null) return { ...syncStore }
            const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys)
            return Object.fromEntries(list.map(k => [k, syncStore[k]]))
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            if (rejectWrites) throw new Error('write failed')
            Object.assign(syncStore, items)
          }),
        },
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => {}),
        },
        session: {
          get: vi.fn(async () => ({ ...sessionStore })),
          remove: vi.fn(async () => {}),
        },
        onChanged: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
    vi.unstubAllGlobals()
  })

  it('does not offer a startup range override for full-stream charts', async () => {
    syncStore.defaultChartWindow = '60m'
    await act(async () => {
      root?.render(<SettingsWorkspace activeSection="pulse" />)
      await Promise.resolve()
    })
    expect(container?.textContent).toContain('Refresh live data automatically')
    expect(container?.textContent).not.toContain('Default chart range')
    expect(container?.querySelector('#settings-chart-window')).toBeNull()
    expect(syncStore.defaultChartWindow).toBe('60m')
  })

  it('rolls back checkbox state and preserves cached count on write failure', async () => {
    await act(async () => {
      root?.render(<SettingsWorkspace activeSection="privacy" />)
      await Promise.resolve()
    })

    const input = container?.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(input.checked).toBe(true)
    expect(container?.textContent).toContain('2 cached channels')

    rejectWrites = true
    await act(async () => {
      input.click()
      await Promise.resolve()
    })

    // sync store should not have changed
    expect(syncStore.keepLocalCache).toBe(true)
    // state must roll back to true
    expect(input.checked).toBe(true)
    // cache entry count must be preserved (not set to 0)
    expect(container?.textContent).toContain('2 cached channels')
    // actionable error banner displayed
    expect(container?.textContent).toContain('Could not update cache preference. Changes were reverted.')

    // dismiss error
    const dismissBtn = container?.querySelector('.pulse-settings-error-banner button') as HTMLButtonElement
    expect(dismissBtn).toBeTruthy()
    await act(async () => {
      dismissBtn.click()
      await Promise.resolve()
    })
    expect(container?.querySelector('.pulse-settings-error-banner')).toBeNull()
  })
})
