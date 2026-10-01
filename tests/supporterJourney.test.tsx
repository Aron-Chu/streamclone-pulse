// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MEMBERSHIP_WATCH_DELAYS_MS, MEMBERSHIP_WATCH_MS, SupporterJourney, accountReference } from '../src/options/SupporterJourney.tsx'
import type { SupporterAccountAction, SupporterAccountState, SupporterEntitlement } from '../src/shared/supporterAccount.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ACCOUNT_ID = '11111111-1111-4111-8111-1111111a1b2c'
const linked: SupporterAccountState = { state: 'linked', accountId: ACCOUNT_ID, expiresAt: new Date(Date.now() + 86_400_000).toISOString() }
const pendingLink = (overrides: Record<string, unknown> = {}) => ({ state: 'pending', code: 'ABCDE-12345', expiresAt: new Date(Date.now() + 600_000).toISOString(), retryAfterSeconds: 5, ...overrides }) as SupporterAccountState
const ready = (status: string, extra: Partial<Extract<SupporterEntitlement, { state: 'ready' }>> = {}): SupporterEntitlement =>
  ({ state: 'ready', status, supportPeriods: status === 'none' ? 0 : 2, features: [], checkoutEnabled: true, ...extra }) as SupporterEntitlement

type Worker = {
  account: (action: SupporterAccountAction) => SupporterAccountState | Promise<SupporterAccountState> | Error
  entitlement: () => SupporterEntitlement | Promise<SupporterEntitlement> | Error
}

async function mount(worker: Worker, onEntitlement?: (value: SupporterEntitlement | null) => void) {
  const write = vi.fn()
  const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>) => void>()
  const sendMessage = vi.fn(async (message: { type: string; action?: SupporterAccountAction }) => {
    if (message.type === 'SUPPORTER_ACCOUNT') {
      const account = await worker.account(message.action!)
      if (account instanceof Error) throw account
      return { type: 'SUPPORTER_ACCOUNT', account }
    }
    if (message.type === 'SUPPORTER_ENTITLEMENT') {
      const entitlement = await worker.entitlement()
      if (entitlement instanceof Error) throw entitlement
      return { type: 'SUPPORTER_ENTITLEMENT', entitlement }
    }
    return undefined
  })
  const create = vi.fn(async () => ({}))
  vi.stubGlobal('chrome', {
    runtime: { sendMessage },
    tabs: { create },
    storage: {
      local: { set: write, get: vi.fn(async () => ({})) },
      sync: { set: write, get: vi.fn(async () => ({})) },
      onChanged: {
        addListener: (listener: (changes: Record<string, chrome.storage.StorageChange>) => void) => listeners.add(listener),
        removeListener: (listener: (changes: Record<string, chrome.storage.StorageChange>) => void) => listeners.delete(listener),
      },
    },
  })
  vi.stubGlobal('fetch', write)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<SupporterJourney onEntitlement={onEntitlement} />))
  const button = (name: string) => [...host.querySelectorAll('button')].find(element => element.textContent === name)
  return {
    host, sendMessage, create, write, listeners,
    text: () => host.textContent ?? '',
    state: () => host.querySelector('[data-journey-state]')?.getAttribute('data-journey-state'),
    link: () => host.querySelector<HTMLAnchorElement>('a[data-supporter-action="billing"]'),
    hrefs: () => [...host.querySelectorAll('a')].map(anchor => anchor.getAttribute('href') ?? ''),
    buttons: () => [...host.querySelectorAll('button')].map(element => element.textContent ?? ''),
    click: async (name: string) => { const target = button(name); if (!target) throw new Error(`no button ${name}: ${[...host.querySelectorAll('button')].map(b => b.textContent)}`); await act(async () => target.click()) },
    change: async (changes: Record<string, chrome.storage.StorageChange>) => { await act(async () => { for (const listener of listeners) listener(changes) }) },
    calls: (type: string, action?: string) => sendMessage.mock.calls.filter(([message]) => message.type === type && (action === undefined || message.action === action)).length,
    cleanup: () => { act(() => root.unmount()); host.remove() },
  }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); sessionStorage.clear() })

