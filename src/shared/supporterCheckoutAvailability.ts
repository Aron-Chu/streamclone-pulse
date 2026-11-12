import type { SupporterEntitlement } from './supporterAccount.ts'

/**
 * Checkout is closed only when the server confirms it. A browser with no
 * account yet cannot ask, so it reads as unknown, never as closed: a launch
 * must not leave first-time visitors behind a "not on sale" line.
 */
export function supporterCheckoutAvailability(entitlement: SupporterEntitlement | null): 'open' | 'closed' | 'unknown' {
  if (entitlement?.state === 'ready' && typeof entitlement.checkoutEnabled === 'boolean') {
    return entitlement.checkoutEnabled ? 'open' : 'closed'
  }
  return 'unknown'
}
