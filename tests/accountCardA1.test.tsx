// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SupporterJourney } from '../src/options/SupporterJourney.tsx'
import { joinedMessage, parseMyMoments, type AccountSavesSummary } from '../src/shared/myMoments.ts'
import type { SupporterAccountState } from '../src/shared/supporterAccount.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Aron's A1 Account row, O1 sign-out and the M1 line (local sandbox 2026-10-21).
const ACCOUNT_ID = '11111111-1111-4111-8111-1111111a1b2c'
const linked: SupporterAccountState = { state: 'linked', accountId: ACCOUNT_ID, expiresAt: new Date(Date.now() + 86_400_000).toISOString() }
const summary = (extra: Partial<AccountSavesSummary> = {}): AccountSavesSummary => ({
  signedIn: true, reached: true, saves: 128, notes: 3, syncedAt: Date.now(), unsent: 0, joined: null,
  profile: { displayName: 'pulse_viewer' }, ...extra,
})

async function mount(account: SupporterAccountState, answers: AccountSavesSummary[]) {
  let current = account
  const sendMessage = vi.fn(async (message: { type: string; action?: string; flush?: boolean }) => {
    if (message.type === 'SUPPORTER_ACCOUNT') {
      if (message.action === 'disconnect') current = { state: 'signed_out' }
      return { type: 'SUPPORTER_ACCOUNT', account: current }
    }
    if (message.type === 'SUPPORTER_ENTITLEMENT') return { type: 'SUPPORTER_ENTITLEMENT', entitlement: { state: 'ready', status: 'none', supportPeriods: 0, features: [], checkoutEnabled: false } }
    if (message.type === 'SUPPORTER_BILLING') return { type: 'SUPPORTER_BILLING', billing: { state: 'idle' } }
    if (message.type === 'TWITCH_SIGN_IN') return { type: 'TWITCH_SIGN_IN', status: { enabled: true, available: true, silentEligible: false, profile: null }, account: current }
    if (message.type === 'MY_MOMENTS' && message.action === 'account') return { type: 'MY_MOMENTS_ACCOUNT', account: answers.shift() ?? summary() }
    return undefined
  })
  vi.stubGlobal('chrome', {
    runtime: { sendMessage },
    tabs: { create: vi.fn() },
    storage: {
      local: { set: vi.fn(), get: vi.fn(async () => ({})) },
      sync: { set: vi.fn(), get: vi.fn(async () => ({})) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<SupporterJourney twitchStage="public" accountCard />))
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  const button = (name: string) => [...host.querySelectorAll('button')].find(element => element.textContent === name)
  return {
    host, sendMessage,
    row: () => host.querySelector('[data-account-a1]'),
    click: async (name: string) => { const target = button(name); if (!target) throw new Error(`no button ${name}`); await act(async () => target.click()) },
    order: () => sendMessage.mock.calls.map(([m]) => m.type === 'MY_MOMENTS' ? `account${m.flush ? ':flush' : ''}` : m.type === 'SUPPORTER_ACCOUNT' ? `account-state:${m.action}` : m.type),
    cleanup: () => { act(() => root.unmount()); host.remove() },
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('A1 Account row', () => {
  it('names the account, when this browser synced and how many saves it holds, and says once what sign-in added', async () => {
    const view = await mount(linked, [summary({ joined: { saves: 12, notes: 3 } })])
    expect(view.row()?.getAttribute('data-account-a1')).toBe('signed-in')
    expect(view.row()?.textContent).toContain('pulse_viewer')
    expect(view.row()?.textContent).toContain('Synced just now · 128 saves')
    expect(view.row()?.querySelector('a')?.getAttribute('href')).toBe('#moments')
    expect(view.host.textContent).toContain('Added 12 saves and 3 notes from this browser to your account.')
    // The StreamPulse row it replaces is gone.
    expect(view.host.querySelector('[data-row="account"]')).toBeNull()
    view.cleanup()
  })

  it('sends everything first, then signs out without asking again (O1)', async () => {
    const view = await mount(linked, [summary(), summary({ unsent: 0 })])
    await view.click('Sign out')
    const order = view.order()
    expect(order.indexOf('account:flush')).toBeGreaterThan(-1)
    expect(order.indexOf('account:flush')).toBeLessThan(order.indexOf('account-state:disconnect'))
    view.cleanup()
  })

  it('warns before clearing what could not be sent, and signs out only when asked again', async () => {
    const view = await mount(linked, [summary(), summary({ reached: false, unsent: 2 })])
    await view.click('Sign out')
    expect(view.host.textContent).toContain('2 changes haven’t reached your account yet')
    expect(view.order()).not.toContain('account-state:disconnect')
    await view.click('Sign out anyway')
    expect(view.order()).toContain('account-state:disconnect')
    view.cleanup()
  })

  it('offers sign-in when nobody is signed in', async () => {
    const view = await mount({ state: 'signed_out' }, [])
    expect(view.row()?.getAttribute('data-account-a1')).toBe('signed-out')
    expect(view.row()?.textContent).toContain('Sign in to keep your saves on every browser.')
    expect(view.row()?.textContent).toContain('Continue with Twitch')
    expect(view.order()).not.toContain('account')
    view.cleanup()
  })
})

describe('account summary request and sign-in line', () => {
  it('accepts only the account action with an optional flush', () => {
    expect(parseMyMoments({ type: 'MY_MOMENTS', action: 'account' })).toEqual({ type: 'MY_MOMENTS', action: 'account' })
    expect(parseMyMoments({ type: 'MY_MOMENTS', action: 'account', flush: true })).toEqual({ type: 'MY_MOMENTS', action: 'account', flush: true })
    expect(parseMyMoments({ type: 'MY_MOMENTS', action: 'account', flush: 'yes' })).toBeNull()
    expect(parseMyMoments({ type: 'MY_MOMENTS', action: 'account', accountId: ACCOUNT_ID })).toBeNull()
  })

  it('words the line as the site does', () => {
    expect(joinedMessage({ saves: 1, notes: 0 })).toBe('Added 1 save from this browser to your account.')
    expect(joinedMessage({ saves: 0, notes: 2 })).toBe('Added 2 notes from this browser to your account.')
    expect(joinedMessage({ saves: 1200, notes: 1 })).toBe('Added 1,200 saves and 1 note from this browser to your account.')
  })
})