describe('one Supporter entry point', () => {
  it('starts linking for a purchase, opens the website with the prepared request, and shows one primary action', async () => {
    let account: SupporterAccountState = { state: 'signed_out' }
    const view = await mount({ account: action => action === 'start' ? (account = pendingLink({ pollingSecret: 'c'.repeat(64), unknownField: 'leak' })) : account, entitlement: () => ({ state: 'not_linked' }) })
    try {
      expect(view.state()).toBe('unlinked')
      expect(view.text()).toContain('Become a Pulse Supporter')
      expect(view.text()).toContain('US$4.99 / month')
      expect(view.text()).toContain('approve this extension on streampulse.stream')
      expect(view.host.querySelectorAll('.pulse-journey-primary')).toHaveLength(1)
      await view.click('Become a Supporter')
      expect(view.sendMessage).toHaveBeenCalledWith({ type: 'SUPPORTER_ACCOUNT', action: 'start' })
      // The worker resolves where to go; only the human code and a fixed flow name travel.
      expect(view.create).toHaveBeenCalledExactlyOnceWith({ url: 'https://streampulse.stream/account/link-device#code=ABCDE12345&then=billing' })
      expect(view.state()).toBe('link-pending')
      expect(view.text()).toContain('Finish on streampulse.stream')
      expect(view.text()).toContain('ABCDE-12345')
      expect(view.host.innerHTML).not.toContain('c'.repeat(64))
      expect(view.host.innerHTML).not.toContain('leak')
      expect(view.host.querySelector<HTMLAnchorElement>('a.pulse-journey-primary')?.href).toBe('https://streampulse.stream/account/link-device#code=ABCDE12345&then=billing')
      expect(view.write).not.toHaveBeenCalled()
    } finally { view.cleanup() }
  })

  it('connects an already-paid installation without a purchase continuation', async () => {
    let account: SupporterAccountState = { state: 'signed_out' }
    const view = await mount({ account: action => action === 'start' ? (account = pendingLink()) : account, entitlement: () => ({ state: 'not_linked' }) })
    try {
      await view.click('Already a Supporter? Connect')
      expect(view.create).toHaveBeenCalledExactlyOnceWith({ url: 'https://streampulse.stream/account/link-device#code=ABCDE12345' })
      expect(view.text()).toContain('This page updates by itself')
    } finally { view.cleanup() }
  })

  it('collapses repeated clicks into one link request', async () => {
    let release!: (value: SupporterAccountState) => void
    const view = await mount({
      account: action => action === 'start' ? new Promise(resolve => { release = resolve }) : { state: 'signed_out' },
      entitlement: () => ({ state: 'not_linked' }),
    })
    try {
      const button = [...view.host.querySelectorAll('button')].find(element => element.textContent === 'Become a Supporter')!
      await act(async () => { button.click(); button.click(); button.click() })
      expect(view.calls('SUPPORTER_ACCOUNT', 'start')).toBe(1)
      await act(async () => release(pendingLink()))
      expect(view.create).toHaveBeenCalledOnce()
    } finally { view.cleanup() }
  })

  it('polls the worker for approval at its interval, also while hidden, and stops on unmount', async () => {
    vi.useFakeTimers()
    const view = await mount({ account: action => action === 'cancel' ? { state: 'signed_out' } : pendingLink(), entitlement: () => ({ state: 'not_linked' }) })
    let unmounted = false
    try {
      const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
      await act(async () => { await vi.advanceTimersByTimeAsync(4_999) })
      expect(view.calls('SUPPORTER_ACCOUNT', 'poll')).toBe(0)
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      // The website tab has focus while the user approves; the worker owns the schedule.
      expect(view.calls('SUPPORTER_ACCOUNT', 'poll')).toBe(1)
      hidden.mockReturnValue(false)
      await act(async () => { window.dispatchEvent(new Event('focus')) })
      expect(view.calls('SUPPORTER_ACCOUNT', 'poll')).toBe(2)
      hidden.mockRestore()
      await view.click('Cancel')
      expect(view.sendMessage).toHaveBeenLastCalledWith({ type: 'SUPPORTER_ACCOUNT', action: 'cancel' })
      expect(view.text()).not.toContain('ABCDE-12345')
      view.cleanup(); unmounted = true
      const count = view.sendMessage.mock.calls.length
      await vi.advanceTimersByTimeAsync(60_000)
      expect(view.sendMessage).toHaveBeenCalledTimes(count)
    } finally { if (!unmounted) view.cleanup() }
  })

  it('continues the purchase after approval and turns Supporter on without a manual refresh', async () => {
    vi.useFakeTimers()
    let account: SupporterAccountState = { state: 'signed_out' }
    let membership: SupporterEntitlement = { state: 'not_linked' }
    const view = await mount({
      account: action => {
        if (action === 'start') account = pendingLink()
        return account
      },
      entitlement: () => membership,
    })
    try {
      await view.click('Become a Supporter')
      // Approval on the website: the worker's next poll completes the link and
      // signals the account revision.
      account = linked
      membership = ready('none')
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
      await view.change({ pulseAccountRevision: { newValue: 'linked' } })
      expect(view.state()).toBe('purchase-continuing')
      expect(view.text()).toContain('Complete your purchase on streampulse.stream')
      expect(view.link()?.href).toBe('https://streampulse.stream/account/billing')
      expect(view.text()).toContain(accountReference(ACCOUNT_ID))
      // Payment pending, then confirmed: the card follows on its own backoff.
      membership = ready('pending')
      await act(async () => { await vi.advanceTimersByTimeAsync(MEMBERSHIP_WATCH_DELAYS_MS[0]) })
      expect(view.state()).toBe('payment-pending')
      expect(view.text()).toContain('you do not need to pay again')
      membership = ready('active', { accessUntil: '2026-11-01T12:00:00Z', features: ['supporter.banner.v1', 'supporter.finish.v1'] })
      await act(async () => { await vi.advanceTimersByTimeAsync(MEMBERSHIP_WATCH_DELAYS_MS[1] + 10) })
      expect(view.state()).toBe('active')
      expect(view.text()).toContain('You are a Supporter')
      const settled = view.calls('SUPPORTER_ENTITLEMENT')
      await act(async () => { await vi.advanceTimersByTimeAsync(MEMBERSHIP_WATCH_MS) })
      expect(view.calls('SUPPORTER_ENTITLEMENT')).toBe(settled)
    } finally { view.cleanup() }
  })

  it('bounds its membership watch and leaves recovery to focus', async () => {
    vi.useFakeTimers()
    const view = await mount({ account: () => linked, entitlement: () => ready('pending') })
    try {
      expect(view.state()).toBe('payment-pending')
      await act(async () => { await vi.advanceTimersByTimeAsync(MEMBERSHIP_WATCH_MS + 60_000) })
      const bounded = view.calls('SUPPORTER_ENTITLEMENT')
      expect(bounded).toBeLessThanOrEqual(2 + Math.ceil(MEMBERSHIP_WATCH_MS / 30_000) + MEMBERSHIP_WATCH_DELAYS_MS.length)
      await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000) })
      expect(view.calls('SUPPORTER_ENTITLEMENT')).toBe(bounded)
      await act(async () => { window.dispatchEvent(new Event('focus')) })
      expect(view.calls('SUPPORTER_ENTITLEMENT')).toBe(bounded + 1)
    } finally { view.cleanup() }
  })
})

