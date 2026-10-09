// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_COPY, MEMBERSHIP_WATCH_DELAYS_MS, MEMBERSHIP_WATCH_MS, SupporterJourney, accountReference } from '../src/options/SupporterJourney.tsx'
import type { SupporterAccountAction, SupporterAccountState, SupporterEntitlement, SupporterBillingState, SupporterRestoreState } from '../src/shared/supporterAccount.ts'
import type { TwitchSignInResponse, TwitchSignInStage } from '../src/shared/twitchSignIn.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ACCOUNT_ID = '11111111-1111-4111-8111-1111111a1b2c'
const linked: SupporterAccountState = { state: 'linked', accountId: ACCOUNT_ID, expiresAt: new Date(Date.now() + 86_400_000).toISOString() }
const pendingLink = (overrides: Record<string, unknown> = {}) => ({ state: 'pending', code: 'ABCDE-12345', expiresAt: new Date(Date.now() + 600_000).toISOString(), retryAfterSeconds: 5, ...overrides }) as SupporterAccountState
const ready = (status: string, extra: Partial<Extract<SupporterEntitlement, { state: 'ready' }>> = {}): SupporterEntitlement =>
  ({ state: 'ready', status, supportPeriods: status === 'none' ? 0 : 2, features: [], checkoutEnabled: true, ...(extra.installationAccountsEnabled ? { accountKind: 'installation', restoreEligible: true } : {}), ...extra }) as SupporterEntitlement

type Worker = {
  account: (action: SupporterAccountAction) => SupporterAccountState | Promise<SupporterAccountState> | Error
  entitlement: () => SupporterEntitlement | Promise<SupporterEntitlement> | Error
  billing?: (action: string) => SupporterBillingState | Promise<SupporterBillingState>
  restore?: (action: string, email?: string) => SupporterRestoreState | Promise<SupporterRestoreState>
  devices?: (action: string, deviceId?: string) => import('../src/shared/supporterAccount.ts').SupporterDevicesState
  twitch?: (message: { action: string; mode?: string; forceVerify?: boolean }) => Omit<TwitchSignInResponse, 'type'> | Promise<Omit<TwitchSignInResponse, 'type'>>
}

