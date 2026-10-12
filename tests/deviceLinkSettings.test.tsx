// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupporterAccountState } from '../src/shared/supporterAccount.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Settings with and without the invited-tester device link (D20). Firefox
 * builds compile it out; Chrome, Edge and development builds keep it. The
 * page is driven through every button it offers, so the check does not depend
 * on which button or wording leads to the link.
 */

const pending: SupporterAccountState = { state: 'pending', code: 'ABCDE-12345', expiresAt: new Date(Date.now() + 600_000).toISOString(), retryAfterSeconds: 5 }
const cleanups: Array<() => void> = []

async function settings(target: string, account: SupporterAccountState) {
  vi.resetModules()
  vi.stubGlobal('__EXTENSION_TARGET__', target)
  const { SupporterJourney } = await import('../src/options/SupporterJourney.tsx')
  const actions: string[] = []
  const sendMessage = vi.fn(async (message: { type: string; action?: string }) => {
    if (message.type === 'SUPPORTER_ACCOUNT') {
      actions.push(message.action ?? '')
      return { type: 'SUPPORTER_ACCOUNT', account: message.action === 'start' ? pending : account }
    }
    if (message.type === 'SUPPORTER_ENTITLEMENT') return { type: 'SUPPORTER_ENTITLEMENT', entitlement: { state: 'not_linked' } }
    if (message.type === 'SUPPORTER_BILLING') return { type: 'SUPPORTER_BILLING', billing: { state: 'fallback' } }
    return undefined
  })
  const opened = vi.fn(async (_: { url: string }) => ({}))
  vi.stubGlobal('chrome', {
    runtime: { sendMessage },
    tabs: { create: opened },
    storage: {
      local: { set: vi.fn(), get: vi.fn(async () => ({})) },
      sync: { set: vi.fn(), get: vi.fn(async () => ({})) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  })
  vi.stubGlobal('open', vi.fn())
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<SupporterJourney />))
  cleanups.push(() => { act(() => root.unmount()); host.remove() })

  /** Click each button once, including ones that appear after a click. */
  async function clickEveryButton() {
    const clicked = new Set<string>()
    for (let i = 0; i < 25; i++) {
      const next = [...host.querySelectorAll('button')].find(button => !clicked.has(button.textContent ?? ''))
      if (!next) return
      clicked.add(next.textContent ?? '')
      await act(async () => { next.click() })
    }
  }
  const links = () => [...host.querySelectorAll('a')].map(a => a.getAttribute('href') ?? '').concat(opened.mock.calls.map(([tab]) => tab.url))
  return { host, actions, links, clickEveryButton }
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('settings without the device link (Firefox)', () => {
  it('offers no way to start a device link, whatever is clicked', async () => {
    for (const state of ['signed_out', 'relink_required', 'expired'] as const) {
      const page = await settings('firefox', { state })
      expect(page.host.textContent).not.toContain('Connect this extension')
      await page.clickEveryButton()
      expect(page.actions).not.toContain('start')
      expect(page.links().filter(link => link.includes('link-device'))).toEqual([])
    }
  })

  it('never shows a link code or its page', async () => {
    const page = await settings('firefox', pending)
    expect(page.host.textContent).not.toContain('ABCDE-12345')
    expect(page.links().filter(link => link.includes('link-device'))).toEqual([])
  })
})

describe('settings with the device link (Chrome, Edge, development)', () => {
  it('still starts a device link and opens its page', async () => {
    const page = await settings('cws', { state: 'signed_out' })
    await page.clickEveryButton()
    expect(page.actions).toContain('start')
    expect(page.links().some(link => link.includes('/account/link-device#code=ABCDE12345'))).toBe(true)
  })
})