describe('membership states', () => {
  it.each<[string, SupporterEntitlement, string, string | null]>([
    ['offer', ready('none'), 'Continue to checkout', 'https://streampulse.stream/account/billing'],
    ['checkout-closed', ready('none', { checkoutEnabled: false }), '', null],
    ['active', ready('active', { accessUntil: '2026-11-01T12:00:00Z' }), 'Manage membership', 'https://streampulse.stream/account/billing'],
    ['grace', ready('grace', { accessUntil: '2026-10-19T12:00:00Z' }), 'Update payment method', 'https://streampulse.stream/account/billing'],
    ['expired', ready('expired'), 'Rejoin Supporter', 'https://streampulse.stream/account/billing'],
    ['expired', ready('expired', { checkoutEnabled: false }), 'Review membership', 'https://streampulse.stream/account/billing'],
    ['payment-pending', ready('pending'), 'View payment status', 'https://streampulse.stream/account/billing'],
    ['review', ready('review'), 'Review membership', 'https://streampulse.stream/account/billing'],
  ])('renders %s with one truthful action', async (state, entitlement, label, href) => {
    const view = await mount({ account: () => linked, entitlement: () => entitlement })
    try {
      expect(view.state()).toBe(state)
      expect(view.link()?.href ?? null).toBe(href)
      if (label) expect(view.link()?.textContent).toBe(label)
      expect(view.host.querySelectorAll('.pulse-journey-primary').length).toBeLessThanOrEqual(1)
      if (state === 'checkout-closed') {
        expect(view.text()).toContain('Supporter sign-ups are not open yet')
        expect(view.hrefs()).not.toContain('https://streampulse.stream/account/billing')
      }
      if (state === 'grace') {
        const date = new Date('2026-10-19T12:00:00Z').toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
        expect(view.text()).toContain(`stays on until ${date}`)
        expect(view.text()).not.toMatch(/7-day|seven days/)
      }
      if (state === 'active') {
        expect(view.text()).not.toContain('US$4.99 / month')
        expect(view.text()).toContain('2 months')
      }
      // A connected installation always names its account and can disconnect.
      expect(view.text()).toContain(accountReference(ACCOUNT_ID))
      expect(view.text()).toContain('does not link your Twitch identity')
      expect(view.buttons()).toContain('Disconnect extension')
      expect(view.text()).not.toContain('badge is active')
    } finally { view.cleanup() }
  })

  it.each<[SupporterEntitlement | Error, string]>([
    [{ state: 'unavailable', reason: 'not_deployed' }, 'not available on the server yet'],
    [{ state: 'unavailable', reason: 'temporarily_unavailable' }, 'temporarily unavailable'],
    [{ state: 'unavailable', reason: 'environment_mismatch' }, 'not open in this build yet'],
    [{ state: 'error' }, 'Could not reach StreamPulse'],
    [new Error('worker gone'), 'Could not reach StreamPulse'],
  ])('treats an unknown membership as unknown, never as an offer: %s', async (entitlement, copy) => {
    const view = await mount({ account: () => linked, entitlement: () => entitlement })
    try {
      expect(view.state()).toBe('membership-unknown')
      expect(view.text()).toContain(copy)
      expect(view.text()).toContain('free tools are unaffected')
      expect(view.link()).toBeNull()
      expect(view.text()).not.toContain('Become a Supporter')
      expect(view.text()).not.toContain('US$4.99 / month')
      expect(view.buttons()).toContain('Check again')
    } finally { view.cleanup() }
  })

  it('re-reads from Check again', async () => {
    let entitlement: SupporterEntitlement = { state: 'error' }
    const view = await mount({ account: () => linked, entitlement: () => entitlement })
    try {
      entitlement = ready('active')
      await view.click('Check again')
      expect(view.state()).toBe('active')
    } finally { view.cleanup() }
  })
})