async function mount(worker: Worker, onEntitlement?: (value: SupporterEntitlement | null) => void, twitchStage: TwitchSignInStage = 'off') {
  const write = vi.fn()
  const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>) => void>()
  const sendMessage = vi.fn(async (message: { type: string; action?: string; email?: string; deviceId?: string; mode?: string; forceVerify?: boolean }) => {
    if (message.type === 'SUPPORTER_ACCOUNT') {
      const account = await worker.account(message.action as SupporterAccountAction)
      if (account instanceof Error) throw account
      return { type: 'SUPPORTER_ACCOUNT', account }
    }
    if (message.type === 'SUPPORTER_ENTITLEMENT') {
      const entitlement = await worker.entitlement()
      if (entitlement instanceof Error) throw entitlement
      return { type: 'SUPPORTER_ENTITLEMENT', entitlement }
    }
    if (message.type === 'SUPPORTER_BILLING') return { type: 'SUPPORTER_BILLING', billing: (await worker.billing?.(message.action!)) ?? { state: 'fallback' } }
    if (message.type === 'SUPPORTER_RESTORE' && worker.restore) return { type: 'SUPPORTER_RESTORE', restore: await worker.restore(message.action!, message.email) }
    if (message.type === 'SUPPORTER_DEVICES' && worker.devices) return { type: 'SUPPORTER_DEVICES', devices: worker.devices(message.action!, message.deviceId) }
    if (message.type === 'TWITCH_SIGN_IN' && worker.twitch) return { type: 'TWITCH_SIGN_IN', ...(await worker.twitch({ action: message.action!, mode: message.mode, forceVerify: message.forceVerify })) }
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
  await act(async () => root.render(<SupporterJourney onEntitlement={onEntitlement} twitchStage={twitchStage} />))
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

describe('pay-first settings', () => {
  it.each(['active', 'pending'] as const)('asks before disconnecting a %s installation and preserves it when canceled', async status => {
    const view = await mount({ account: () => linked, entitlement: () => ready(status, { accountKind: 'installation', installationAccountsEnabled: true }), billing: () => ({ state: status === 'pending' ? 'waiting' : 'idle' }) })
    try {
      await view.click('Sign out')
      expect(view.calls('SUPPORTER_ACCOUNT', 'disconnect')).toBe(0)
      expect(view.text()).toContain('does not cancel your subscription')
      await view.click('Stay signed in')
      expect(view.calls('SUPPORTER_ACCOUNT', 'disconnect')).toBe(0)
      expect(view.buttons()).not.toContain('Confirm sign out')
      await view.click('Sign out')
      await view.click('Confirm sign out')
      expect(view.calls('SUPPORTER_ACCOUNT', 'disconnect')).toBe(1)
    } finally { view.cleanup() }
  })
  it('keeps an unpaid checkout primary and offers a manual status check when automatic polling has paused', async () => {
    const view = await mount({ account: () => linked, entitlement: () => ready('none', { installationAccountsEnabled: true }), billing: () => ({ state: 'waiting', automaticPolling: false }) })
    try {
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe('Return to Stripe checkout')
      expect(view.text()).toContain('Automatic checks have paused')
      await view.click('Check payment status')
      expect(view.calls('SUPPORTER_BILLING', 'check')).toBe(1)
      expect(view.create).not.toHaveBeenCalled()
    } finally { view.cleanup() }
  })
  it('checks pending installation payments through the worker without opening website cookie billing', async () => {
    const view = await mount({ account: () => linked, entitlement: () => ready('pending', { accountKind: 'installation', installationAccountsEnabled: true }), billing: () => ({ state: 'idle' }) })
    try {
      expect(view.link()).toBeNull()
      await view.click('Check payment status')
      expect(view.calls('SUPPORTER_BILLING', 'check')).toBe(1)
      expect(view.create).not.toHaveBeenCalled()
    } finally { view.cleanup() }
  })
  it.each(['ineligible', 'conflict', 'expired', 'error'] as const)('never reads a worker restore, so a stale %s result cannot cover membership management', async result => {
    const view = await mount({ account: () => linked, entitlement: () => ready('active', { accountKind: 'installation', installationAccountsEnabled: true, restoreEligible: false }), restore: () => ({ state: result }), billing: () => ({ state: 'idle' }) })
    try {
      expect(view.calls('SUPPORTER_RESTORE')).toBe(0)
      expect(view.state()).toBe('active')
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe('Manage subscription')
      await view.click('Manage subscription')
      expect(view.calls('SUPPORTER_BILLING', 'portal')).toBe(1)
    } finally { view.cleanup() }
  })
  it.each([
    ['unavailable', { state: 'unavailable', reason: 'temporarily_unavailable' }],
    ['error', { state: 'error' }],
    ['not_linked', { state: 'not_linked' }],
    ['none', ready('none', { installationAccountsEnabled: true })],
    ['expired', ready('expired', { installationAccountsEnabled: true })],
    ['review', ready('review', { installationAccountsEnabled: true })],
  ] as Array<[string, SupporterEntitlement]>)('refreshes a %s UI projection after worker payment confirmation without another checkout', async (_name, initial) => {
    let membership = initial
    const onEntitlement = vi.fn()
    const view = await mount({ account: () => linked, entitlement: () => membership, billing: () => ({ state: 'active' }) }, onEntitlement)
    try {
      expect(view.state()).toBe('membership-loading')
      expect(view.host.querySelectorAll('.pulse-journey-primary')).toHaveLength(1)
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe('Check again')
      expect(view.text()).toContain('Check your current membership before starting another payment')
      expect(view.text()).not.toContain('Supporter active')
      expect(view.text()).not.toContain('Your Supporter finishes are unlocked')
      expect(view.buttons()).not.toContain('Rejoin Supporter')
      expect(view.buttons()).not.toContain('Become a Supporter')
      expect(view.buttons()).not.toContain('Manage subscription')
      expect(onEntitlement.mock.calls.some(([value]) => value?.state === 'ready' && (value.status === 'active' || value.status === 'grace'))).toBe(false)
      membership = ready('active', { installationAccountsEnabled: true })
      await view.click('Check again')
      expect(view.calls('SUPPORTER_ENTITLEMENT')).toBe(2)
      expect(view.calls('SUPPORTER_BILLING', 'status')).toBe(2)
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
      expect(view.calls('SUPPORTER_BILLING', 'portal')).toBe(0)
      expect(view.create).not.toHaveBeenCalled()
      expect(view.state()).toBe('active')
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe('Manage subscription')
      expect(onEntitlement).toHaveBeenLastCalledWith(membership)
    } finally { view.cleanup() }
  })
  it('keeps read-only recovery when a confirmed worker payment cannot refresh the UI entitlement', async () => {
    const onEntitlement = vi.fn()
    const view = await mount({ account: () => linked, entitlement: () => ({ state: 'error' }), billing: () => ({ state: 'active' }) }, onEntitlement)
    try {
      await view.click('Check again')
      expect(view.state()).toBe('membership-loading')
      expect(view.host.querySelectorAll('.pulse-journey-primary')).toHaveLength(1)
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe('Check again')
      expect(view.calls('SUPPORTER_ENTITLEMENT')).toBe(2)
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
      expect(view.calls('SUPPORTER_BILLING', 'portal')).toBe(0)
      expect(onEntitlement).toHaveBeenLastCalledWith({ state: 'error' })
      expect(view.text()).not.toContain('Supporter active')
      expect(view.create).not.toHaveBeenCalled()
    } finally { view.cleanup() }
  })
  it.each([
    ['active', 'Manage subscription'],
    ['grace', 'Update payment method'],
  ] as const)('keeps verified %s membership management above worker payment confirmation', async (status, label) => {
    const view = await mount({ account: () => linked, entitlement: () => ready(status, { installationAccountsEnabled: true }), billing: () => ({ state: 'active' }) })
    try {
      expect(view.state()).toBe(status)
      expect(view.host.querySelectorAll('.pulse-journey-primary')).toHaveLength(1)
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe(label)
      await view.click(label)
      expect(view.calls('SUPPORTER_BILLING', 'portal')).toBe(1)
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
      expect(view.create).not.toHaveBeenCalled()
    } finally { view.cleanup() }
  })
  it.each(['none', 'expired'] as const)('keeps an expired Checkout session read-only when the %s membership cannot open Checkout', async status => {
    for (const checkoutEnabled of [false, undefined]) {
      const view = await mount({ account: () => linked, entitlement: () => ready(status, { installationAccountsEnabled: true, checkoutEnabled }), billing: () => ({ state: 'expired' }) })
      try {
        expect(view.state()).toBe('checkout-closed')
        expect(view.host.querySelectorAll('.pulse-journey-primary')).toHaveLength(1)
        expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe('Check sign-up status')
        expect(view.text()).toContain('Return when paid sign-ups open')
        expect(view.buttons()).not.toContain('Start checkout again')
        expect(view.buttons()).not.toContain('Rejoin Supporter')
        await view.click('Check sign-up status')
        expect(view.calls('SUPPORTER_ENTITLEMENT')).toBeGreaterThan(1)
        expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
        expect(view.calls('SUPPORTER_BILLING', 'portal')).toBe(0)
        expect(view.create).not.toHaveBeenCalled()
      } finally { view.cleanup() }
    }
  })
  it.each(['none', 'expired'] as const)('allows one fresh Checkout after confirmed session expiry when the %s membership can open Checkout', async status => {
    let billing: SupporterBillingState = { state: 'expired' }
    const view = await mount({ account: () => linked, entitlement: () => ready(status, { installationAccountsEnabled: true, checkoutEnabled: true }), billing: action => action === 'checkout' ? (billing = { state: 'confirming' }) : billing })
    try {
      expect(view.state()).toBe('checkout-expired')
      expect(view.host.querySelectorAll('.pulse-journey-primary')).toHaveLength(1)
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe('Start checkout again')
      await view.click('Start checkout again')
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(1)
      expect(view.state()).toBe('payment-pending')
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe('Check payment status')
      expect(view.text()).toContain('Do not pay again')
      expect(view.buttons()).not.toContain('Start checkout again')
      expect(view.create).not.toHaveBeenCalled()
    } finally { view.cleanup() }
  })
  it.each([
    ['waiting', 'stripe-open', 'Return to Stripe checkout', 'resume'],
    ['confirming', 'payment-pending', 'Check payment status', 'check'],
    ['still_confirming', 'still-confirming', 'Check payment status', 'check'],
    ['reconnect_required', 'previous-payment-unresolved', 'Contact support', 'support'],
    ['review', 'review', 'Contact support', 'support'],
    ['closed', 'checkout-closed', 'Check sign-up status', 'read'],
    ['unavailable', 'billing-unavailable', 'Try again', 'read'],
    ['error', 'billing-unavailable', 'Try again', 'read'],
  ] as const)('keeps the %s action above an ended installation membership', async (billingState, journeyState, label, action) => {
    for (const checkoutEnabled of [true, false]) {
      const view = await mount({ account: () => linked, entitlement: () => ready('expired', { installationAccountsEnabled: true, checkoutEnabled }), billing: () => ({ state: billingState }) })
      try {
        expect(view.state()).toBe(journeyState)
        expect(view.host.querySelectorAll('.pulse-journey-primary')).toHaveLength(1)
        expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe(label)
        expect(view.buttons()).not.toContain('Rejoin Supporter')
        expect(view.buttons()).not.toContain('Manage subscription')
        expect(view.text()).not.toContain('US$4.99 / month')
        if (billingState === 'confirming' || billingState === 'still_confirming' || billingState === 'review') expect(view.text()).toContain('Do not pay again')
        if (action === 'support') {
          expect(view.host.querySelector<HTMLAnchorElement>('a.pulse-journey-primary')?.href).toBe('https://streampulse.stream/support')
        } else {
          await view.click(label)
          if (action === 'resume' || action === 'check') expect(view.calls('SUPPORTER_BILLING', action)).toBe(1)
          if (action === 'read') expect(view.calls('SUPPORTER_ENTITLEMENT')).toBeGreaterThan(1)
        }
        expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
        expect(view.calls('SUPPORTER_BILLING', 'portal')).toBe(0)
        expect(view.calls('SUPPORTER_ACCOUNT', 'start')).toBe(0)
        expect(view.create).not.toHaveBeenCalled()
      } finally { view.cleanup() }
    }
  })
  it.each(['confirming', 'review'] as const)('keeps payment %s recovery above installation membership review', async billingState => {
    const view = await mount({ account: () => linked, entitlement: () => ready('review', { installationAccountsEnabled: true }), billing: () => ({ state: billingState }) })
    try {
      expect(view.host.querySelectorAll('.pulse-journey-primary')).toHaveLength(1)
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe(billingState === 'review' ? 'Contact support' : 'Check payment status')
      expect(view.text()).toContain('Do not pay again')
      expect(view.buttons()).not.toContain('Manage subscription')
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
    } finally { view.cleanup() }
  })
  it.each([
    ['active', true, 'confirming', 'Manage subscription', 'portal'],
    ['grace', true, 'still_confirming', 'Update payment method', 'portal'],
    ['expired', true, 'idle', 'Rejoin Supporter', 'checkout'],
    ['expired', false, 'idle', 'Manage subscription', 'portal'],
    ['review', true, 'fallback', 'Manage subscription', 'portal'],
  ] as const)('keeps the ordinary %s installation action with Checkout %s and billing %s', async (status, checkoutEnabled, billingState, label, action) => {
    const view = await mount({ account: () => linked, entitlement: () => ready(status, { installationAccountsEnabled: true, checkoutEnabled }), billing: () => ({ state: billingState }) })
    try {
      expect(view.state()).toBe(status)
      expect(view.host.querySelectorAll('.pulse-journey-primary')).toHaveLength(1)
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe(label)
      await view.click(label)
      expect(view.calls('SUPPORTER_BILLING', action)).toBe(1)
      if (billingState === 'fallback') expect(view.create).toHaveBeenCalledWith({ url: 'https://streampulse.stream/account/billing' })
      else expect(view.create).not.toHaveBeenCalled()
    } finally { view.cleanup() }
  })
  it('requires explicit confirmation to revoke another connected extension and never offers peer revoke for this browser', async () => {
    const peer = '55555555-5555-4555-8555-555555555555'
    const view = await mount({ account: () => linked, entitlement: () => ready('active', { accountKind: 'installation', installationAccountsEnabled: true }), devices: action => action === 'revoke' ? { state: 'revoked' } : { state: 'ready', currentDeviceId: ACCOUNT_ID, devices: [{ id: ACCOUNT_ID, label: 'Chrome extension', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 900_000).toISOString() }, { id: peer, label: 'Chrome extension', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 900_000).toISOString() }] } })
    try {
      const details = view.host.querySelector('details')!
      await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')) })
      expect(view.buttons().filter(name => name === 'Revoke connection')).toHaveLength(1)
      await view.click('Revoke connection')
      expect(view.calls('SUPPORTER_DEVICES', 'revoke')).toBe(0)
      await view.click('Confirm revoke')
      expect(view.sendMessage).toHaveBeenCalledWith({ type: 'SUPPORTER_DEVICES', action: 'revoke', deviceId: peer })
      expect(view.text()).toContain('connection was revoked')
    } finally { view.cleanup() }
  })
  it('explains a sign-out it did not choose without offering email restore, a website account or a new payment', async () => {
    const view = await mount({ account: () => ({ state: 'relink_required' }), entitlement: () => ({ state: 'not_linked' }), billing: () => ({ state: 'idle' }) })
    try {
      expect(view.text()).toContain('This extension was disconnected from your StreamPulse account.')
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe('Supporter details')
      expect(view.buttons()).not.toContain('Become a Supporter')
      expect(view.buttons()).not.toContain('Restore my Supporter')
      expect(view.buttons()).not.toContain('Use a StreamPulse website account')
      expect(view.buttons()).not.toContain('Start a new membership')
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
      expect(view.calls('SUPPORTER_RESTORE')).toBe(0)
    } finally { view.cleanup() }
  })
  it.each([{ accountKind: 'email' as const, installationAccountsEnabled: true, restoreEligible: true }, { accountKind: 'installation' as const, installationAccountsEnabled: false, restoreEligible: true }, { accountKind: 'installation' as const, installationAccountsEnabled: true, restoreEligible: false }])('hides restore when server capability refuses this account: %s', async capability => {
    const view = await mount({ account: () => linked, entitlement: () => ready('none', capability), billing: () => ({ state: 'idle' }) })
    try { expect(view.buttons()).not.toContain('Restore my Supporter') } finally { view.cleanup() }
  })
  it.each(['active', 'grace', 'expired', 'review'])('never sends a known installation to an unrelated website cookie account when billing capability is off: %s', async status => {
    const view = await mount({ account: () => linked, entitlement: () => ready(status, { accountKind: 'installation', installationAccountsEnabled: false }), billing: () => ({ state: 'idle' }) })
    try {
      expect(view.host.querySelector('a[data-supporter-action="billing"]')).toBeNull()
      expect(view.text()).toContain('New Supporter sign-ups are temporarily unavailable')
      expect(view.host.querySelectorAll('.pulse-journey-primary')).toHaveLength(1)
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe(status === 'grace' ? 'Update payment method' : 'Manage subscription')
      await view.click(status === 'grace' ? 'Update payment method' : 'Manage subscription')
      expect(view.calls('SUPPORTER_BILLING', 'portal')).toBe(1)
      expect(view.create).not.toHaveBeenCalled()
    } finally { view.cleanup() }
  })
  it('checks a lost payment explicitly through the worker, never through an email restore', async () => {
    const view = await mount({ account: () => linked, entitlement: () => ready('none', { accountKind: 'installation', installationAccountsEnabled: true, restoreEligible: true }), billing: () => ({ state: 'still_confirming' }), restore: () => ({ state: 'pending', expiresAt: new Date(Date.now() + 900_000).toISOString(), comparisonCode: 'A3B4C5' }) })
    try {
      await view.click('Check payment status')
      expect(view.calls('SUPPORTER_BILLING', 'check')).toBe(1)
      await view.change({ pulseAccountRevision: { newValue: 'restore' } })
      expect(view.text()).not.toContain('A3B4C5')
      expect(view.calls('SUPPORTER_RESTORE')).toBe(0)
    } finally { view.cleanup() }
  })
  it('does not disguise an unrelated outage as an existing payment status', async () => {
    const view = await mount({ account: () => linked, entitlement: () => ready('none'), billing: () => ({ state: 'unavailable' }) })
    try { expect(view.buttons()).not.toContain('Check payment status'); expect(view.buttons()).toContain('Try again') } finally { view.cleanup() }
  })
  it('offers safe support for a payment under review instead of another payment', async () => {
    const view = await mount({ account: () => linked, entitlement: () => ready('none', { installationAccountsEnabled: true }), billing: () => ({ state: 'review' }) })
    try {
      const help = view.host.querySelector<HTMLAnchorElement>('a.pulse-journey-primary')!
      expect(help.textContent).toBe('Contact support')
      expect(help.href).toBe('https://streampulse.stream/support')
      expect(view.buttons()).not.toContain('Become a Supporter')
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
    } finally { view.cleanup() }
  })
  it('opens payment through the worker for a signed-in account and waits without a second purchase action', async () => {
    let membership: SupporterEntitlement = ready('none', { installationAccountsEnabled: true })
    let billing: SupporterBillingState = { state: 'idle' }
    const view = await mount({ account: () => linked, entitlement: () => membership, billing: action => {
      if (action === 'checkout') billing = { state: 'waiting', attemptId: 'safe-local-attempt' }
      return billing
    } })
    try {
      await view.click('Become a Supporter')
      expect(view.state()).toBe('stripe-open')
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(1)
      expect(view.calls('SUPPORTER_ACCOUNT', 'start')).toBe(0)
      expect(view.create).not.toHaveBeenCalled()
      expect(view.buttons()).toContain('Return to Stripe checkout')
      expect(view.buttons()).not.toContain('Become a Supporter')
      billing = { state: 'confirming' }
      await view.change({ pulseSupporterRevision: { newValue: 'pending' } })
      expect(view.state()).toBe('payment-pending')
      expect(view.text()).toContain('Do not pay again')
      expect(view.buttons()).not.toContain('Return to Stripe checkout')
      membership = ready('active', { installationAccountsEnabled: true }); billing = { state: 'idle' }
      await view.change({ pulseSupporterRevision: { newValue: 'active' } })
      expect(view.state()).toBe('active')
      expect(view.text()).toContain('You are a Supporter')
    } finally { view.cleanup() }
  })
  it('does not render an offer when a worker wait survives a settings reload', async () => {
    const view = await mount({ account: () => linked, entitlement: () => ready('none', { installationAccountsEnabled: true }), billing: () => ({ state: 'still_confirming' }) })
    try {
      expect(view.state()).toBe('still-confirming')
      expect(view.buttons()).not.toContain('Become a Supporter')
      expect(view.buttons()).toContain('Check payment status')
    } finally { view.cleanup() }
  })
  it('uses bearer Portal management through the worker for installation-capable accounts', async () => {
    const view = await mount({ account: () => linked, entitlement: () => ready('active', { installationAccountsEnabled: true }), billing: () => ({ state: 'idle' }) })
    try {
      expect(view.host.querySelectorAll('.pulse-journey-primary')).toHaveLength(1)
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe('Manage subscription')
      await view.click('Manage subscription')
      expect(view.calls('SUPPORTER_BILLING', 'portal')).toBe(1)
      expect(view.create).not.toHaveBeenCalled()
    } finally { view.cleanup() }
  })
  it.each(['idle', 'closed'] as const)('checks closed sign-ups through a read, with one primary action: %s', async billing => {
    let membership = ready('none', { installationAccountsEnabled: true, checkoutEnabled: false })
    let currentBilling: SupporterBillingState = { state: billing }
    const view = await mount({ account: () => linked, entitlement: () => membership, billing: () => currentBilling })
    try {
      expect(view.state()).toBe('checkout-closed')
      expect(view.host.querySelectorAll('.pulse-journey-primary')).toHaveLength(1)
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe('Check sign-up status')
      await view.click('Check sign-up status')
      expect(view.calls('SUPPORTER_ENTITLEMENT')).toBeGreaterThan(1)
      expect(view.calls('SUPPORTER_ACCOUNT', 'start')).toBe(0)
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
      expect(view.create).not.toHaveBeenCalled()
      expect(view.write).not.toHaveBeenCalled()
      expect(view.text()).toContain('Supporter sign-ups are not open yet')
      membership = ready('none', { installationAccountsEnabled: true, checkoutEnabled: true })
      currentBilling = { state: 'idle' }
      await view.click('Check sign-up status')
      expect(view.state()).toBe('offer')
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
    } finally { view.cleanup() }
  })
  it('has no email restore form anywhere: no email field, no restore messages', async () => {
    for (const account of [{ state: 'signed_out' }, { state: 'relink_required' }, linked] as SupporterAccountState[]) {
      const view = await mount({ account: () => account, entitlement: () => account.state === 'linked' ? ready('none', { accountKind: 'installation', installationAccountsEnabled: true, restoreEligible: true }) : { state: 'not_linked' }, billing: () => ({ state: 'reconnect_required' }), restore: () => ({ state: 'idle' }) })
      try {
        expect(view.host.querySelector('input[type="email"]')).toBeNull()
        expect(view.text()).not.toMatch(/Restore my Supporter|restore link|email you used at checkout/i)
        expect(view.calls('SUPPORTER_RESTORE')).toBe(0)
        expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
      } finally { view.cleanup() }
    }
  })
})

