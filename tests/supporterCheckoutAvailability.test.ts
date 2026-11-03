import { describe, expect, it } from 'vitest'
import type { SupporterEntitlement } from '../src/shared/supporterAccount.ts'
import { supporterCheckoutAvailability as availability } from '../src/shared/supporterCheckoutAvailability.ts'

const ready = (checkoutEnabled?: boolean): SupporterEntitlement => ({ state: 'ready', status: 'none', supportPeriods: 0, features: [], checkoutEnabled })

describe('Supporter checkout availability', () => {
  it('is closed only when the server confirms it', () => {
    expect(availability(ready(true))).toBe('open')
    expect(availability(ready(false))).toBe('closed')
    // A browser with no account cannot ask, so a launch never leaves it behind a "not on sale" line.
    for (const unconfirmed of [null, { state: 'not_linked' }, ready(), { state: 'error' }, { state: 'unavailable', reason: 'temporarily_unavailable' }, { state: 'unavailable', reason: 'not_deployed' }, { state: 'unavailable', reason: 'environment_mismatch' }] satisfies Array<SupporterEntitlement | null>) {
      expect(availability(unconfirmed)).toBe('unknown')
    }
  })
})
