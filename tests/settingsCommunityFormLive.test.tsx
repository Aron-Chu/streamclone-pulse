// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsHostShell } from '../src/options/SettingsHostShell.tsx'
import { resetSupporterAppearanceForTests } from '../src/ui/useSupporterAppearance.ts'

// The private feedback form is off at launch (D19), so "Send feedback" makes no
// privacy promise. This file flips FEEDBACK_FORM_LIVE on, as the release after
// the form opens will, and checks the subline then says it is private.
vi.mock('../src/shared/feedbackPolicy.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/shared/feedbackPolicy.ts')>(),
  FEEDBACK_FORM_LIVE: true,
}))

vi.mock('../src/content/bridge.ts', () => ({
  sendBackgroundMessage: vi.fn(async () => ({ ok: true })),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let unmount: (() => void) | null = null

beforeEach(() => {
  resetSupporterAppearanceForTests()
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'test-extension',
      getURL: (path: string) => path,
      getManifest: () => ({ version: '0.2.2' }),
      sendMessage: vi.fn(async (message: { type: string }) => message.type === 'SUPPORTER_APPEARANCE'
        ? { type: 'SUPPORTER_APPEARANCE', finish: null, validForMs: 0 }
        : undefined),
    },
    storage: {
      sync: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
      session: { get: vi.fn(async () => ({})), remove: vi.fn(async () => {}) },
      onChanged: { addListener() {}, removeListener() {} },
    },
  })
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
})

afterEach(() => {
  unmount?.()
  unmount = null
  vi.unstubAllGlobals()
  delete (window as { matchMedia?: unknown }).matchMedia
  document.body.replaceChildren()
})

describe('with FEEDBACK_FORM_LIVE on, the Community card says feedback is private', () => {
  it('shows "Private to the team" under Send feedback, as its description', async () => {
    window.history.replaceState(null, '', '/options/index.html#updates')
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(<SettingsHostShell>{() => null}</SettingsHostShell>))
    for (let k = 0; k < 4; k++) await act(async () => { await Promise.resolve() })
    unmount = () => { act(() => root.unmount()); host.remove() }

    const feedback = host.querySelector('.pulse-host-community [data-community-link="feedback"]')!
    const small = feedback.querySelector('.pulse-host-community-copy > small')!
    expect(feedback.querySelector('.pulse-host-community-copy > span')?.textContent).toBe('Send feedback')
    expect(small.textContent).toBe('Private to the team')
    expect(feedback.getAttribute('aria-describedby')).toBe(small.id)
    // Discord stays public either way.
    expect(host.querySelector('.pulse-host-community [data-community-link="discord"] small')?.textContent).toBe('Public server')
  })
})
