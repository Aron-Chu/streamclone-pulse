// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://www.twitch.tv/fixturechan"}
import { act } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { mountOverlay, unmountOverlay } from '../src/content/mount.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
async function settle(fn: () => void) {
  await act(async () => { fn(); await new Promise(resolve => setTimeout(resolve, 0)) })
}
afterEach(async () => { await settle(unmountOverlay); vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('owns the 400ms geometry timer only while bottom placement is active, and releases it on unmount', async () => {
  const values: Record<string, unknown> = { overlayPlacement: 'bottom', overlayMode: 'expanded', defaultChartWindowMigratedToRecentV2: true }
  const listeners: ((changes: Record<string, unknown>, area: string) => void)[] = []
  const storage = { get: vi.fn(async () => values), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) }
  vi.stubGlobal('chrome', {
    runtime: { id: 'audit-timer', getManifest: () => ({ version: '0.2.7' }), getURL: (path: string) => path, sendMessage: vi.fn(async () => ({ ok: false })), onMessage: { addListener() {}, removeListener() {} } },
    storage: { sync: storage, local: storage, session: storage, onChanged: { addListener: (callback: typeof listeners[number]) => listeners.push(callback), removeListener() {} } },
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const active = new Set<number>()
  const nativeSet = window.setInterval.bind(window), nativeClear = window.clearInterval.bind(window)
  vi.spyOn(window, 'setInterval').mockImplementation((handler, timeout, ...args) => {
    const id = nativeSet(handler, timeout, ...args)
    if (timeout === 400) active.add(id)
    return id
  })
  vi.spyOn(window, 'clearInterval').mockImplementation(id => { if (id != null) active.delete(id); nativeClear(id) })
  await settle(() => mountOverlay('fixturechan', null, { kind: 'channel', login: 'fixturechan', vodId: null }, { sessionOpenedAtMs: 1 }))
  expect(active.size).toBe(1)
  for (const placement of ['right', 'sidebar', 'bottom']) {
    values.overlayPlacement = placement
    await settle(() => listeners.forEach(listener => listener({ overlayPlacement: { newValue: placement } }, 'sync')))
    expect(active.size).toBe(placement === 'bottom' ? 1 : 0)
  }
  await settle(unmountOverlay)
  expect(active.size).toBe(0)
})