describe('Twitch sign-in off (stage A): signed out', () => {
  it('says sign-ups are not open, links Supporter details, and offers no purchase, restore or website account', async () => {
    const view = await mount({ account: () => ({ state: 'signed_out' }), entitlement: () => ({ state: 'not_linked' }) })
    try {
      expect(view.state()).toBe('signed-out')
      expect(view.text()).toContain('Supporter sign-ups are not open yet')
      expect(view.text()).toContain('When they open, you\'ll choose Continue with Twitch, then pay on Stripe. Free tools work without an account.')
      expect(view.text()).toContain('US$4.99 / month')
      // The card and the Account row both say who is here: nobody, and that is fine.
      expect(card(view.host).name().textContent).toBe('Not signed in')
      expect(accountRow(view.host)).toContain('Not signed in')
      expect(accountRow(view.host)).toContain('Free tools work without an account.')
      const primary = view.host.querySelectorAll<HTMLAnchorElement>('.pulse-journey-primary')
      expect(primary).toHaveLength(1)
      expect(primary[0].textContent).toBe('Supporter details')
      expect(primary[0].href).toBe('https://streampulse.stream/supporter')
      for (const gone of ['Become a Supporter', 'Restore my Supporter', 'Use a StreamPulse website account', 'Continue with Twitch']) expect(view.buttons()).not.toContain(gone)
      expect(view.text()).not.toMatch(/website account|restore/i)
      expect(view.text()).toContain('Twitch sign-in is coming soon.')
      // Nothing on this page asks the worker to buy, restore, or sign in with Twitch.
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
      expect(view.calls('SUPPORTER_RESTORE')).toBe(0)
      expect(view.calls('TWITCH_SIGN_IN')).toBe(0)
      expect(view.calls('SUPPORTER_ACCOUNT', 'start')).toBe(0)
      expect(view.create).not.toHaveBeenCalled()
    } finally { view.cleanup() }
  })

  it('keeps the invited-tester device link behind a closed disclosure, never as a purchase', async () => {
    let account: SupporterAccountState = { state: 'signed_out' }
    const view = await mount({ account: action => action === 'start' ? (account = pendingLink({ pollingSecret: 'c'.repeat(64), unknownField: 'leak' })) : account, entitlement: () => ({ state: 'not_linked' }) })
    try {
      const bridge = view.host.querySelector<HTMLDetailsElement>('details[data-tester-bridge]')!
      expect(bridge.open).toBe(false)
      expect(bridge.querySelector('summary')?.textContent).toBe('Invited tester? Connect this extension')
      expect(bridge.textContent).toContain('This is not a purchase.')
      await view.click('Connect this extension')
      expect(view.sendMessage).toHaveBeenCalledWith({ type: 'SUPPORTER_ACCOUNT', action: 'start' })
      // Only the human code travels, and no billing continuation.
      expect(view.create).toHaveBeenCalledExactlyOnceWith({ url: 'https://streampulse.stream/account/link-device#code=ABCDE12345' })
      expect(view.state()).toBe('link-pending')
      expect(view.text()).toContain('Finish on streampulse.stream')
      expect(view.text()).toContain('ABCDE-12345')
      expect(view.host.innerHTML).not.toContain('c'.repeat(64))
      expect(view.host.innerHTML).not.toContain('leak')
      expect(view.host.querySelector<HTMLAnchorElement>('a.pulse-journey-primary')?.href).toBe('https://streampulse.stream/account/link-device#code=ABCDE12345')
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
      expect(view.write).not.toHaveBeenCalled()
    } finally { view.cleanup() }
  })

  it('collapses repeated clicks into one link request', async () => {
    let release!: (value: SupporterAccountState) => void
    const view = await mount({
      account: action => action === 'start' ? new Promise(resolve => { release = resolve }) : { state: 'signed_out' },
      entitlement: () => ({ state: 'not_linked' }),
    })
    try {
      const button = [...view.host.querySelectorAll('button')].find(element => element.textContent === 'Connect this extension')!
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

  it('lets a connected tester continue to website checkout and turns Supporter on without a manual refresh', async () => {
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
      await view.click('Connect this extension')
      // Approval on the website: the worker's next poll completes the link and
      // signals the account revision.
      account = linked
      membership = ready('none')
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
      await view.change({ pulseAccountRevision: { newValue: 'linked' } })
      expect(view.state()).toBe('offer')
      await act(async () => view.link()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
      expect(view.state()).toBe('purchase-continuing')
      expect(view.text()).toContain('Complete your purchase on streampulse.stream')
      expect(view.link()?.href).toBe('https://streampulse.stream/account/billing')
      expect(view.text()).toContain(accountReference(ACCOUNT_ID))
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
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
    ['active', ready('active', { accessUntil: '2026-11-01T12:00:00Z' }), 'Manage subscription', 'https://streampulse.stream/account/billing'],
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
      expect(view.host.querySelectorAll('.pulse-journey-primary')).toHaveLength(1)
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
      // A connected tester always names the account and can sign out.
      expect(view.text()).toContain(accountReference(ACCOUNT_ID))
      expect(accountRow(view.host)).toContain('Connected to this extension')
      expect(view.buttons()).toContain('Sign out')
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
      expect(view.host.querySelectorAll('.pulse-journey-primary')).toHaveLength(1)
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe('Check again')
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
      expect(view.buttons()).toEqual(['Retry sign out'])
      await view.click('Retry sign out')
      expect(view.sendMessage).toHaveBeenLastCalledWith({ type: 'SUPPORTER_ACCOUNT', action: 'disconnect' })
    } finally { view.cleanup() }
  })

  it('reports an unconfirmed disconnect instead of claiming it worked', async () => {
    const view = await mount({ account: action => action === 'disconnect' ? { state: 'error' } : linked, entitlement: () => ready('none') })
    try {
      await view.click('Sign out')
      expect(view.text()).toContain('the server could not confirm it')
    } finally { view.cleanup() }
  })

  it('keeps a connection waiting on renewal distinct from a missing or unreachable service', async () => {
    const waiting = await mount({ account: () => ({ state: 'unavailable', reason: 'temporarily_unavailable', linked: true }), entitlement: () => ({ state: 'unavailable', reason: 'temporarily_unavailable' }) })
    try {
      expect(waiting.text()).toContain('still signed in')
      expect(waiting.buttons()).toEqual(['Check again', 'Sign out'])
      expect(waiting.host.querySelectorAll('.pulse-journey-primary')).toHaveLength(1)
    } finally { waiting.cleanup(); vi.unstubAllGlobals() }

    const missing = await mount({ account: () => ({ state: 'unavailable', reason: 'not_deployed' }), entitlement: () => ({ state: 'unavailable', reason: 'not_deployed' }) })
    try {
      // Linking that is not deployed is explained, never offered.
      expect(missing.text()).toContain('Account sign-in is not available on the server yet')
      expect(missing.buttons()).toEqual([])
      expect(missing.link()).toBeNull()
    } finally { missing.cleanup(); vi.unstubAllGlobals() }

    const down = await mount({ account: () => ({ state: 'unavailable', reason: 'temporarily_unavailable' }), entitlement: () => ({ state: 'not_linked' }) })
    try {
      expect(down.text()).toContain('could not be reached')
      expect(down.buttons()).toEqual(['Check again'])
      expect(down.host.querySelectorAll('.pulse-journey-primary')).toHaveLength(1)
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
      expect(view.text()).toContain('was disconnected from your StreamPulse account')
      expect(view.buttons()).not.toContain('Restore my Supporter')
      expect(view.host.querySelector('details[data-tester-bridge]')).not.toBeNull()
      await view.change({ pulseAccountRevision: { newValue: 'again' } })
      expect(view.text()).toContain('was disconnected from your StreamPulse account')
    } finally { view.cleanup() }

    let mine: SupporterAccountState = linked
    const own = await mount({ account: action => action === 'disconnect' ? (mine = { state: 'signed_out' }) : mine, entitlement: () => ready('none') })
    try {
      await own.click('Sign out')
      await own.change({ pulseAccountRevision: { newValue: 'disconnected' } })
      expect(own.text()).not.toContain('was disconnected from your StreamPulse account')
    } finally { own.cleanup() }
  })

  it.each([
    ['denied', 'declined'],
    ['expired', 'expired before it was approved'],
    ['relink_required', 'was disconnected from your StreamPulse account'],
  ] as const)('explains a %s request and lets a tester start again', async (state, copy) => {
    const view = await mount({ account: () => ({ state }), entitlement: () => ({ state: 'not_linked' }) })
    try {
      expect(view.text()).toContain(copy)
      expect(view.buttons()).toContain('Connect this extension')
      expect(view.buttons()).not.toContain('Become a Supporter')
    } finally { view.cleanup() }
  })
})

/**
 * The Account card closes the page, far below the card footer, so the outcome
 * of an action taken there is reported there: in a live region that exists
 * before the action, never only in the footer's status a screen away.
 */
describe('notices beside the action that caused them', () => {
  const sections = (host: HTMLElement) => {
    const account = [...host.querySelectorAll('section')].find(section => section.querySelector('h3')?.textContent === 'Account')!
    return {
      account,
      accountStatus: () => account.querySelector<HTMLElement>('[role="status"][data-account-notice]'),
      footer: () => host.querySelector<HTMLElement>('.pulse-journey-status')!.textContent ?? '',
    }
  }
  const DISCONNECT_UNCONFIRMED = 'the server could not confirm it'
  const MANAGE_FAILED = 'Could not open subscription management'

  it.each([
    ['returns an error', () => ({ state: 'error' }) as SupporterAccountState, DISCONNECT_UNCONFIRMED],
    ['throws', () => new Error('worker gone'), 'Sign out could not be confirmed'],
  ] as const)('reports a disconnect that %s in the Account card, not the card footer', async (_name, failure, copy) => {
    const view = await mount({ account: action => action === 'disconnect' ? failure() : linked, entitlement: () => ready('active', { accountKind: 'installation', installationAccountsEnabled: true }), billing: () => ({ state: 'idle' }) })
    try {
      const page = sections(view.host)
      // The live region is there, empty, before anything happens.
      expect(page.accountStatus()?.textContent).toBe('')
      await view.click('Sign out')
      await view.click('Confirm sign out')
      expect(view.calls('SUPPORTER_ACCOUNT', 'disconnect')).toBe(1)
      expect(page.accountStatus()?.textContent).toContain(copy)
      expect(page.footer()).not.toContain(copy)
    } finally { view.cleanup() }
  })

  it('reports a failed Manage subscription in the Account card, and the footer’s own Manage subscription in the footer', async () => {
    const view = await mount({ account: () => linked, entitlement: () => ready('active', { installationAccountsEnabled: true }), billing: action => action === 'portal' ? { state: 'error' } : { state: 'idle' } })
    try {
      const page = sections(view.host)
      await view.click('Manage subscription ↗')
      expect(view.calls('SUPPORTER_BILLING', 'portal')).toBe(1)
      expect(page.accountStatus()?.textContent).toContain(MANAGE_FAILED)
      expect(page.footer()).not.toContain(MANAGE_FAILED)

      await view.click('Manage subscription')
      expect(view.calls('SUPPORTER_BILLING', 'portal')).toBe(2)
      expect(page.footer()).toContain(MANAGE_FAILED)
      expect(page.accountStatus()?.textContent).toBe('')
    } finally { view.cleanup() }
  })

  it('keeps the Account card’s Manage subscription enabled and focused while it opens, ignores a second press, and reports the failure beside it', async () => {
    let answer: (billing: SupporterBillingState) => void = () => undefined
    const view = await mount({ account: () => linked, entitlement: () => ready('active', { installationAccountsEnabled: true }), billing: action => action === 'portal' ? new Promise<SupporterBillingState>(resolve => { answer = resolve }) : { state: 'idle' } })
    try {
      const page = sections(view.host)
      const manage = [...page.account.querySelectorAll('button')].find(button => button.textContent === 'Manage subscription ↗')!
      manage.focus()
      await act(async () => manage.click())
      // While the request is open: still enabled (a disabled button drops focus), marked busy, and a second press does nothing.
      expect(manage.disabled).toBe(false)
      expect(manage.getAttribute('aria-busy')).toBe('true')
      expect(document.activeElement).toBe(manage)
      await act(async () => manage.click())
      expect(view.calls('SUPPORTER_BILLING', 'portal')).toBe(1)
      await act(async () => answer({ state: 'error' }))
      expect(manage.hasAttribute('aria-busy')).toBe(false)
      expect(document.activeElement).toBe(manage)
      // The failure is stated in the Account card that holds the button.
      expect(page.accountStatus()?.textContent).toContain(MANAGE_FAILED)
      expect(manage.closest('section')).toBe(page.accountStatus()?.closest('section'))
      expect(page.footer()).not.toContain(MANAGE_FAILED)
    } finally { view.cleanup() }
  })

  it('reports a peer revoke in the Account card that lists the connections', async () => {
    const peer = '55555555-5555-4555-8555-555555555555'
    const view = await mount({ account: () => linked, entitlement: () => ready('active', { accountKind: 'installation', installationAccountsEnabled: true }), devices: action => action === 'revoke' ? { state: 'error' } : { state: 'ready', currentDeviceId: ACCOUNT_ID, devices: [{ id: ACCOUNT_ID, label: 'Chrome extension', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 900_000).toISOString() }, { id: peer, label: 'Chrome extension', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 900_000).toISOString() }] } })
    try {
      const page = sections(view.host)
      const details = view.host.querySelector('details')!
      await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')) })
      await view.click('Revoke connection')
      await view.click('Confirm revoke')
      expect(page.accountStatus()?.textContent).toContain('Could not revoke that connection')
      expect(page.footer()).not.toContain('Could not revoke')
    } finally { view.cleanup() }
  })

  it('keeps a retry from the footer’s pending revocation in the footer', async () => {
    const view = await mount({ account: () => ({ state: 'error', revocationPending: true }), entitlement: () => ({ state: 'not_linked' }) })
    try {
      const page = sections(view.host)
      await view.click('Retry sign out')
      expect(page.footer()).toContain(DISCONNECT_UNCONFIRMED)
      expect(page.accountStatus()?.textContent).toBe('')
    } finally { view.cleanup() }
  })
})

describe('the offer names what the banner sells', () => {
  // The settings banner sells three perks: title paint, the tenure crest and
  // emote rain. The "You get" line above the purchase button names each one.
  it.each([
    ['signed out', () => ({ state: 'signed_out' }) as SupporterAccountState, () => ({ state: 'not_linked' }) as SupporterEntitlement],
    ['linked without a membership', () => linked, () => ready('none')],
  ] as const)('lists title paint, the tenure crest and emote rain when %s', async (_name, account, entitlement) => {
    const view = await mount({ account, entitlement, billing: () => ({ state: 'idle' }) })
    try {
      const youGet = [...view.host.querySelectorAll('.pulse-supporter-detail')].find(line => line.querySelector('b')?.textContent === 'You get')?.textContent ?? ''
      expect(youGet).toMatch(/header accent/)
      expect(youGet).toMatch(/accent finishes/)
      expect(youGet).toMatch(/tenure crest beside your panel title that grows with your support/)
      expect(youGet).toMatch(/emote rain behind your Pulse panel/)
      expect(youGet).not.toMatch(/signature/i)
    } finally { view.cleanup() }
  })
})

describe('the price comes before the button that buys it', () => {
  // Reading and Tab order follow the DOM: a screen-reader or keyboard user must
  // hear the price and that it renews monthly before reaching the purchase
  // button, and at narrow widths the price sits above it.
  it.each<[string, () => SupporterAccountState, () => SupporterEntitlement, string]>([
    ['signed-out', () => ({ state: 'signed_out' }), () => ({ state: 'not_linked' }), 'Supporter details'],
    ['offer', () => linked, () => ready('none', { installationAccountsEnabled: true }), 'Become a Supporter'],
    ['offer', () => linked, () => ready('none'), 'Continue to checkout'],
    ['checkout-closed', () => linked, () => ready('none', { checkoutEnabled: false }), 'Check sign-up status'],
    ['expired', () => linked, () => ready('expired'), 'Rejoin Supporter'],
  ])('in the %s state, before "%s"', async (state, account, entitlement, label) => {
    const view = await mount({ account, entitlement })
    try {
      expect(view.state()).toBe(state)
      const primary = view.host.querySelector<HTMLElement>('.pulse-journey-primary')!
      expect(primary.textContent).toBe(label)
      const terms = view.host.querySelector<HTMLElement>('.pulse-supporter-terms')!
      expect(terms.textContent).toContain('US$4.99 / month')
      expect(terms.textContent).toContain('renews monthly until you cancel')
      const youGet = [...view.host.querySelectorAll('.pulse-supporter-detail')].find(line => line.querySelector('b')?.textContent === 'You get')!
      for (const line of [terms, youGet]) expect(line.compareDocumentPosition(primary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      // Beside the button's own column, not after the row that holds it.
      expect(terms.closest('.pulse-journey-main')).not.toBeNull()
    } finally { view.cleanup() }
  })
})

describe('Your card is a headed section', () => {
  // Pressing H from the page's h2 must stop at the card, before its name,
  // ladder, status and action, not skip to "Who sees what" below it.
  it.each<[string, () => SupporterAccountState, () => SupporterEntitlement, string, string]>([
    ['signed-out', () => ({ state: 'signed_out' }), () => ({ state: 'not_linked' }), 'Supporter sign-ups are not open yet', 'Supporter details'],
    ['grace', () => linked, () => ready('grace', { accessUntil: '2026-10-19T12:00:00Z' }), 'Payment needs attention', 'Update payment method'],
  ])('in the %s state', async (_state, account, entitlement, title, action) => {
    const view = await mount({ account, entitlement })
    try {
      const section = view.host.querySelector<HTMLElement>('section.pulse-supporter-card')!
      const headings = [...section.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')]
      expect(headings.map(heading => `${heading.tagName} ${heading.textContent}`)).toEqual(['H3 Your Supporter card'])
      const [heading] = headings
      expect(section.getAttribute('aria-labelledby')).toBe(heading.id)
      expect(heading.id).not.toBe('')
      expect(document.getElementById(heading.id)).toBe(heading)
      const status = section.querySelector('.pulse-journey-status')!
      expect(status.textContent).toContain(title)
      const primary = section.querySelector<HTMLElement>('.pulse-journey-primary')!
      expect(primary.textContent).toBe(action)
      for (const after of [section.querySelector('.pulse-supporter-card-who')!, section.querySelector('.pulse-supporter-ladder')!, status, primary]) {
        expect(heading.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      }
    } finally { view.cleanup() }
  })
})

const PERKS = ['supporter.banner.v1', 'supporter.finish.v1']
const HALO = { enabled: true, finish: 'halo' } as const
function card(host: HTMLElement) {
  const root = host.querySelector<HTMLElement>('.pulse-supporter-card')!
  return {
    root,
    name: () => root.querySelector<HTMLElement>('.pulse-supporter-card-who strong')!,
    sub: () => root.querySelector('.pulse-supporter-card-who > span')?.textContent ?? '',
    avatar: () => root.querySelector('.pulse-supporter-card-avatar')?.getAttribute('data-identity'),
    sample: () => root.querySelector('.pulse-supporter-card-sample') !== null,
    steps: () => [...root.querySelectorAll<HTMLElement>('.pulse-supporter-ladder li')].map(step => step.dataset.step),
    next: () => root.querySelector('.pulse-supporter-ladder-next')?.textContent ?? '',
  }
}
const accountRow = (host: HTMLElement) => host.querySelector('[data-row="account"] dd')?.textContent ?? ''

describe('Your card while the account is unknown', () => {
  it('claims neither an account nor sign-out before the account reply, then names the account', async () => {
    let answer!: (value: SupporterAccountState) => void
    const reply = new Promise<SupporterAccountState>(resolve => { answer = resolve })
    const view = await mount({ account: () => reply, entitlement: () => ready('active', { features: PERKS, cosmetics: HALO }) })
    try {
      const yours = card(view.host)
      expect(view.state()).toBe('loading')
      expect(yours.name().textContent).toBe('Checking your account…')
      expect(yours.avatar()).toBe('unknown')
      // The server-confirmed membership is stated, but nothing paints a status line as a name.
      expect(yours.name().querySelector('.pulse-paint, .pulse-crest')).toBeNull()
      expect(accountRow(view.host)).toContain('Checking the connection…')
      expect(view.text()).not.toContain('Not signed in')
      expect(view.text()).not.toContain('Free tools work without')
      expect(view.buttons()).not.toContain('Sign out')
      await act(async () => answer(linked))
      expect(yours.name().textContent).toBe(accountReference(ACCOUNT_ID))
      expect(yours.avatar()).toBe('pulse')
      expect(yours.name().querySelector('.pulse-paint')?.getAttribute('data-text')).toBe(accountReference(ACCOUNT_ID))
      expect(accountRow(view.host)).toContain('Connected to this extension')
    } finally { view.cleanup() }
  })

  it('says the account is unavailable, unpainted, when the account read fails but membership is active', async () => {
    const view = await mount({ account: () => new Error('worker asleep'), entitlement: () => ready('active', { features: PERKS, cosmetics: HALO }) })
    try {
      const yours = card(view.host)
      expect(view.state()).toBe('account-unavailable')
      expect(yours.name().textContent).toBe('Account unavailable')
      expect(yours.avatar()).toBe('unknown')
      expect(yours.name().querySelector('.pulse-paint, .pulse-crest')).toBeNull()
      expect(yours.sub()).not.toContain('Free tools work without')
      expect(accountRow(view.host)).toContain('Connection status unavailable')
      expect(view.text()).not.toContain('Not signed in')
    } finally { view.cleanup() }
  })

  it.each<[string, SupporterAccountState]>([
    ['an account error', { state: 'error' }],
    ['a pending revocation', { state: 'error', revocationPending: true }],
    ['an unreachable account service', { state: 'unavailable', reason: 'temporarily_unavailable' }],
  ])('stays neutral for %s', async (_label, account) => {
    const view = await mount({ account: () => account, entitlement: () => ({ state: 'not_linked' }) })
    try {
      const yours = card(view.host)
      expect(yours.name().textContent).toBe('Account unavailable')
      expect(yours.avatar()).toBe('unknown')
      expect(yours.sub()).toBe('Your free tools still work.')
      expect(accountRow(view.host)).toContain('Connection status unavailable')
      expect(view.text()).not.toContain('Not signed in')
    } finally { view.cleanup() }
  })

  it.each<SupporterAccountState>([
    { state: 'signed_out' },
    { state: 'denied' },
    { state: 'expired' },
    { state: 'relink_required' },
    { state: 'unavailable', reason: 'not_deployed' },
  ])('says Not signed in only when the account state is known: %o', async account => {
    const view = await mount({ account: () => account, entitlement: () => ({ state: 'not_linked' }) })
    try {
      const yours = card(view.host)
      expect(yours.name().textContent).toBe('Not signed in')
      expect(yours.avatar()).toBe('none')
      expect(yours.sub()).toBe('Free tools work without an account.')
      expect(accountRow(view.host)).toContain('Not signed in')
    } finally { view.cleanup() }
  })
})

describe('Your card states only the membership it knows', () => {
  const NEUTRAL_LADDER = ['off', 'off', 'off', 'off', 'off']
  const NEUTRAL_NEXT = 'A crest starts at New and grows at 3, 6, 12 and 24 months.'

  it('says it is checking, not "not a Supporter yet", while a linked account waits for the membership read', async () => {
    let answer!: (value: SupporterEntitlement) => void
    const reply = new Promise<SupporterEntitlement>(resolve => { answer = resolve })
    const view = await mount({ account: () => linked, entitlement: () => reply })
    try {
      const yours = card(view.host)
      expect(view.state()).toBe('membership-loading')
      expect(yours.name().textContent).toBe(accountReference(ACCOUNT_ID))
      expect(yours.sub()).toBe('StreamPulse account · checking membership…')
      expect(yours.sample()).toBe(false)
      expect(yours.steps()).toEqual(NEUTRAL_LADDER)
      expect(yours.next()).toBe(NEUTRAL_NEXT)
      expect(view.text()).not.toContain('not a Supporter yet')
      await act(async () => answer(ready('active', { supportPeriods: 7, features: PERKS, cosmetics: HALO })))
      expect(yours.sub()).toBe('Pulse Supporter · 7 months')
      expect(yours.steps()).toEqual(['past', 'past', 'current', 'off', 'off'])
    } finally { view.cleanup() }
  })

  it('treats a linked account still reported as not linked as checking', async () => {
    const view = await mount({ account: () => linked, entitlement: () => ({ state: 'not_linked' }) })
    try {
      expect(card(view.host).sub()).toBe('StreamPulse account · checking membership…')
      expect(card(view.host).sample()).toBe(false)
    } finally { view.cleanup() }
  })

  it.each<[string, SupporterEntitlement | Error]>([
    ['an error', { state: 'error' }],
    ['a temporarily unavailable service', { state: 'unavailable', reason: 'temporarily_unavailable' }],
    ['Supporter not deployed', { state: 'unavailable', reason: 'not_deployed' }],
    ['a thrown read', new Error('worker gone')],
  ])('says the membership is unavailable after %s, matching the footer', async (_label, entitlement) => {
    const view = await mount({ account: () => linked, entitlement: () => entitlement })
    try {
      const yours = card(view.host)
      expect(view.state()).toBe('membership-unknown')
      expect(yours.sub()).toBe('StreamPulse account · membership status unavailable')
      expect(yours.sample()).toBe(false)
      expect(yours.steps()).toEqual(NEUTRAL_LADDER)
      expect(yours.next()).toBe(NEUTRAL_NEXT)
      expect(view.text()).not.toContain('not a Supporter yet')
    } finally { view.cleanup() }
  })

  it('claims nothing about membership before the account answers', async () => {
    const view = await mount({ account: () => new Promise<SupporterAccountState>(() => {}), entitlement: () => new Promise<SupporterEntitlement>(() => {}) })
    try {
      const yours = card(view.host)
      expect(yours.name().textContent).toBe('Checking your account…')
      expect(yours.sub()).toBe('Your free tools still work.')
      expect(yours.sample()).toBe(false)
      expect(yours.steps()).toEqual(NEUTRAL_LADDER)
      expect(view.text()).not.toMatch(/not a Supporter yet|Not signed in|Free tools work without/)
    } finally { view.cleanup() }
  })

  it('names a membership under review and holds the crest it earned', async () => {
    const view = await mount({ account: () => linked, entitlement: () => ready('review', { supportPeriods: 13, features: PERKS, cosmetics: HALO }) })
    try {
      const yours = card(view.host)
      expect(view.state()).toBe('review')
      expect(yours.sub()).toBe('StreamPulse account · membership needs review')
      expect(yours.steps()).toEqual(['past', 'past', 'past', 'current', 'off'])
      expect(yours.next()).toBe('Year-one crest earned · on hold while your membership is reviewed')
      expect(view.text()).not.toContain('not a Supporter yet')
      expect(view.text()).not.toContain('Your crest starts at New')
    } finally { view.cleanup() }
  })

  it.each<[string, SupporterEntitlement, string]>([
    ['pending', ready('pending', { supportPeriods: 0 }), 'StreamPulse account · payment confirming'],
    ['none', ready('none'), 'StreamPulse account · not a Supporter yet'],
    ['expired', ready('expired'), 'StreamPulse account · Supporter ended'],
  ])('states a known %s membership as the server reports it', async (_status, entitlement, line) => {
    const view = await mount({ account: () => linked, entitlement: () => entitlement })
    try {
      const yours = card(view.host)
      expect(yours.sub()).toBe(line)
      expect(yours.sample()).toBe(true)
      expect(yours.steps()).toEqual(['start', 'off', 'off', 'off', 'off'])
      expect(yours.next()).toBe('Your crest starts at New and grows at 3, 6, 12 and 24 months.')
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

  it.each<[string, () => SupporterEntitlement | Error]>([
    ['a thrown read', () => new Error('offline')],
    ['an error', () => ({ state: 'error' })],
    ['a temporarily unavailable service', () => ({ state: 'unavailable', reason: 'temporarily_unavailable' })],
  ])('keeps the last confirmed status and look after %s on a quiet read, but never hands it to paid controls', async (_label, failure) => {
    let entitlement: SupporterEntitlement | Error = ready('active', { features: PERKS, cosmetics: HALO })
    const onEntitlement = vi.fn()
    const view = await mount({ account: () => linked, entitlement: () => entitlement }, onEntitlement)
    try {
      expect(onEntitlement).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'active' }))
      entitlement = failure()
      await view.change({ pulseSupporterRevision: { newValue: 'changed' } })
      expect(view.state()).toBe('active')
      expect(view.host.querySelector('[data-journey-stale="true"]')).not.toBeNull()
      expect(onEntitlement).toHaveBeenLastCalledWith(null)
      // The card still wears the confirmed look: no sample tag, the paint and crest stay.
      const yours = card(view.host)
      expect(yours.root.dataset.supporterCard).toBe('own')
      expect(yours.sample()).toBe(false)
      expect(yours.name().querySelector('.pulse-paint')?.getAttribute('data-finish')).toBe('halo')
      expect(yours.name().querySelector('.pulse-crest')).not.toBeNull()
      expect(yours.root.style.getPropertyValue('--spk-fin')).toBe('#e6a9d6')
      expect(yours.sub()).toBe('Pulse Supporter · 2 months')
    } finally { view.cleanup() }
  })

  it('never tags a Supporter’s card as a sample, even when the server withholds the look', async () => {
    const view = await mount({ account: () => linked, entitlement: () => ready('active', { features: [] }) })
    try {
      const yours = card(view.host)
      expect(yours.sub()).toBe('Pulse Supporter · 2 months')
      expect(yours.sample()).toBe(false)
      expect(yours.name().querySelector('.pulse-paint')).toBeNull()
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
  it('keeps a tester connection in progress across a reload, and forgets the journey once Supporter is active', async () => {
    let account: SupporterAccountState = { state: 'signed_out' }
    let membership: SupporterEntitlement = { state: 'not_linked' }
    const worker: Worker = { account: action => action === 'start' ? (account = pendingLink()) : account, entitlement: () => membership }
    const first = await mount(worker)
    await first.click('Connect this extension')
    first.cleanup()
    const reloaded = await mount(worker)
    try {
      expect(reloaded.host.querySelector<HTMLAnchorElement>('a.pulse-journey-primary')?.href).toBe('https://streampulse.stream/account/link-device#code=ABCDE12345')
      expect(JSON.stringify({ ...sessionStorage })).not.toContain('ABCDE')
      account = linked
      membership = ready('active')
      await reloaded.change({ pulseAccountRevision: { newValue: 'linked' } })
      expect(reloaded.text()).toContain('Supporter active')
      expect(sessionStorage.getItem('pulse.supporterJourneyIntent.v1')).toBeNull()
    } finally { reloaded.cleanup() }
  })
})

/**
 * Account journey spec (closeout 2026-10-08b) §2 E2 and §3: with Twitch
 * sign-in compiled on, the journey is Continue with Twitch → Become a
 * Supporter (worker Checkout for a signed-in account) → Manage subscription
 * (a recent Twitch check when the server asks) → Sign out.
 */
describe('Continue with Twitch (tester and public stages)', () => {
  const PROFILE = { displayName: 'PulseViewer' }
  const twitchStatus = (overrides: Partial<TwitchSignInResponse['status']> = {}) => ({ enabled: true, available: true, silentEligible: false, profile: null, ...overrides })
  const twitchAccount = (status: string, extra: Partial<Extract<SupporterEntitlement, { state: 'ready' }>> = {}) => ready(status, { accountKind: 'twitch', ...extra })

  it.each(['tester', 'public'] as const)('signs out to Continue with Twitch, with the device link only under testers (%s)', async stage => {
    const view = await mount({ account: () => ({ state: 'signed_out' }), entitlement: () => ({ state: 'not_linked' }), twitch: () => ({ status: twitchStatus(), account: { state: 'signed_out' } }) }, undefined, stage)
    try {
      expect(view.state()).toBe('signed-out')
      const button = view.host.querySelector<HTMLButtonElement>('button[data-twitch-signin]')!
      expect(button.textContent).toBe('Continue with Twitch')
      expect(button.disabled).toBe(false)
      // One verb for signing in: the spec's "Continue with Twitch", never a second "Sign in with Twitch".
      expect(view.host.querySelector('.pulse-journey-title')?.textContent).toBe('Supporter starts with Twitch sign-in')
      expect(view.text()).toContain('Choose Continue with Twitch, then pay on Stripe. Free tools work without an account.')
      expect(view.text()).not.toContain('Sign in with Twitch')
      expect(view.text().includes('Twitch sign-in is open to invited testers right now.')).toBe(stage === 'tester')
      expect(view.host.querySelector('details[data-tester-bridge] summary')?.textContent).toBe('Other ways to connect (testers)')
      expect(view.host.querySelector<HTMLDetailsElement>('details[data-tester-bridge]')!.open).toBe(false)
      expect(view.hrefs()).toContain('https://streampulse.stream/supporter')
      for (const gone of ['Become a Supporter', 'Restore my Supporter', 'Use a StreamPulse website account']) expect(view.buttons()).not.toContain(gone)
      // Reinstall and new browsers come back through the same Twitch account.
      expect(view.host.querySelector('[data-row="new-browser"]')?.textContent).toContain('Continue with Twitch with the same Twitch account.')
      expect(view.host.querySelector('[data-row="lost-twitch"]')?.textContent).toContain('That changes billing only.')
      // A signed-out page never asks the worker for Checkout, a restore, or a silent sign-in it was not offered.
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
      expect(view.calls('SUPPORTER_RESTORE')).toBe(0)
      expect(view.sendMessage.mock.calls.some(([message]) => message.type === 'TWITCH_SIGN_IN' && message.mode === 'silent')).toBe(false)
    } finally { view.cleanup() }
  })

  it('signs in through the worker and names the Twitch account for display only', async () => {
    let account: SupporterAccountState = { state: 'signed_out' }
    let membership: SupporterEntitlement = { state: 'not_linked' }
    const view = await mount({
      account: () => account,
      entitlement: () => membership,
      twitch: message => {
        if (message.action === 'sign_in') { account = linked; membership = twitchAccount('none', { checkoutEnabled: false }); return { status: twitchStatus({ profile: PROFILE }), account, outcome: 'signed_in' } }
        return { status: twitchStatus({ profile: account.state === 'linked' ? PROFILE : null }), account }
      },
    }, undefined, 'public')
    try {
      await view.click('Continue with Twitch')
      expect(view.sendMessage).toHaveBeenCalledWith({ type: 'TWITCH_SIGN_IN', action: 'sign_in', mode: 'interactive' })
      expect(card(view.host).name().textContent).toBe('PulseViewer')
      expect(accountRow(view.host)).toContain('Signed in with Twitch as PulseViewer')
      expect(card(view.host).sub()).toContain('Signed in with Twitch')
      // Closed sign-ups: truthful, and no purchase.
      expect(view.state()).toBe('checkout-closed')
      expect(view.text()).toContain('Supporter sign-ups are not open yet')
      expect(view.buttons()).not.toContain('Become a Supporter')
      expect(view.buttons()).toContain('Sign out')
      expect(view.buttons()).toContain('Use a different Twitch account')
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
      expect(view.write).not.toHaveBeenCalled()
    } finally { view.cleanup() }
  })

  it('tries silent sign-in once, only when the worker says this is a true first install', async () => {
    const silent: string[] = []
    const eligible = await mount({ account: () => ({ state: 'signed_out' }), entitlement: () => ({ state: 'not_linked' }), twitch: message => {
      if (message.action === 'sign_in') silent.push(String(message.mode))
      return { status: twitchStatus({ silentEligible: message.action === 'status' && silent.length === 0 }), account: { state: 'signed_out' }, ...(message.action === 'sign_in' ? { outcome: 'interaction_required' as const } : {}) }
    } }, undefined, 'public')
    try {
      expect(silent).toEqual(['silent'])
      // A silent attempt that cannot finish leaves the button and explains nothing.
      expect(eligible.text()).not.toContain('Select Continue with Twitch')
      expect(eligible.host.querySelector('button[data-twitch-signin]')).not.toBeNull()
    } finally { eligible.cleanup() }
    // After Sign out or a server revoke the worker reports not eligible: no silent attempt.
    const after = await mount({ account: () => ({ state: 'relink_required' }), entitlement: () => ({ state: 'not_linked' }), twitch: message => {
      if (message.action === 'sign_in') silent.push(String(message.mode))
      return { status: twitchStatus({ silentEligible: false }), account: { state: 'relink_required' } }
    } }, undefined, 'public')
    try {
      expect(silent).toEqual(['silent'])
      expect(after.text()).toContain('You were signed out on this browser. Continue with Twitch to sign in again.')
    } finally { after.cleanup() }
  })

  it.each<[string, string]>([
    ['pilot_only', 'Twitch sign-in is open to invited testers right now.'],
    ['link_required', 'Invited testers: link Twitch to your StreamPulse account on streampulse.stream first'],
    ['identity_in_use', 'We never combine accounts.'],
  ])('explains %s with tester copy and creates nothing', async (outcome, copy) => {
    const view = await mount({ account: () => ({ state: 'signed_out' }), entitlement: () => ({ state: 'not_linked' }), twitch: message => ({ status: twitchStatus(), account: { state: 'signed_out' }, ...(message.action === 'sign_in' ? { outcome: outcome as TwitchSignInResponse['outcome'] } : {}) }) }, undefined, 'tester')
    try {
      await view.click('Continue with Twitch')
      expect(view.host.querySelector('.pulse-journey-notice')?.textContent).toContain(copy)
      expect(view.state()).toBe('signed-out')
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
    } finally { view.cleanup() }
  })

  it('shows only the button after a server revoke', async () => {
    const view = await mount({ account: () => ({ state: 'signed_out' }), entitlement: () => ({ state: 'not_linked' }), twitch: message => ({ status: twitchStatus(), account: { state: 'signed_out' }, ...(message.action === 'sign_in' ? { outcome: 'revoked' as const } : {}) }) }, undefined, 'public')
    try {
      await view.click('Continue with Twitch')
      expect(view.host.querySelector('.pulse-journey-notice')).toBeNull()
      expect(view.host.querySelector('button[data-twitch-signin]')?.textContent).toBe('Continue with Twitch')
    } finally { view.cleanup() }
  })

  it('becomes a Supporter through worker Checkout, gated on a signed-in account', async () => {
    let billing: SupporterBillingState = { state: 'idle' }
    const view = await mount({ account: () => linked, entitlement: () => twitchAccount('none'), billing: action => action === 'checkout' ? (billing = { state: 'waiting', attemptId: 'safe-local-attempt' }) : billing, twitch: () => ({ status: twitchStatus({ profile: PROFILE }), account: linked }) }, undefined, 'public')
    try {
      expect(view.state()).toBe('offer')
      expect(view.text()).toContain('It can be different from your Twitch email')
      await view.click('Become a Supporter')
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(1)
      expect(view.calls('SUPPORTER_ACCOUNT', 'start')).toBe(0)
      expect(view.state()).toBe('stripe-open')
      expect(view.create).not.toHaveBeenCalled()
    } finally { view.cleanup() }
  })

  it('sends an invited tester whose account the server refuses for bearer Checkout to the website, without a second payment', async () => {
    const view = await mount({ account: () => linked, entitlement: () => ready('none', { accountKind: 'email' }), billing: action => action === 'checkout' ? { state: 'fallback' } : { state: 'idle' }, twitch: () => ({ status: twitchStatus(), account: linked }) }, undefined, 'tester')
    try {
      await view.click('Become a Supporter')
      expect(view.create).toHaveBeenCalledExactlyOnceWith({ url: 'https://streampulse.stream/account/billing' })
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(1)
    } finally { view.cleanup() }
  })

  it('asks "Confirm it’s you" when the portal needs a recent Twitch check, and opens nothing until the click succeeds', async () => {
    let gate = true
    const view = await mount({ account: () => linked, entitlement: () => twitchAccount('active', { features: PERKS }), billing: action => {
      if (action === 'portal') return { state: 'step_up_required' }
      if (action === 'portal_confirm') { const answer: SupporterBillingState = gate ? { state: 'step_up_required' } : { state: 'idle' }; gate = false; return answer }
      return { state: 'idle' }
    }, twitch: () => ({ status: twitchStatus({ profile: PROFILE }), account: linked }) }, undefined, 'public')
    try {
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe('Manage subscription')
      await view.click('Manage subscription')
      expect(view.calls('SUPPORTER_BILLING', 'portal')).toBe(1)
      expect(view.state()).toBe('confirm-identity')
      expect(view.text()).toContain(ACCOUNT_COPY.confirmHeading)
      expect(view.text()).toContain('For your security, managing your subscription needs a Twitch check from the last 10 minutes.')
      // A cancelled window keeps the question; a confirmed one closes it.
      await view.click('Continue with Twitch')
      expect(view.calls('SUPPORTER_BILLING', 'portal_confirm')).toBe(1)
      expect(view.state()).toBe('confirm-identity')
      await view.click('Continue with Twitch')
      expect(view.calls('SUPPORTER_BILLING', 'portal_confirm')).toBe(2)
      expect(view.state()).toBe('active')
      // The worker opens Stripe; the page never opens a provider URL itself.
      expect(view.create).not.toHaveBeenCalled()
    } finally { view.cleanup() }
  })

  it('names a different Twitch account in the check and never opens the portal', async () => {
    const view = await mount({ account: () => linked, entitlement: () => twitchAccount('active'), billing: action => action === 'portal' ? { state: 'wrong_account' } : { state: 'idle' }, twitch: () => ({ status: twitchStatus(), account: linked }) }, undefined, 'public')
    try {
      await view.click('Manage subscription ↗')
      expect(view.text()).toContain('This subscription belongs to a different Twitch account. Sign out, then Continue with Twitch with the account you subscribed with.')
      expect(view.create).not.toHaveBeenCalled()
      expect(view.state()).toBe('active')
    } finally { view.cleanup() }
  })

  it('chooses another Twitch account through a forced Twitch window', async () => {
    const view = await mount({ account: () => linked, entitlement: () => twitchAccount('none', { checkoutEnabled: false }), twitch: message => ({ status: twitchStatus({ profile: PROFILE }), account: linked, ...(message.action === 'sign_in' ? { outcome: 'signed_in' as const } : {}) }) }, undefined, 'public')
    try {
      await view.click('Use a different Twitch account')
      expect(view.sendMessage).toHaveBeenCalledWith({ type: 'TWITCH_SIGN_IN', action: 'sign_in', mode: 'interactive', forceVerify: true })
    } finally { view.cleanup() }
  })

  it('gets Supporter back after a reinstall by signing in with the same Twitch account (mocked worker)', async () => {
    // A fresh install: no credential. The same Twitch identity returns the same account and membership.
    let account: SupporterAccountState = { state: 'signed_out' }
    let membership: SupporterEntitlement = { state: 'not_linked' }
    const view = await mount({ account: () => account, entitlement: () => membership, twitch: message => {
      if (message.action === 'sign_in') { account = linked; membership = twitchAccount('active', { supportPeriods: 4, features: PERKS }) }
      return { status: twitchStatus({ profile: account.state === 'linked' ? PROFILE : null }), account, ...(message.action === 'sign_in' ? { outcome: 'signed_in' as const } : {}) }
    } }, undefined, 'public')
    try {
      expect(view.state()).toBe('signed-out')
      await view.click('Continue with Twitch')
      expect(view.state()).toBe('active')
      expect(card(view.host).sub()).toBe('Pulse Supporter · 4 months')
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
      expect(view.calls('SUPPORTER_RESTORE')).toBe(0)
    } finally { view.cleanup() }
  })

  it('signs out from the Account card with a confirmation while Supporter is active', async () => {
    let account: SupporterAccountState = linked
    const view = await mount({ account: action => action === 'disconnect' ? (account = { state: 'signed_out' }) : account, entitlement: () => twitchAccount('active'), twitch: () => ({ status: twitchStatus(), account }) }, undefined, 'public')
    try {
      await view.click('Sign out')
      expect(view.text()).toContain('Continue with Twitch with the same Twitch account to see it here again.')
      await view.click('Confirm sign out')
      expect(view.calls('SUPPORTER_ACCOUNT', 'disconnect')).toBe(1)
      expect(view.state()).toBe('signed-out')
      expect(view.text()).not.toContain('You were signed out on this browser')
    } finally { view.cleanup() }
  })
})
