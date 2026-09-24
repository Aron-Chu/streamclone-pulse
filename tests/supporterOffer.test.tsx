// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SupporterOffer } from '../src/options/SupporterOffer.tsx'
import type { SupporterEntitlement } from '../src/shared/supporterAccount.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type EntitlementResponse = {
  type: 'SUPPORTER_ENTITLEMENT'
  entitlement: SupporterEntitlement
}

async function renderWith(
  entitlement: SupporterEntitlement | Error,
  onEntitlement?: (value: SupporterEntitlement | null) => void,
  options: { waitForResponse?: boolean } = {},
) {
  let resolveResponse: ((response: EntitlementResponse) => void) | undefined
  const sendMessage = vi.fn<() => Promise<EntitlementResponse>>().mockImplementation(() => {
    if (options.waitForResponse) {
      return new Promise(resolve => { resolveResponse = resolve })
    }
    return entitlement instanceof Error
      ? Promise.reject(entitlement)
      : Promise.resolve({ type: 'SUPPORTER_ENTITLEMENT', entitlement })
  })
  const write = vi.fn()
  const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>) => void>()
  vi.stubGlobal('chrome', {
    storage: {
      local: { set: write },
      sync: { set: write },
      onChanged: {
        addListener: (listener: (changes: Record<string, chrome.storage.StorageChange>) => void) => listeners.add(listener),
        removeListener: (listener: (changes: Record<string, chrome.storage.StorageChange>) => void) => listeners.delete(listener),
      },
    },
    runtime: { sendMessage },
  })
  vi.stubGlobal('fetch', write)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<SupporterOffer onEntitlement={onEntitlement} />))
  return {
    host,
    write,
    sendMessage,
    listeners,
    change: async (changes: Record<string, chrome.storage.StorageChange>) => {
      await act(async () => { for (const listener of listeners) listener(changes) })
    },
    text: () => host.textContent ?? '',
    // Selected by attribute, not position: the card also publishes a policy-link
    // row, so "the first anchor" is not a stable way to find the action.
    link: () => host.querySelector<HTMLAnchorElement>('a[data-supporter-action="billing"]'),
    resolve: (response: EntitlementResponse) => resolveResponse?.(response),
    hrefs: () => [...host.querySelectorAll('a')].map(anchor => anchor.getAttribute('href') ?? ''),
    cleanup: () => {
      act(() => root.unmount())
      host.remove()
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('supporter offer', () => {
  it('shows the honest monthly terms to a non-supporter', async () => {
    const view = await renderWith({ state: 'ready', status: 'none', supportPeriods: 0, features: [] })
    try {
      expect(view.text()).toContain('Not a Supporter yet')
      // One honest offer: price, cadence, cancellation and what you get.
      expect(view.text()).toContain('$4.99 / month')
      expect(view.text()).toContain('Monthly, until you cancel')
      expect(view.text()).toContain('access runs to the end of the paid month')
      expect(view.text()).toContain('Taxes, if any, are shown before you pay')
      // The offer lists only shipped benefits; the badge caveat lives on its
      // own card, so the offer must not enumerate or restate it.
      expect(view.text()).not.toMatch(/chat badge/i)
      expect(view.text()).toContain('private Pulse header accent')
      // Checkout is not released yet, so a non-member stays on the public offer
      // page rather than being sent to an authenticated route that cannot start
      // a live purchase.
      expect(view.link()?.href).toBe('https://streampulse.stream/supporter')
      expect(view.link()?.textContent).toContain('Become a Supporter')
      // The paid terms are reachable from the point of sale.
      expect(view.hrefs()).toEqual(expect.arrayContaining([
        'https://streampulse.stream/terms',
        'https://streampulse.stream/refunds',
        'https://streampulse.stream/privacy',
      ]))
      expect(view.hrefs()).toContain('https://streampulse.stream/supporter')
    } finally {
      view.cleanup()
    }
  })

  it('shows active membership and links to management instead of purchase', async () => {
    const accessUntil = new Date(Date.now() + 20 * 24 * 3600_000).toISOString()
    const view = await renderWith({ state: 'ready', status: 'active', accessUntil, supportPeriods: 3, features: ['supporter.banner.v1'] })
    try {
      expect(view.text()).toContain('Supporter active')
      expect(view.text()).toContain('3 supported months so far')
      expect(view.link()?.textContent).toContain('Manage your membership')
      // An active member must not be shown a second purchase path.
      expect(view.text()).not.toContain('$4.99 / month')
      expect(view.link()?.textContent).not.toContain('Become a Supporter')
    } finally {
      view.cleanup()
    }
  })

  it('does not expose a billing link while entitlement is still loading', async () => {
    const view = await renderWith({ state: 'ready', status: 'none', supportPeriods: 0, features: [] }, undefined, { waitForResponse: true })
    try {
      expect(view.text()).toContain('Checking Supporter status')
      expect(view.link()).toBeNull()
      expect(view.host.querySelector('[data-supporter-action="billing"]')?.getAttribute('aria-disabled')).toBe('true')

      await act(async () => {
        view.resolve({ type: 'SUPPORTER_ENTITLEMENT', entitlement: { state: 'ready', status: 'none', supportPeriods: 0, features: [] } })
      })
      expect(view.link()?.href).toBe('https://streampulse.stream/supporter')
      expect(view.link()?.textContent).toContain('Become a Supporter')
    } finally {
      view.cleanup()
    }
  })

  it.each<SupporterEntitlement['status']>(['pending', 'review', 'active', 'grace'])(
    'sends a server-known %s billing state to the authenticated billing route',
    async status => {
      const view = await renderWith({ state: 'ready', status, supportPeriods: 0, features: [] })
      try {
        expect(view.link()?.href).toBe('https://streampulse.stream/account/billing')
      } finally {
        view.cleanup()
      }
    },
  )

  it('keeps a first-time visitor on the public offer route', async () => {
    const view = await renderWith({ state: 'ready', status: 'none', supportPeriods: 0, features: [] })
    try {
      expect(view.link()?.href).toBe('https://streampulse.stream/supporter')
      expect(view.link()?.textContent).toContain('Become a Supporter')
    } finally {
      view.cleanup()
    }
  })

  it('sends an expired prior membership to authenticated billing', async () => {
    const view = await renderWith({ state: 'ready', status: 'expired', supportPeriods: 1, features: [] })
    try {
      expect(view.link()?.href).toBe('https://streampulse.stream/account/billing')
      expect(view.link()?.textContent).toContain('Review your membership')
      expect(view.link()?.textContent).not.toContain('Become a Supporter')
    } finally {
      view.cleanup()
    }
  })

  it('states each server status honestly', async () => {
    const cases: Array<[SupporterEntitlement, string]> = [
      [{ state: 'ready', status: 'grace', supportPeriods: 2, features: [] }, 'Payment needs attention'],
      [{ state: 'ready', status: 'pending', supportPeriods: 0, features: [] }, 'Payment pending'],
      [{ state: 'ready', status: 'expired', supportPeriods: 1, features: [] }, 'Supporter ended'],
      [{ state: 'ready', status: 'review', supportPeriods: 1, features: [] }, 'needs review'],
      [{ state: 'not_linked' }, 'Connect this extension'],
      [{ state: 'unavailable' }, 'not available on the server yet'],
      [{ state: 'error' }, 'Could not reach StreamPulse'],
    ]
    for (const [entitlement, expected] of cases) {
      const view = await renderWith(entitlement)
      try {
        expect(view.text(), JSON.stringify(entitlement)).toContain(expected)
        // A genuine failure must reassure rather than look like the product
        // broke. `not_linked` is not a failure, just an unconnected install.
        if (entitlement.state === 'unavailable' || entitlement.state === 'error') {
          expect(view.text()).toContain('free tools are unaffected')
        }
        // No status may ever imply a granted badge.
        expect(view.text()).not.toContain('badge is active')
      } finally {
        view.cleanup()
        vi.unstubAllGlobals()
      }
    }
  })

  it.each([
    ['pending', 'Check payment status'],
    ['review', 'Review membership'],
  ] as const)('uses a truthful CTA for the %s state', async (status, label) => {
    const view = await renderWith({ state: 'ready', status, supportPeriods: 0, features: [] })
    try {
      expect(view.link()?.textContent).toContain(label)
      expect(view.link()?.textContent).not.toContain('Become a Supporter')
    } finally {
      view.cleanup()
    }
  })

  it('treats a worker failure as unknown rather than as a granted entitlement', async () => {
    const view = await renderWith(new Error('worker gone'))
    try {
      expect(view.text()).toContain('Could not reach StreamPulse')
      expect(view.text()).not.toContain('Supporter active')
      expect(view.link()?.textContent).toContain('Become a Supporter')
    } finally {
      view.cleanup()
    }
  })

  // A settings page must never be able to grant itself paid access.
  it('never writes storage or fetches directly, and sends only a read', async () => {
    const view = await renderWith({ state: 'ready', status: 'active', supportPeriods: 1, features: ['supporter.banner.v1'] })
    try {
      expect(view.write).not.toHaveBeenCalled()
      expect(view.sendMessage).toHaveBeenCalledExactlyOnceWith({ type: 'SUPPORTER_ENTITLEMENT' })
    } finally {
      view.cleanup()
    }
  })

  it('does not stack concurrent refreshes', async () => {
    const view = await renderWith({ state: 'ready', status: 'none', supportPeriods: 0, features: [] })
    try {
      const button = view.host.querySelector<HTMLButtonElement>('button')!
      await act(async () => {
        button.click()
        button.click()
        button.click()
      })
      // One mount read plus at most one user-triggered read; the in-flight
      // guard must collapse the rest.
      expect(view.sendMessage.mock.calls.length).toBeLessThanOrEqual(2)
    } finally {
      view.cleanup()
    }
  })

  it('refreshes membership after linking and ignores unrelated storage changes', async () => {
    const view = await renderWith({ state: 'not_linked' })
    try {
      await view.change({ themePreference: { newValue: 'emerald' } })
      expect(view.sendMessage).toHaveBeenCalledTimes(1)
      view.sendMessage.mockResolvedValueOnce({
        type: 'SUPPORTER_ENTITLEMENT',
        entitlement: { state: 'ready', status: 'active', supportPeriods: 3, features: ['supporter.finish.v1'] },
      })
      await view.change({ pulseAccountRevision: { newValue: 'linked' } })
      expect(view.text()).toContain('Supporter active')
      expect(view.sendMessage).toHaveBeenCalledTimes(2)
    } finally {
      view.cleanup()
    }
    expect(view.listeners.size).toBe(0)
  })

  it.each(['pulseAccountRevision', 'backendUrl', 'localBackendOptIn'])(
    'clears stale access immediately when %s changes and rejects the previous response',
    async key => {
      const active: SupporterEntitlement = {
        state: 'ready', status: 'active', supportPeriods: 3, features: ['supporter.finish.v1'],
      }
      const onEntitlement = vi.fn()
      const view = await renderWith(active, onEntitlement)
      try {
        let finishOld!: (value: { type: 'SUPPORTER_ENTITLEMENT'; entitlement: SupporterEntitlement }) => void
        let finishNew!: typeof finishOld
        view.sendMessage.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
        await act(async () => view.host.querySelector<HTMLButtonElement>('button')!.click())
        view.sendMessage.mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve }))
        await view.change({ [key]: { newValue: 'changed' } })
        expect(view.text()).not.toContain('Supporter active')
        expect(onEntitlement).toHaveBeenLastCalledWith(null)
        expect(view.sendMessage).toHaveBeenCalledTimes(3)
        await act(async () => finishNew({ type: 'SUPPORTER_ENTITLEMENT', entitlement: { state: 'not_linked' } }))
        await act(async () => finishOld({ type: 'SUPPORTER_ENTITLEMENT', entitlement: active }))
        expect(view.text()).toContain('Connect this extension')
        expect(view.text()).not.toContain('Supporter active')
        expect(onEntitlement).toHaveBeenLastCalledWith({ state: 'not_linked' })
      } finally {
        view.cleanup()
      }
    },
  )
})
