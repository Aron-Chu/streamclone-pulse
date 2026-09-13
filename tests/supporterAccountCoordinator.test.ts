import { describe, expect, it, vi } from 'vitest'
import { SupporterAccountCoordinator } from '../src/background/supporterAccount.ts'
import { parseBackgroundRequest } from '../src/shared/parseBackgroundRequest.ts'

const now = Date.parse('2026-09-09T12:00:00Z')
const iso = (seconds: number) => new Date(now + seconds * 1000).toISOString()
const creds = { kind: 'linked', state: 'approved', token: 'a'.repeat(64), refreshToken: 'b'.repeat(64), deviceId: '11111111-1111-4111-8111-111111111111', accountId: '22222222-2222-4222-8222-222222222222', expiresAt: iso(10000), refreshExpiresAt: iso(90000) }
function fixture(initial: unknown = null) {
  let value = initial
  let clock = now
  const request = vi.fn<(_: string, body?: Record<string, unknown>) => Promise<{ status: number; body: unknown }>>()
  const coordinator = new SupporterAccountCoordinator({ read: async () => value, write: async next => { value = next }, request, now: () => clock })
  return { coordinator, request, stored: () => value, advance: (ms: number) => { clock += ms } }
}
describe('private supporter account coordinator', () => {
  it('serializes bookmark credentials with refresh and binds operations to their account', async () => {
    const f = fixture({ ...creds, expiresAt: iso(0) })
    const next = { ...creds, token: 'e'.repeat(64), refreshToken: 'f'.repeat(64) }
    f.request.mockResolvedValueOnce({ status: 200, body: next })
    const read = vi.fn(async (token: string) => ({ status: 200, token }))
    const [one, two] = await Promise.all([
      f.coordinator.withCredential(read, creds.accountId),
      f.coordinator.withCredential(read, creds.accountId),
    ])
    expect(one.token).toBe(next.token)
    expect(two.token).toBe(next.token)
    expect(f.request).toHaveBeenCalledTimes(1)
    await expect(f.coordinator.withCredential(read, 'another-account')).rejects.toThrow('account_identity_changed')
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('clears a rejected bookmark bearer without retrying writes or falling back to legacy auth', async () => {
    const f = fixture(creds)
    const write = vi.fn(async () => ({ status: 401 }))
    await expect(f.coordinator.withCredential(write)).rejects.toThrow('account_authorization_required')
    expect(f.stored()).toBeNull()
    expect(write).toHaveBeenCalledTimes(1)
    await expect(f.coordinator.withCredential(write)).rejects.toThrow('account_authorization_required')
    expect(write).toHaveBeenCalledTimes(1)
  })
  it('discards an in-flight bookmark response on disconnect', async () => {
    const f = fixture(creds)
    let finish!: (value: { status: number }) => void
    const read = vi.fn(() => new Promise<{ status: number }>(resolve => { finish = resolve }))
    const pending = f.coordinator.withCredential(read)
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    const rejected = expect(pending).rejects.toThrow('account_identity_changed')
    f.request.mockResolvedValue({ status: 204, body: null })
    const disconnect = f.coordinator.run('disconnect')
    finish({ status: 200 })
    await rejected
    await disconnect
    expect(f.stored()).toBeNull()
  })
  it('disconnects the newly rotated bearer when disconnect races a bookmark refresh', async () => {
    const f = fixture({ ...creds, expiresAt: iso(0) })
    let finish!: (value: { status: number; body: unknown }) => void
    f.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const operation = vi.fn(async () => ({ status: 200 }))
    const pending = f.coordinator.withCredential(operation)
    const rejected = expect(pending).rejects.toThrow('account_identity_changed')
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1))
    f.request.mockResolvedValueOnce({ status: 204, body: null })
    const disconnect = f.coordinator.run('disconnect')
    finish({ status: 200, body: { ...creds, token: 'e'.repeat(64) } })
    await rejected
    expect((await disconnect).state).toBe('signed_out')
    expect(f.request).toHaveBeenLastCalledWith('/v1/account/devices/disconnect', { token: 'e'.repeat(64) })
    expect(operation).not.toHaveBeenCalled()
    expect(f.stored()).toBeNull()
  })
  it('grants only fresh released features for the linked account and configured environment', async () => {
    const body = { schemaVersion: 1, accountId: creds.accountId, environment: 'live', revision: 2, status: 'active', serverTime: iso(0), accessFrom: iso(-100), accessUntil: iso(3600), cacheUntil: iso(900), supportPeriods: 1, features: { 'supporter.banner.v1': true, 'supporter.chat_badge.v1': true, 'unknown.feature': true } }
    for (const [change, expected] of [[{}, ['supporter.banner.v1']], [{ accessFrom: undefined }, []], [{ cacheUntil: iso(-1) }, []], [{ status: 'expired' }, []]] as const) {
      const f = fixture(creds)
      f.request.mockResolvedValue({ status: 200, body: { ...body, ...change } })
      expect(await f.coordinator.entitlement()).toMatchObject({ state: 'ready', features: expected })
    }
    for (const change of [{ accountId: 'another-account' }, { environment: 'sandbox' }, { schemaVersion: 2 }, { revision: -1 }]) {
      const f = fixture(creds)
      f.request.mockResolvedValue({ status: 200, body: { ...body, ...change } })
      expect(await f.coordinator.entitlement()).toEqual({ state: 'error' })
    }
  })
  it('redacts all secrets and coalesces start and poll attempts', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ status: 201, body: { pollingSecret: 'c'.repeat(64), code: 'ABCDE-12345', expiresAt: iso(600) } })
    const [one, two] = await Promise.all([f.coordinator.run('start'), f.coordinator.run('start')])
    expect(one).toEqual(two)
    expect(JSON.stringify(one)).not.toContain('c'.repeat(64))
    expect(f.request).toHaveBeenCalledTimes(1)
    await f.coordinator.run('poll')
    expect(f.request).toHaveBeenCalledTimes(1)
    f.advance(5001)
    f.request.mockResolvedValueOnce({ status: 200, body: creds })
    const state = await f.coordinator.run('poll')
    expect(state.state).toBe('linked')
    expect(JSON.stringify(state)).not.toMatch(/token|refresh|secret/i)
    expect(f.stored()).toMatchObject({ token: creds.token })
  })
  it('cannot resurrect a canceled request', async () => {
    const f = fixture()
    let finish!: (value: { status: number; body: unknown }) => void
    f.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const start = f.coordinator.run('start')
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1))
    const cancel = f.coordinator.run('cancel')
    finish({ status: 201, body: { pollingSecret: 'c'.repeat(64), code: 'ABCDE-12345', expiresAt: iso(600) } })
    expect((await start).state).toBe('signed_out')
    expect((await cancel).state).toBe('signed_out')
    expect(f.stored()).toBeNull()
  })
  it('serializes refresh and never retries an uncertain or interrupted rotation', async () => {
    const f = fixture({ ...creds, expiresAt: iso(0) })
    f.request.mockImplementationOnce(async () => {
      expect(f.stored()).toEqual({ kind: 'refreshing' })
      throw new Error('network response lost')
    })
    expect((await f.coordinator.run('status')).state).toBe('relink_required')
    await f.coordinator.run('status')
    expect(f.request).toHaveBeenCalledTimes(1)
    const restarted = fixture({ kind: 'refreshing' })
    expect((await restarted.coordinator.run('status')).state).toBe('relink_required')
    expect(restarted.request).not.toHaveBeenCalled()
  })
  it('never accepts a refresh for another account', async () => {
    const f = fixture({ ...creds, expiresAt: iso(0) })
    f.request.mockResolvedValueOnce({ status: 200, body: { ...creds, accountId: '33333333-3333-4333-8333-333333333333' } })
    expect((await f.coordinator.run('status')).state).toBe('relink_required')
    expect(f.stored()).toBeNull()
  })
  it('clears local access even when remote disconnect fails', async () => {
    const f = fixture(creds)
    f.request.mockImplementationOnce(async () => { expect(f.stored()).toEqual({ kind: 'revoking', token: creds.token }); return { status: 503, body: null } })
    expect((await f.coordinator.run('disconnect')).state).toBe('error')
    expect(f.stored()).toEqual({ kind: 'revoking', token: creds.token })
    await expect(f.coordinator.withCredential(async () => ({ status: 200 }))).rejects.toThrow('account_authorization_required')
    expect(await f.coordinator.entitlement()).toEqual({ state: 'not_linked' })
    const restarted = fixture(f.stored())
    expect((await restarted.coordinator.run('cancel')).state).toBe('error')
    expect((await restarted.coordinator.run('start')).state).toBe('error')
    restarted.request.mockResolvedValueOnce({ status: 204, body: null })
    expect((await restarted.coordinator.run('disconnect')).state).toBe('signed_out')
    expect(restarted.request).toHaveBeenCalledWith('/v1/account/devices/disconnect', { token: creds.token })
    expect(restarted.stored()).toBeNull()
  })
  it('rejects UI attempts to submit tokens, origins, or unknown actions', () => {
    expect(parseBackgroundRequest({ type: 'SUPPORTER_ACCOUNT', action: 'status' })).toEqual({ type: 'SUPPORTER_ACCOUNT', action: 'status' })
    for (const field of ['token', 'refreshToken', 'url', 'accountId']) expect(parseBackgroundRequest({ type: 'SUPPORTER_ACCOUNT', action: 'start', [field]: 'attacker' })).toBeNull()
    expect(parseBackgroundRequest({ type: 'SUPPORTER_ACCOUNT', action: 'refresh' })).toBeNull()
  })
})
