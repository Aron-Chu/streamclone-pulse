// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MEMBERSHIP_WATCH_DELAYS_MS, MEMBERSHIP_WATCH_MS, SupporterJourney, accountReference } from '../src/options/SupporterJourney.tsx'
import type { SupporterAccountAction, SupporterAccountState, SupporterEntitlement, SupporterBillingState, SupporterRestoreState } from '../src/shared/supporterAccount.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const ACCOUNT_ID = '11111111-1111-4111-8111-1111111a1b2c'
const linked: SupporterAccountState = { state: 'linked', accountId: ACCOUNT_ID, expiresAt: new Date(Date.now() + 86_400_000).toISOString() }
const pendingLink = (overrides: Record<string, unknown> = {}) => ({ state: 'pending', code: 'ABCDE-12345', expiresAt: new Date(Date.now() + 600_000).toISOString(), retryAfterSeconds: 5, ...overrides }) as SupporterAccountState
const ready = (status: string, extra: Partial<Extract<SupporterEntitlement, { state: 'ready' }>> = {}): SupporterEntitlement =>
  ({ state: 'ready', status, supportPeriods: status === 'none' ? 0 : 2, features: [], checkoutEnabled: true, ...(extra.installationAccountsEnabled ? { accountKind: 'installation', restoreEligible: true } : {}), ...extra }) as SupporterEntitlement

type Worker = {
  account: (action: SupporterAccountAction) => SupporterAccountState | Promise<SupporterAccountState> | Error
  entitlement: () => SupporterEntitlement | Promise<SupporterEntitlement> | Error
  billing?: (action: string) => SupporterBillingState
  restore?: (action: string, email?: string) => SupporterRestoreState | Promise<SupporterRestoreState>
  devices?: (action: string, deviceId?: string) => import('../src/shared/supporterAccount.ts').SupporterDevicesState
}

