import { describe, expect, it, vi } from 'vitest'
import { SupporterAccountCoordinator } from '../src/background/supporterAccount.ts'

const now = Date.parse('2026-10-26T12:00:00Z')
const iso = (delta: number) => new Date(now + delta).toISOString()
const credentials = { accountId: '22222222-2222-4222-8222-222222222222', deviceId: '11111111-1111-4111-8111-111111111111', token: 'a'.repeat(64), refreshToken: 'b'.repeat(64), expiresAt: iso(86_400_000), refreshExpiresAt: iso(90 * 86_400_000) }
const pending = { kind: 'pending', secret: 'c'.repeat(64), code: 'ABCDE-12345', expiresAt: iso(600_000), nextPoll: now + 5000 }

function fixture(initial: unknown = null) {
  let stored: unknown = initial
  let key: unknown = null
  const readKey = vi.fn(async (): Promise<unknown> => key)
  const writeKey = vi.fn(async (value: unknown) => { key = value })
  const write = vi.fn(async (value: unknown) => { stored = value })
  const request = vi.fn(async (path: string, _body?: Record<string, unknown>, _bearer?: string): Promise<{ status: number; body: unknown }> => path === '/v1/account/installations' ? { status: 201, body: credentials } : { status: 204, body: null })
  const account = new SupporterAccountCoordinator({ read: async () => stored, write, readInstallationKey: readKey, writeInstallationKey: writeKey, request, now: () => now })
  return { account, request, readKey, writeKey, write, stored: () => stored, key: () => key }
}

describe('strict explicit installation connection', () => {
  it.each([
    ['relink required', { kind: 'relink_required' }, 'relink_required'],
    ['pending approval', pending, 'pending'],
    ['expired approval', { ...pending, expiresAt: iso(-1) }, 'expired'],
  ] as const)('does not replace an existing %s state with an anonymous identity', async (_name, initial, state) => {
    const f = fixture(initial)
    expect(await f.account.ensureInstallation('connect')).toMatchObject({ state })
    expect(f.request).not.toHaveBeenCalled()
    expect(f.readKey).not.toHaveBeenCalled()
    expect(f.writeKey).not.toHaveBeenCalled()
  })

  it('does not enroll after the current device approval is denied', async () => {
    const f = fixture({ ...pending, nextPoll: now - 1 })
    f.request.mockResolvedValue({ status: 200, body: { state: 'denied' } })
    expect(await f.account.ensureInstallation('connect')).toEqual({ state: 'denied' })
    expect(f.request.mock.calls.map(([path]) => path)).toEqual(['/v1/account/device-links/poll'])
    expect(f.readKey).not.toHaveBeenCalled()
    expect(f.writeKey).not.toHaveBeenCalled()
  })

  it('returns an existing identity without reading or replacing its bootstrap key', async () => {
    const initial = { kind: 'linked', ...credentials }
    const f = fixture(initial)
    expect(await f.account.ensureInstallation('connect')).toMatchObject({ state: 'linked', accountId: credentials.accountId })
    expect(f.stored()).toEqual(initial)
    expect(f.write).not.toHaveBeenCalled()
    expect(f.request).not.toHaveBeenCalled()
    expect(f.readKey).not.toHaveBeenCalled()
    expect(f.writeKey).not.toHaveBeenCalled()
  })

  it('cancels a queued connect before it can create a key or send enrollment', async () => {
    const f = fixture()
    const connecting = f.account.ensureInstallation('connect')
    const cancelled = f.account.run('cancel')
    expect(await connecting).toEqual({ state: 'signed_out' })
    await cancelled
    expect(f.request).not.toHaveBeenCalled()
    expect(f.readKey).not.toHaveBeenCalled()
    expect(f.writeKey).not.toHaveBeenCalled()
    expect(f.stored()).toBeNull()
  })

  it('does not write a bootstrap key or enroll if sign-out occurs during key lookup', async () => {
    const f = fixture()
    let resolveKey!: (value: unknown) => void
    f.readKey.mockImplementationOnce(() => new Promise(resolve => { resolveKey = resolve }))
    const connecting = f.account.ensureInstallation('connect')
    await vi.waitFor(() => expect(f.readKey).toHaveBeenCalledOnce())
    const disconnected = f.account.run('disconnect')
    resolveKey(null)
    expect(await connecting).toEqual({ state: 'signed_out' })
    await disconnected
    expect(f.request).not.toHaveBeenCalled()
    expect(f.writeKey.mock.calls.map(([value]) => value)).toEqual([null])
    expect(f.stored()).toBeNull()
  })

  it('does not send enrollment after cancellation while its bootstrap key is being saved', async () => {
    const f = fixture()
    let finishWrite!: () => void
    f.writeKey.mockImplementationOnce(() => new Promise(resolve => { finishWrite = resolve }))
    const connecting = f.account.ensureInstallation('connect')
    await vi.waitFor(() => expect(f.writeKey).toHaveBeenCalledOnce())
    const disconnected = f.account.run('disconnect')
    finishWrite()
    expect(await connecting).toEqual({ state: 'signed_out' })
    await disconnected
    expect(f.request).not.toHaveBeenCalled()
    expect(f.stored()).toBeNull()
    expect(f.key()).toBeNull()
  })

  it('revokes a late enrollment credential after sign-out instead of adopting it', async () => {
    const f = fixture()
    let resolveEnrollment!: (value: { status: number; body: unknown }) => void
    f.request.mockImplementationOnce(() => new Promise(resolve => { resolveEnrollment = resolve }))
    const connecting = f.account.ensureInstallation('connect')
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledWith('/v1/account/installations', expect.any(Object)))
    const disconnected = f.account.run('disconnect')
    resolveEnrollment({ status: 201, body: credentials })
    expect(await connecting).toEqual({ state: 'signed_out' })
    await disconnected
    expect(f.request.mock.calls.map(([path]) => path)).toEqual(['/v1/account/installations', '/v1/account/devices/disconnect'])
    expect(f.request).toHaveBeenLastCalledWith('/v1/account/devices/disconnect', { token: credentials.token })
    expect(f.write.mock.calls.some(([value]) => value && typeof value === 'object' && 'kind' in value && value.kind === 'linked')).toBe(false)
    expect(f.stored()).toBeNull()
    expect(f.key()).toBeNull()
  })
})