describe('connection states', () => {
  it('shows a pending revocation with only a retry', async () => {
    const view = await mount({ account: () => ({ state: 'error', revocationPending: true }), entitlement: () => ({ state: 'not_linked' }) })
    try {
      expect(view.buttons()).toEqual(['Retry disconnect'])
      await view.click('Retry disconnect')
      expect(view.sendMessage).toHaveBeenLastCalledWith({ type: 'SUPPORTER_ACCOUNT', action: 'disconnect' })
    } finally { view.cleanup() }
  })

  it('reports an unconfirmed disconnect instead of claiming it worked', async () => {
    const view = await mount({ account: action => action === 'disconnect' ? { state: 'error' } : linked, entitlement: () => ready('none') })
    try {
      await view.click('Disconnect extension')
      expect(view.text()).toContain('server revocation could not be confirmed')
    } finally { view.cleanup() }
  })

  it('keeps a connection waiting on renewal distinct from a missing or unreachable service', async () => {
    const waiting = await mount({ account: () => ({ state: 'unavailable', reason: 'temporarily_unavailable', linked: true }), entitlement: () => ({ state: 'unavailable', reason: 'temporarily_unavailable' }) })
    try {
      expect(waiting.text()).toContain('still connected')
      expect(waiting.buttons()).toEqual(['Check again', 'Disconnect extension'])
    } finally { waiting.cleanup(); vi.unstubAllGlobals() }

    const missing = await mount({ account: () => ({ state: 'unavailable', reason: 'not_deployed' }), entitlement: () => ({ state: 'unavailable', reason: 'not_deployed' }) })
    try {
      // Linking that is not deployed is explained, never offered.
      expect(missing.text()).toContain('Account linking is not available on the server yet')
      expect(missing.buttons()).toEqual([])
      expect(missing.link()).toBeNull()
    } finally { missing.cleanup(); vi.unstubAllGlobals() }

    const down = await mount({ account: () => ({ state: 'unavailable', reason: 'temporarily_unavailable' }), entitlement: () => ({ state: 'not_linked' }) })
    try {
      expect(down.text()).toContain('could not be reached')
      expect(down.buttons()).toEqual(['Check again'])
      expect(down.text()).not.toContain('Become a Supporter')
    } finally { down.cleanup() }
  })

  it('explains a connection that vanished without the user asking, but not a deliberate disconnect', async () => {
    let account: SupporterAccountState = linked
    const view = await mount({ account: () => account, entitlement: () => ready('active') })
    try {
      // Revoked on the website: the worker's next read is simply signed out.
      account = { state: 'signed_out' }
      await view.change({ pulseAccountRevision: { newValue: 'revoked' } })
      expect(view.text()).toContain('was disconnected from your Pulse account')
      expect(view.buttons()).toContain('Become a Supporter')
      await view.change({ pulseAccountRevision: { newValue: 'again' } })
      expect(view.text()).toContain('was disconnected from your Pulse account')
    } finally { view.cleanup() }

    let mine: SupporterAccountState = linked
    const own = await mount({ account: action => action === 'disconnect' ? (mine = { state: 'signed_out' }) : mine, entitlement: () => ready('none') })
    try {
      await own.click('Disconnect extension')
      await own.change({ pulseAccountRevision: { newValue: 'disconnected' } })
      expect(own.text()).not.toContain('was disconnected from your Pulse account')
    } finally { own.cleanup() }
  })

  it.each([
    ['denied', 'declined'],
    ['expired', 'expired before it was approved'],
    ['relink_required', 'was disconnected from your Pulse account'],
  ] as const)('explains a %s request and offers to start again', async (state, copy) => {
    const view = await mount({ account: () => ({ state }), entitlement: () => ({ state: 'not_linked' }) })
    try {
      expect(view.text()).toContain(copy)
      expect(view.buttons()).toContain('Become a Supporter')
    } finally { view.cleanup() }
  })
})