async function mount(worker: Worker, onEntitlement?: (value: SupporterEntitlement | null) => void) {
  const write = vi.fn()
  const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>) => void>()
  const sendMessage = vi.fn(async (message: { type: string; action?: string; email?: string; deviceId?: string }) => {
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
    if (message.type === 'SUPPORTER_BILLING') return { type: 'SUPPORTER_BILLING', billing: worker.billing?.(message.action!) ?? { state: 'fallback' } }
    if (message.type === 'SUPPORTER_RESTORE' && worker.restore) return { type: 'SUPPORTER_RESTORE', restore: await worker.restore(message.action!, message.email) }
    if (message.type === 'SUPPORTER_DEVICES' && worker.devices) return { type: 'SUPPORTER_DEVICES', devices: worker.devices(message.action!, message.deviceId) }
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

describe('pay-first settings', () => {
  it.each(['active', 'pending'] as const)('asks before disconnecting a %s installation and preserves it when canceled', async status => {
    const view = await mount({ account: () => linked, entitlement: () => ready(status, { accountKind: 'installation', installationAccountsEnabled: true }), billing: () => ({ state: status === 'pending' ? 'waiting' : 'idle' }) })
    try {
      await view.click('Disconnect extension')
      expect(view.calls('SUPPORTER_ACCOUNT', 'disconnect')).toBe(0)
      expect(view.text()).toContain('does not cancel your subscription')
      await view.click('Keep connected')
      expect(view.calls('SUPPORTER_ACCOUNT', 'disconnect')).toBe(0)
      expect(view.buttons()).not.toContain('Confirm disconnect')
      await view.click('Disconnect extension')
      await view.click('Confirm disconnect')
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
  it.each(['ineligible', 'conflict', 'expired', 'error'] as const)('keeps verified membership management above a stale restore %s result', async result => {
    const view = await mount({ account: () => linked, entitlement: () => ready('active', { accountKind: 'installation', installationAccountsEnabled: true, restoreEligible: false }), restore: () => ({ state: result }), billing: () => ({ state: 'idle' }) })
    try {
      expect(view.state()).toBe('active')
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe('Manage membership')
      await view.click('Manage membership')
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
      expect(view.buttons()).not.toContain('Manage membership')
      expect(onEntitlement.mock.calls.some(([value]) => value?.state === 'ready' && (value.status === 'active' || value.status === 'grace'))).toBe(false)
      membership = ready('active', { installationAccountsEnabled: true })
      await view.click('Check again')
      expect(view.calls('SUPPORTER_ENTITLEMENT')).toBe(2)
      expect(view.calls('SUPPORTER_BILLING', 'status')).toBe(2)
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
      expect(view.calls('SUPPORTER_BILLING', 'portal')).toBe(0)
      expect(view.create).not.toHaveBeenCalled()
      expect(view.state()).toBe('active')
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe('Manage membership')
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
    ['active', 'Manage membership'],
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
    ['reconnect_required', 'previous-payment-unresolved', 'Restore my Supporter', 'restore'],
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
        expect(view.buttons()).not.toContain('Manage membership')
        expect(view.text()).not.toContain('US$4.99 / month')
        if (billingState === 'confirming' || billingState === 'still_confirming' || billingState === 'review') expect(view.text()).toContain('Do not pay again')
        if (action === 'support') {
          expect(view.host.querySelector<HTMLAnchorElement>('a.pulse-journey-primary')?.href).toBe('https://streampulse.stream/support')
        } else {
          await view.click(label)
          if (action === 'resume' || action === 'check') expect(view.calls('SUPPORTER_BILLING', action)).toBe(1)
          if (action === 'read') expect(view.calls('SUPPORTER_ENTITLEMENT')).toBeGreaterThan(1)
          if (action === 'restore') expect(view.state()).toBe('restore-email')
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
      expect(view.buttons()).not.toContain('Manage membership')
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
    } finally { view.cleanup() }
  })
  it.each([
    ['active', true, 'confirming', 'Manage membership', 'portal'],
    ['grace', true, 'still_confirming', 'Update payment method', 'portal'],
    ['expired', true, 'idle', 'Rejoin Supporter', 'checkout'],
    ['expired', false, 'idle', 'Manage membership', 'portal'],
    ['review', true, 'fallback', 'Manage membership', 'portal'],
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
  it('makes recovery primary after relink, with a separate explicit new-membership confirmation', async () => {
    const view = await mount({ account: () => ({ state: 'relink_required' }), entitlement: () => ({ state: 'not_linked' }), billing: () => ({ state: 'idle' }) })
    try {
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe('Restore my Supporter')
      expect(view.buttons()).not.toContain('Become a Supporter')
      await view.click('Start a new membership')
      expect(view.text()).toContain('separate subscription')
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
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
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe(status === 'grace' ? 'Update payment method' : 'Manage membership')
      await view.click(status === 'grace' ? 'Update payment method' : 'Manage membership')
      expect(view.calls('SUPPORTER_BILLING', 'portal')).toBe(1)
      expect(view.create).not.toHaveBeenCalled()
    } finally { view.cleanup() }
  })
  it('checks a lost payment explicitly through the worker and shows a comparison code during restore', async () => {
    let restore: SupporterRestoreState = { state: 'idle' }
    const view = await mount({ account: () => linked, entitlement: () => ready('none', { accountKind: 'installation', installationAccountsEnabled: true, restoreEligible: true }), billing: () => ({ state: 'still_confirming' }), restore: () => restore })
    try {
      await view.click('Check payment status')
      expect(view.calls('SUPPORTER_BILLING', 'check')).toBe(1)
      restore = { state: 'pending', expiresAt: new Date(Date.now() + 900_000).toISOString(), comparisonCode: 'A3B4C5' }
      await view.change({ pulseAccountRevision: { newValue: 'restore' } })
      expect(view.text()).toContain('A3B4C5')
      expect(view.text()).toContain('matches')
    } finally { view.cleanup() }
  })
  it('does not disguise an unrelated outage as an existing payment status', async () => {
    const view = await mount({ account: () => linked, entitlement: () => ready('none'), billing: () => ({ state: 'unavailable' }) })
    try { expect(view.buttons()).not.toContain('Check payment status'); expect(view.buttons()).toContain('Try again') } finally { view.cleanup() }
  })
  it.each(['billing-review', 'restore-conflict'])('offers safe support for %s instead of another payment', async state => {
    const view = await mount({ account: () => linked, entitlement: () => ready('none', { installationAccountsEnabled: true }), billing: () => state === 'billing-review' ? { state: 'review' } : { state: 'idle' }, restore: () => state === 'restore-conflict' ? { state: 'conflict' } : { state: 'idle' } })
    try {
      const help = view.host.querySelector<HTMLAnchorElement>('a.pulse-journey-primary')!
      expect(help.textContent).toBe('Contact support')
      expect(help.href).toBe('https://streampulse.stream/support')
      expect(view.buttons()).not.toContain('Become a Supporter')
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
    } finally { view.cleanup() }
  })
  it('opens payment through the worker and waits without a second purchase action', async () => {
    let account: SupporterAccountState = { state: 'signed_out' }
    let membership: SupporterEntitlement = { state: 'not_linked' }
    let billing: SupporterBillingState = { state: 'idle' }
    const view = await mount({ account: () => account, entitlement: () => membership, billing: action => {
      if (action === 'checkout') { account = linked; membership = ready('none', { installationAccountsEnabled: true }); billing = { state: 'waiting', attemptId: 'safe-local-attempt' } }
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
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe('Manage membership')
      await view.click('Manage membership')
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
  it('discards a delayed preflight failure after settings unmount and remount', async () => {
    let release!: (value: SupporterRestoreState) => void
    const delayed = new Promise<SupporterRestoreState>(resolve => { release = resolve })
    const worker: Worker = { account: () => linked, entitlement: () => ready('none', { installationAccountsEnabled: true }), restore: action => action === 'start' ? delayed : { state: 'idle' } }
    const previous = await mount(worker)
    await previous.click('Restore my Supporter')
    const email = previous.host.querySelector<HTMLInputElement>('#supporter-restore-email')!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(email, 'payer@example.test'); email.dispatchEvent(new Event('input', { bubbles: true })) })
    await previous.click('Send restore link')
    expect(previous.state()).toBe('restore-sending')
    previous.cleanup()
    const current = await mount(worker)
    try {
      const initialCalls = current.sendMessage.mock.calls.length
      await act(async () => release({ state: 'unavailable', reason: 'connection' }))
      expect(current.sendMessage.mock.calls.length).toBe(initialCalls)
      expect(current.state()).toBe('offer')
      await current.click('Restore my Supporter')
      expect(current.host.querySelector<HTMLInputElement>('#supporter-restore-email')!.value).toBe('')
      expect(current.calls('SUPPORTER_RESTORE', 'start')).toBe(0)
      expect(current.write).not.toHaveBeenCalled()
    } finally { current.cleanup() }
  })
  it('shows one primary restore action and generic recovery copy without persisting email', async () => {
    let restore: SupporterRestoreState = { state: 'idle' }
    const view = await mount({ account: () => ({ state: 'signed_out' }), entitlement: () => ({ state: 'not_linked' }), restore: action => action === 'start' ? (restore = { state: 'pending', expiresAt: new Date(Date.now() + 900_000).toISOString(), comparisonCode: 'A3B4C5' }) : restore })
    try {
      await view.click('Restore my Supporter')
      expect(view.state()).toBe('restore-email')
      expect(view.host.querySelectorAll('.pulse-journey-primary')).toHaveLength(1)
      const email = view.host.querySelector<HTMLInputElement>('#supporter-restore-email')!
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(email, 'payer@example.test'); email.dispatchEvent(new Event('input', { bubbles: true })) })
      await view.click('Send restore link')
      expect(view.sendMessage).toHaveBeenCalledWith({ type: 'SUPPORTER_RESTORE', action: 'start', email: 'payer@example.test' })
      expect(view.state()).toBe('restore-pending')
      expect(view.host.querySelectorAll('.pulse-journey-primary')).toHaveLength(1)
      expect(view.host.querySelector('.pulse-journey-primary')?.textContent).toBe('Check restore status')
      expect(view.text()).toContain('If that email has a recoverable membership')
      expect(view.text()).not.toContain('payer@example.test')
      await view.click('Check restore status')
      expect(view.sendMessage).toHaveBeenCalledWith({ type: 'SUPPORTER_RESTORE', action: 'check' })
      expect(view.calls('SUPPORTER_RESTORE', 'start')).toBe(1)
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(0)
      expect(view.calls('SUPPORTER_ACCOUNT', 'start')).toBe(0)
      expect(view.state()).toBe('restore-pending')
      expect(view.text()).toContain('A3B4C5')
      expect(view.create).not.toHaveBeenCalled()
      expect(view.write).not.toHaveBeenCalled()
    } finally { view.cleanup() }
  })
})

describe('one Supporter entry point', () => {
  it('starts linking for a purchase, opens the website with the prepared request, and shows one primary action', async () => {
    let account: SupporterAccountState = { state: 'signed_out' }
    const view = await mount({ account: action => action === 'start' ? (account = pendingLink({ pollingSecret: 'c'.repeat(64), unknownField: 'leak' })) : account, entitlement: () => ({ state: 'not_linked' }) })
    try {
      expect(view.state()).toBe('unlinked')
      expect(view.text()).toContain('Become a Pulse Supporter')
      expect(view.text()).toContain('US$4.99 / month')
      // Production has no installation accounts, so the click falls back to the
      // website: the copy names that path first, and Stripe-first only as the
      // case where the server allows it.
      const detail = view.text()
      expect(detail).toContain('Become a Supporter opens streampulse.stream, where you sign in and approve this extension before paying on Stripe.')
      expect(detail).toContain('If the server lets this extension check out by itself, Stripe opens directly and asks for your email and payment details')
      expect(detail).not.toContain('Stripe asks for your email and payment details. You only verify')
      expect(view.host.querySelectorAll('.pulse-journey-primary')).toHaveLength(1)
      await view.click('Become a Supporter')
      expect(view.calls('SUPPORTER_BILLING', 'checkout')).toBe(1)
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
      await view.click('Use a StreamPulse website account')
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
      expect(waiting.host.querySelectorAll('.pulse-journey-primary')).toHaveLength(1)
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
      expect(view.text()).toContain('was disconnected from your Pulse account')
      expect(view.buttons()).toContain('Restore my Supporter')
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
      expect(view.buttons()).toContain(state === 'relink_required' ? 'Restore my Supporter' : 'Become a Supporter')
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
  const DISCONNECT_UNCONFIRMED = 'server revocation could not be confirmed'
  const MANAGE_FAILED = 'Could not open membership management'

  it.each([
    ['returns an error', () => ({ state: 'error' }) as SupporterAccountState, DISCONNECT_UNCONFIRMED],
    ['throws', () => new Error('worker gone'), 'Disconnect could not be confirmed'],
  ] as const)('reports a disconnect that %s in the Account card, not the card footer', async (_name, failure, copy) => {
    const view = await mount({ account: action => action === 'disconnect' ? failure() : linked, entitlement: () => ready('active', { accountKind: 'installation', installationAccountsEnabled: true }), billing: () => ({ state: 'idle' }) })
    try {
      const page = sections(view.host)
      // The live region is there, empty, before anything happens.
      expect(page.accountStatus()?.textContent).toBe('')
      await view.click('Disconnect extension')
      await view.click('Confirm disconnect')
      expect(view.calls('SUPPORTER_ACCOUNT', 'disconnect')).toBe(1)
      expect(page.accountStatus()?.textContent).toContain(copy)
      expect(page.footer()).not.toContain(copy)
    } finally { view.cleanup() }
  })

  it('reports a failed Manage billing in the Account card, and the footer’s own Manage membership in the footer', async () => {
    const view = await mount({ account: () => linked, entitlement: () => ready('active', { installationAccountsEnabled: true }), billing: action => action === 'portal' ? { state: 'error' } : { state: 'idle' } })
    try {
      const page = sections(view.host)
      await view.click('Manage billing ↗')
      expect(view.calls('SUPPORTER_BILLING', 'portal')).toBe(1)
      expect(page.accountStatus()?.textContent).toContain(MANAGE_FAILED)
      expect(page.footer()).not.toContain(MANAGE_FAILED)

      await view.click('Manage membership')
      expect(view.calls('SUPPORTER_BILLING', 'portal')).toBe(2)
      expect(page.footer()).toContain(MANAGE_FAILED)
      expect(page.accountStatus()?.textContent).toBe('')
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
      await view.click('Retry disconnect')
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
    ['unlinked', () => ({ state: 'signed_out' }), () => ({ state: 'not_linked' }), 'Become a Supporter'],
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
      expect(view.buttons()).not.toContain('Disconnect extension')
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
