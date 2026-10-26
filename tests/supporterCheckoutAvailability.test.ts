import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupporterEntitlement } from '../src/shared/supporterAccount.ts'

const ready = (checkoutEnabled?: boolean): SupporterEntitlement => ({ state: 'ready', status: 'none', supportPeriods: 0, features: [], checkoutEnabled })

afterEach(() => {
  vi.doUnmock('../src/shared/twitchSignIn.ts')
  vi.resetModules()
})

describe('Supporter checkout availability', () => {
  it.each([false, true])('uses confirmed server state and build Twitch sign-in %s', async enabled => {
    vi.doMock('../src/shared/twitchSignIn.ts', () => ({ TWITCH_SIGNIN_ENABLED: enabled }))
    const { supporterCheckoutAvailability: availability } = await import('../src/shared/supporterCheckoutAvailability.ts')
    expect(availability(ready(true))).toBe('open')
    expect(availability(ready(false))).toBe('closed')
    expect(availability({ state: 'not_linked' })).toBe(enabled ? 'unknown' : 'closed')
    for (const unconfirmed of [null, ready(), { state: 'error' }, { state: 'unavailable', reason: 'temporarily_unavailable' }, { state: 'unavailable', reason: 'not_deployed' }, { state: 'unavailable', reason: 'environment_mismatch' }] satisfies Array<SupporterEntitlement | null>) {
      expect(availability(unconfirmed)).toBe('unknown')
    }
  })
})
