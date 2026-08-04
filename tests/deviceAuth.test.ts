import { describe, expect, it } from 'vitest'
import {
  classifyDeviceAuthError,
  isDeviceCredential,
} from '../src/background/deviceAuth.ts'
import { parseExtensionMeResponse } from '../src/background/api.ts'

describe('device auth contract', () => {
  it('accepts the backend device credential shape only when token and identity are valid', () => {
    expect(isDeviceCredential({
      token: `spdev_${'a'.repeat(64)}`,
      principalId: 'c'.repeat(64),
      deviceId: `dev_${'b'.repeat(32)}`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      principalKind: 'device',
    })).toBe(true)
    expect(isDeviceCredential({
      token: 'spdev_not-a-token',
      deviceId: 'device',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      principalKind: 'device',
    })).toBe(false)
  })

  it('validates /me caps and principal fields before identity comparison', () => {
    const valid = parseExtensionMeResponse({
      principalId: 'c'.repeat(64),
      principalKind: 'device',
      deviceId: `dev_${'b'.repeat(32)}`,
      watchlistCount: 1,
      caps: {
        maxActiveChannels: 10,
        maxChannelsPerPrincipal: 5,
        maxDevicesPerPrincipal: 2,
        deviceEnrollmentRatePerHour: 1,
        watchRatePerMin: 30,
        backfillRatePerHour: 2,
      },
    })
    expect(valid.principalKind).toBe('device')
    expect(valid.deviceId).toBe(`dev_${'b'.repeat(32)}`)
    expect(() => parseExtensionMeResponse({ ...valid, caps: { ...valid.caps, watchRatePerMin: -1 } })).toThrow(/invalid_cap/)
    expect(() => parseExtensionMeResponse({ ...valid, principalKind: 'unexpected' })).toThrow(/invalid_principal/)
  })

  it('classifies auth failures without exposing credentials', () => {
    expect(classifyDeviceAuthError(new Error('device_rotate 401'))).toBe('unauthorized')
    expect(classifyDeviceAuthError(new Error('device_enroll 409'))).toBe('cap')
    expect(classifyDeviceAuthError(new Error('device_status 503'))).toBe('retry')
    expect(classifyDeviceAuthError(new Error('malformed response'))).toBe('failure')
  })
})