describe('change signals and stale reads', () => {
  it('re-reads quietly on a projection signal and ignores unrelated storage changes', async () => {
    let entitlement: SupporterEntitlement = ready('none')
    const view = await mount({ account: () => linked, entitlement: () => entitlement })
    try {
      await view.change({ themePreference: { newValue: 'emerald' } })
      expect(view.calls('SUPPORTER_ENTITLEMENT')).toBe(1)
      entitlement = ready('active')
      await view.change({ pulseSupporterRevision: { newValue: 'changed' } })
      expect(view.calls('SUPPORTER_ENTITLEMENT')).toBe(2)
      expect(view.state()).toBe('active')
    } finally { view.cleanup() }
    expect(view.listeners.size).toBe(0)
  })

  it('keeps the last confirmed status on a failed quiet read, but never hands it to paid controls', async () => {
    let entitlement: SupporterEntitlement | Error = ready('active', { features: ['supporter.banner.v1', 'supporter.finish.v1'] })
    const onEntitlement = vi.fn()
    const view = await mount({ account: () => linked, entitlement: () => entitlement }, onEntitlement)
    try {
      expect(onEntitlement).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'active' }))
      entitlement = new Error('offline')
      await view.change({ pulseSupporterRevision: { newValue: 'changed' } })
      expect(view.state()).toBe('active')
      expect(view.host.querySelector('[data-journey-stale="true"]')).not.toBeNull()
      expect(onEntitlement).toHaveBeenLastCalledWith(null)
    } finally { view.cleanup() }
  })

  it.each(['pulseAccountRevision', 'backendUrl', 'localBackendOptIn'])('clears access at once when %s changes and drops the old response', async key => {
    const onEntitlement = vi.fn()
    let finishOld!: (value: SupporterEntitlement) => void
    let mode: 'first' | 'slow' | 'fresh' = 'first'
    const view = await mount({
      account: () => linked,
      entitlement: () => mode === 'first' ? ready('active') : mode === 'slow' ? new Promise(resolve => { finishOld = resolve }) : { state: 'not_linked' },
    }, onEntitlement)
    try {
      mode = 'slow'
      await view.change({ pulseSupporterRevision: { newValue: 'one' } })
      mode = 'fresh'
      await view.change({ [key]: { newValue: 'changed' } })
      expect(view.text()).not.toContain('Supporter active')
      expect(onEntitlement).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'not_linked' }))
      await act(async () => finishOld(ready('active')))
      expect(view.text()).not.toContain('Supporter active')
    } finally { view.cleanup() }
  })

  it('never writes storage or fetches directly; every message is a worker request', async () => {
    const view = await mount({ account: () => linked, entitlement: () => ready('active') })
    try {
      expect(view.write).not.toHaveBeenCalled()
      for (const [message] of view.sendMessage.mock.calls) expect(JSON.stringify(message)).not.toMatch(/checkout|portal|subscribe|equip|token|secret/i)
    } finally { view.cleanup() }
  })
})

describe('journey continuity across a settings reload', () => {
  it('keeps the purchase continuation for the website link, and forgets it once Supporter is active', async () => {
    let account: SupporterAccountState = { state: 'signed_out' }
    let membership: SupporterEntitlement = { state: 'not_linked' }
    const worker: Worker = { account: action => action === 'start' ? (account = pendingLink()) : account, entitlement: () => membership }
    const first = await mount(worker)
    await first.click('Become a Supporter')
    first.cleanup()
    const reloaded = await mount(worker)
    try {
      expect(reloaded.host.querySelector<HTMLAnchorElement>('a.pulse-journey-primary')?.href).toBe('https://streampulse.stream/account/link-device#code=ABCDE12345&then=billing')
      expect(JSON.stringify({ ...sessionStorage })).not.toContain('ABCDE')
      account = linked
      membership = ready('active')
      await reloaded.change({ pulseAccountRevision: { newValue: 'linked' } })
      expect(reloaded.text()).toContain('You are a Supporter')
      expect(sessionStorage.getItem('pulse.supporterJourneyIntent.v1')).toBeNull()
    } finally { reloaded.cleanup() }
  })
})
