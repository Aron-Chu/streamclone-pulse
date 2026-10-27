import type { SupporterEntitlement } from './supporterAccount.ts'
import { TWITCH_SIGNIN_ENABLED } from './twitchSignIn.ts'

/** Checkout is closed only when the server or this build confirms it. */
export function supporterCheckoutAvailability(entitlement: SupporterEntitlement | null): 'open' | 'closed' | 'unknown' {
  if (entitlement?.state === 'ready' && typeof entitlement.checkoutEnabled === 'boolean') {
    return entitlement.checkoutEnabled ? 'open' : 'closed'
  }
  return entitlement?.state === 'not_linked' && !TWITCH_SIGNIN_ENABLED ? 'closed' : 'unknown'
}
