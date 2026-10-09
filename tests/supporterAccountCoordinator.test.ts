import { describe, expect, it, vi } from 'vitest'
import { AccountRequestNotSent, SupporterAccountCoordinator } from '../src/background/supporterAccount.ts'
import { parseBackgroundRequest } from '../src/shared/parseBackgroundRequest.ts'
import { MESSAGE_SENDER_SCOPE } from '../src/background/pulseBroadcastTargets.ts'

const now = Date.parse('2026-09-09T12:00:00Z')
const iso = (seconds: number) => new Date(now + seconds * 1000).toISOString()
const creds = { kind: 'linked', state: 'approved', token: 'a'.repeat(64), refreshToken: 'b'.repeat(64), deviceId: '11111111-1111-4111-8111-111111111111', accountId: '22222222-2222-4222-8222-222222222222', expiresAt: iso(10000), refreshExpiresAt: iso(90000) }
function fixture(initial: unknown = null, environments?: readonly ('sandbox' | 'live')[], installationKey: unknown = null) {
  let value = initial
  let clock = now
  const request = vi.fn<(_: string, body?: Record<string, unknown>) => Promise<{ status: number; body: unknown }>>()
  const identityChanged = vi.fn(async () => {})
  const coordinator = new SupporterAccountCoordinator({ read: async () => value, write: async next => { value = next }, readInstallationKey: async () => installationKey, writeInstallationKey: async next => { installationKey = next }, request, now: () => clock, identityChanged, environments })
  return { coordinator, request, identityChanged, stored: () => value, key: () => installationKey, advance: (ms: number) => { clock += ms } }
}
describe('private supporter account coordinator', () => {
  it('keeps a restored installation on the durable refresh path even though its bootstrap belonged to the waiting account', async () => {
    const key = { state: 'claimed', key: 'c'.repeat(64), accountId: creds.accountId }
    const f = fixture(creds, undefined, key)
    const restored = { ...creds, accountId: '55555555-5555-4555-8555-555555555555', deviceId: '66666666-6666-4666-8666-666666666666', token: 'd'.repeat(64), refreshToken: 'e'.repeat(64), expiresAt: iso(100) }
    expect(await f.coordinator.adoptRestoredCredentials(restored, creds.accountId)).toBe(true)
    expect(await f.coordinator.isInstallationIdentity()).toBe(true)
    expect(f.key()).toEqual(key)
    f.advance(60_000)
    f.request.mockRejectedValueOnce(new Error('restored refresh response lost'))
    expect(await f.coordinator.run('status')).toEqual({ state: 'unavailable', reason: 'temporarily_unavailable', linked: true })
    expect(f.stored()).toMatchObject({ kind: 'refreshing', installation: true, credentials: { accountId: restored.accountId, refreshToken: restored.refreshToken } })
    const restarted = fixture(f.stored(), undefined, f.key())
    restarted.advance(90_000)
    const successor = { ...restored, token: 'f'.repeat(64), refreshToken: 'a'.repeat(64), expiresAt: iso(3600) }
    restarted.request.mockResolvedValueOnce({ status: 200, body: successor })
    expect(await restarted.coordinator.run('status')).toMatchObject({ state: 'linked', accountId: restored.accountId })
    expect(restarted.stored()).toMatchObject({ kind: 'linked', installation: true, token: successor.token })
    expect(await restarted.coordinator.isInstallationIdentity()).toBe(true)
  })
  it('retains installation credentials and its key after a lost refresh response, then retries after a worker restart', async () => {
    const key = { state: 'claimed', key: 'c'.repeat(64), accountId: creds.accountId }
    const old = { ...creds, expiresAt: iso(0) }
    const f = fixture(old, undefined, key)
    f.request.mockRejectedValueOnce(new Error('network interrupted'))
    const waiting = { state: 'unavailable', reason: 'temporarily_unavailable', linked: true }
    expect(await f.coordinator.run('status')).toEqual(waiting)
    expect(f.stored()).toMatchObject({ kind: 'refreshing', installation: true, credentials: { token: old.token, refreshToken: old.refreshToken, deviceId: old.deviceId, accountId: old.accountId } })
    expect(f.key()).toEqual(key)
    expect(await f.coordinator.localAccountId()).toBe(creds.accountId)
    expect(f.identityChanged).not.toHaveBeenCalled()
    const restarted = fixture(f.stored(), undefined, f.key())
    expect(await restarted.coordinator.run('status')).toEqual(waiting)
    expect(restarted.request).not.toHaveBeenCalled()
    restarted.advance(30_000)
    const next = { ...creds, token: 'e'.repeat(64), refreshToken: 'f'.repeat(64) }
    restarted.request.mockResolvedValueOnce({ status: 200, body: next })
    expect(await restarted.coordinator.run('status')).toMatchObject({ state: 'linked', accountId: creds.accountId })
    expect(restarted.request).toHaveBeenCalledExactlyOnceWith('/v1/account/devices/refresh', { refreshToken: creds.refreshToken })
    expect(restarted.stored()).toMatchObject({ kind: 'linked', token: next.token })
    expect(restarted.key()).toEqual(key)
  })
  it('preserves installation identity across server refresh errors, and relinks only after an authoritative rejection', async () => {
    const key = { state: 'claimed', key: 'c'.repeat(64), accountId: creds.accountId }
    const f = fixture({ ...creds, expiresAt: iso(0) }, undefined, key)
    f.request.mockResolvedValueOnce({ status: 502, body: null })
    expect(await f.coordinator.run('status')).toEqual({ state: 'unavailable', reason: 'temporarily_unavailable', linked: true })
    expect(f.key()).toEqual(key)
    f.advance(30_000)
    f.request.mockResolvedValueOnce({ status: 401, body: null })
    expect(await f.coordinator.run('status')).toEqual({ state: 'relink_required' })
    expect(f.key()).toEqual(key)
    expect(f.request).toHaveBeenCalledTimes(2)
    await f.coordinator.run('disconnect')
    expect(f.key()).toBeNull()
  })
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
    expect(f.stored()).toEqual({ kind: 'relink_required' })
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
    for (const change of [{ accountId: 'another-account' }, { environment: 'test' }, { environment: undefined }, { schemaVersion: 2 }, { revision: -1 }]) {
      const f = fixture(creds)
      f.request.mockResolvedValue({ status: 200, body: { ...body, ...change } })
      expect(await f.coordinator.entitlement()).toEqual({ state: 'error' })
    }
    const live = fixture(creds)
    live.request.mockResolvedValue({ status: 200, body: { ...body, environment: 'sandbox' } })
    expect(await live.coordinator.entitlement()).toEqual({ state: 'unavailable', reason: 'environment_mismatch' })
    expect(live.stored()).toEqual(creds)
    const development = fixture(creds, ['live', 'sandbox'])
    development.request.mockResolvedValue({ status: 200, body: { ...body, environment: 'sandbox' } })
    expect(await development.coordinator.entitlement()).toMatchObject({ state: 'ready', features: ['supporter.banner.v1'] })
  })
  it('clears remotely revoked credentials and permits an immediate new device link', async () => {
    const f = fixture(creds)
    f.request.mockResolvedValueOnce({ status: 401, body: { error: 'unauthorized' } })
    expect(await f.coordinator.entitlement()).toEqual({ state: 'not_linked' })
    expect(f.stored()).toEqual({ kind: 'relink_required' })
    expect(f.identityChanged).toHaveBeenCalledTimes(1)
    expect(await f.coordinator.run('status')).toEqual({ state: 'relink_required' })
    expect(await fixture(f.stored()).coordinator.run('status')).toEqual({ state: 'relink_required' })
    f.request.mockResolvedValueOnce({ status: 201, body: { pollingSecret: 'c'.repeat(64), code: 'ABCDE-12345', expiresAt: iso(600) } })
    expect(await f.coordinator.run('start')).toMatchObject({ state: 'pending', code: 'ABCDE-12345' })
    expect(f.request).toHaveBeenCalledTimes(2)
    expect(f.request).toHaveBeenLastCalledWith('/v1/account/device-links', { label: 'StreamPulse extension' })
  })
  it.each([403, 404, 429, 500, 503])('preserves the connection after entitlement status %s', async status => {
    const f = fixture(creds)
    f.request.mockResolvedValueOnce({ status, body: null })
    expect(await f.coordinator.entitlement()).toEqual(status === 404 ? { state: 'unavailable', reason: 'not_deployed' }
      : status === 503 ? { state: 'unavailable', reason: 'temporarily_unavailable' } : { state: 'error' })
    expect(f.stored()).toEqual(creds)
    expect(f.identityChanged).not.toHaveBeenCalled()
    expect(await f.coordinator.run('status')).toMatchObject({ state: 'linked' })
  })
  it('preserves credentials after an entitlement transport failure', async () => {
    const f = fixture(creds)
    f.request.mockRejectedValueOnce(new Error('network unavailable'))
    expect(await f.coordinator.entitlement()).toEqual({ state: 'error' })
    expect(f.stored()).toEqual(creds)
    expect(f.identityChanged).not.toHaveBeenCalled()
  })
  it('clears credentials rejected by cosmetic saving without replaying the write', async () => {
    const f = fixture(creds)
    f.request.mockResolvedValueOnce({ status: 401, body: null })
    expect(await f.coordinator.saveCosmetics({ enabled: true, finish: 'halo' })).toBe(false)
    expect(f.stored()).toEqual({ kind: 'relink_required' })
    expect(f.identityChanged).toHaveBeenCalledTimes(1)
    expect(await f.coordinator.saveCosmetics({ enabled: true, finish: 'halo' })).toBe(false)
    expect(f.request).toHaveBeenCalledTimes(1)
  })
  it.each(['entitlement', 'cosmetics'] as const)('keeps disconnect authority when a rejected %s request finishes late', async operation => {
    const f = fixture(creds)
    let finish!: (value: { status: number; body: unknown }) => void
    f.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = operation === 'entitlement'
      ? f.coordinator.entitlement()
      : f.coordinator.saveCosmetics({ enabled: true, finish: 'halo' })
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1))
    f.request.mockResolvedValueOnce({ status: 503, body: null })
    const disconnect = f.coordinator.run('disconnect')
    finish({ status: 401, body: null })
    expect(await pending).toEqual(operation === 'entitlement' ? { state: 'not_linked' } : false)
    expect(await disconnect).toEqual({ state: 'error', revocationPending: true })
    expect(f.stored()).toEqual({ kind: 'revoking', token: creds.token })
    expect(f.request).toHaveBeenLastCalledWith('/v1/account/devices/disconnect', { token: creds.token })
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
    expect(f.stored()).toEqual({ kind: 'relink_required' })
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
  it.each([
    ['refresh_not_attempted', 503, { error: 'refresh_not_attempted' }, 30_000],
    ['limiter refusal', 429, { error: 'try_later' }, 60_000],
    ['missing route', 404, { error: 'not_found' }, 30_000],
  ] as const)('keeps credentials the server proves it did not rotate (%s)', async (_, status, body, pauseMs) => {
    const f = fixture({ ...creds, expiresAt: iso(0) })
    f.request.mockImplementationOnce(async () => { expect(f.stored()).toEqual({ kind: 'refreshing' }); return { status, body } })
    const waiting = { state: 'unavailable', reason: 'temporarily_unavailable', linked: true }
    expect(await f.coordinator.run('status')).toEqual(waiting)
    expect(f.stored()).toMatchObject({ kind: 'linked', token: creds.token, refreshToken: creds.refreshToken, deviceId: creds.deviceId })
    expect(f.identityChanged).not.toHaveBeenCalled()
    // Every surface reports the pause without renewing again or asking for a relink.
    expect(await f.coordinator.run('status')).toEqual(waiting)
    expect(await f.coordinator.entitlement()).toEqual({ state: 'unavailable', reason: 'temporarily_unavailable' })
    const operation = vi.fn(async () => ({ status: 200 }))
    await expect(f.coordinator.withCredential(operation)).rejects.toThrow('account_temporarily_unavailable')
    expect(operation).not.toHaveBeenCalled()
    f.advance(pauseMs - 1)
    expect(await f.coordinator.run('status')).toEqual(waiting)
    expect(f.request).toHaveBeenCalledTimes(1)
    f.advance(1)
    const next = { ...creds, token: 'e'.repeat(64), refreshToken: 'f'.repeat(64) }
    f.request.mockResolvedValueOnce({ status: 200, body: next })
    expect(await f.coordinator.run('status')).toMatchObject({ state: 'linked', accountId: creds.accountId })
    expect(f.request).toHaveBeenLastCalledWith('/v1/account/devices/refresh', { refreshToken: creds.refreshToken })
    expect(f.stored()).toMatchObject({ token: next.token, refreshToken: next.refreshToken })
  })
  it.each([
    ['generic outage', 503, { error: 'request_unavailable' }],
    ['unlabelled outage', 503, null],
    ['server error', 500, null],
    ['bad gateway', 502, null],
  ] as const)('never replays a refresh that may have rotated (%s)', async (_, status, body) => {
    const f = fixture({ ...creds, expiresAt: iso(0) })
    f.request.mockResolvedValueOnce({ status, body })
    expect(await f.coordinator.run('status')).toEqual({ state: 'relink_required' })
    expect(f.stored()).toEqual({ kind: 'relink_required' })
    expect(await f.coordinator.run('status')).toEqual({ state: 'relink_required' })
    expect(f.request).toHaveBeenCalledTimes(1)
  })
  it('keeps credentials when the request port refuses before sending', async () => {
    const f = fixture({ ...creds, expiresAt: iso(0) })
    f.request.mockRejectedValueOnce(new AccountRequestNotSent('account_hosted_only'))
    expect(await f.coordinator.run('status')).toEqual({ state: 'unavailable', reason: 'temporarily_unavailable', linked: true })
    expect(f.stored()).toMatchObject({ kind: 'linked', token: creds.token, refreshToken: creds.refreshToken })
  })
  it('revokes the kept credentials when disconnect races an unattempted refresh', async () => {
    const f = fixture({ ...creds, expiresAt: iso(0) })
    let finish!: (value: { status: number; body: unknown }) => void
    f.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const status = f.coordinator.run('status')
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1))
    f.request.mockResolvedValueOnce({ status: 204, body: null })
    const disconnect = f.coordinator.run('disconnect')
    finish({ status: 503, body: { error: 'refresh_not_attempted' } })
    await status
    expect(await disconnect).toEqual({ state: 'signed_out' })
    expect(f.request).toHaveBeenLastCalledWith('/v1/account/devices/disconnect', { token: creds.token })
    expect(f.stored()).toBeNull()
  })
  it('reports a missing deployment separately from an outage when linking starts', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ status: 404, body: null }).mockResolvedValueOnce({ status: 503, body: null })
    expect(await f.coordinator.run('start')).toEqual({ state: 'unavailable', reason: 'not_deployed' })
    expect(await f.coordinator.run('start')).toEqual({ state: 'unavailable', reason: 'temporarily_unavailable' })
    expect(f.stored()).toBeNull()
  })
  it('rejects UI attempts to submit tokens, origins, or unknown actions', () => {
    expect(parseBackgroundRequest({ type: 'SUPPORTER_ACCOUNT', action: 'status' })).toEqual({ type: 'SUPPORTER_ACCOUNT', action: 'status' })
    for (const field of ['token', 'refreshToken', 'url', 'accountId']) expect(parseBackgroundRequest({ type: 'SUPPORTER_ACCOUNT', action: 'start', [field]: 'attacker' })).toBeNull()
    expect(parseBackgroundRequest({ type: 'SUPPORTER_ACCOUNT', action: 'refresh' })).toBeNull()
  })
})

describe('worker-owned journey completion', () => {
  const snapshot = (status: string, extra: Record<string, unknown> = {}) => ({ status: 200, body: { schemaVersion: 1, accountId: creds.accountId, environment: 'live', revision: 3, status, serverTime: iso(0), accessFrom: iso(-100), accessUntil: iso(3600), cacheUntil: iso(900), supportPeriods: 1, features: { 'supporter.banner.v1': true, 'supporter.finish.v1': true }, cosmetics: { enabled: false, finish: 'glass' }, ...extra } })
  function journey(initial: unknown = null, intent: unknown = null) {
    let value = initial
    let saved = intent
    let clock = now
    const request = vi.fn<(_: string, body?: Record<string, unknown>, bearer?: string) => Promise<{ status: number; body: unknown }>>()
    const projectionChanged = vi.fn(async () => {})
    const coordinator = new SupporterAccountCoordinator({
      read: async () => value, write: async next => { value = next }, request, now: () => clock,
      identityChanged: async () => {}, projectionChanged,
      readIntent: async () => saved, writeIntent: async next => { saved = next },
    })
    return { coordinator, request, projectionChanged, stored: () => value, intent: () => saved, advance: (ms: number) => { clock += ms } }
  }
  const pending = { kind: 'pending', secret: 'c'.repeat(64), code: 'ABCDE-12345', expiresAt: iso(600), nextPoll: now + 5000 }

  it('consumes a due approval on an ordinary status read, so a closed settings page does not lose it', async () => {
    const f = journey(pending)
    expect(await f.coordinator.run('status')).toMatchObject({ state: 'pending' })
    expect(f.request).not.toHaveBeenCalled()
    f.advance(5001)
    f.request.mockResolvedValueOnce({ status: 200, body: creds })
    expect(await f.coordinator.run('status')).toMatchObject({ state: 'linked', accountId: creds.accountId })
    expect(f.request).toHaveBeenCalledExactlyOnceWith('/v1/account/device-links/poll', { pollingSecret: 'c'.repeat(64) })
  })

  it('lets a Twitch appearance read finish the link and then read membership', async () => {
    const f = journey({ ...pending, nextPoll: now - 1 })
    f.request.mockResolvedValueOnce({ status: 200, body: creds }).mockResolvedValueOnce(snapshot('active'))
    expect(await f.coordinator.entitlement()).toMatchObject({ state: 'ready', status: 'active' })
    expect(f.request.mock.calls.map(([path]) => path)).toEqual(['/v1/account/device-links/poll', '/v1/billing/supporter'])
  })

  it('keeps a request waiting when a background status read cannot reach the server', async () => {
    for (const failure of [{ status: 503, body: null }, new Error('offline')]) {
      const f = journey({ ...pending, nextPoll: now - 1 })
      if (failure instanceof Error) f.request.mockRejectedValueOnce(failure)
      else f.request.mockResolvedValueOnce(failure)
      expect(await f.coordinator.run('status')).toMatchObject({ state: 'pending', code: 'ABCDE-12345' })
      expect(f.stored()).toMatchObject({ kind: 'pending' })
    }
  })

  it('never polls faster than the stored schedule however many surfaces ask', async () => {
    const f = journey({ ...pending, nextPoll: now - 1 })
    f.request.mockResolvedValue({ status: 200, body: { state: 'pending' } })
    await Promise.all([f.coordinator.run('status'), f.coordinator.entitlement(), f.coordinator.run('poll'), f.coordinator.run('status')])
    expect(f.request).toHaveBeenCalledTimes(1)
  })

  it('signals open surfaces only when the rendered projection changes', async () => {
    const f = journey(creds)
    f.request.mockResolvedValueOnce(snapshot('none', { features: {} }))
      .mockResolvedValueOnce(snapshot('none', { features: {}, revision: 9 }))
      .mockResolvedValueOnce({ status: 503, body: null })
      .mockResolvedValueOnce(snapshot('active'))
    await f.coordinator.entitlement()
    await f.coordinator.entitlement()
    expect(f.projectionChanged).not.toHaveBeenCalled()
    await f.coordinator.entitlement()
    // An outage is not a change; it must not clear a live accent early.
    expect(f.projectionChanged).not.toHaveBeenCalled()
    await f.coordinator.entitlement()
    expect(f.projectionChanged).toHaveBeenCalledOnce()
  })

  it('passes Checkout availability through only as a literal true', async () => {
    for (const [value, expected] of [[true, true], ['true', false], [1, false], [undefined, false]] as const) {
      const f = journey(creds)
      f.request.mockResolvedValueOnce(snapshot('none', { checkoutEnabled: value, features: {} }))
      expect(await f.coordinator.entitlement()).toMatchObject({ state: 'ready', checkoutEnabled: expected })
    }
  })

  it('applies an explicit pre-purchase finish once access is verified, then forgets it', async () => {
    const f = journey(creds, { finish: 'halo', setAt: now - 1000 })
    f.request.mockResolvedValueOnce(snapshot('active')).mockResolvedValueOnce({ status: 200, body: { enabled: true, finish: 'halo' } })
    expect(await f.coordinator.entitlement()).toMatchObject({ state: 'ready', cosmetics: { enabled: true, finish: 'halo' } })
    expect(f.request).toHaveBeenLastCalledWith('/v1/billing/cosmetics', { enabled: true, finish: 'halo' }, creds.token)
    expect(f.intent()).toBeNull()
    f.request.mockResolvedValueOnce(snapshot('active', { cosmetics: { enabled: true, finish: 'halo' } }))
    await f.coordinator.entitlement()
    expect(f.request.mock.calls.filter(([path]) => path === '/v1/billing/cosmetics')).toHaveLength(1)
  })

  it('never equips a choice without verified paid access, for another account, or long after it was made', async () => {
    const cases: Array<[unknown, ReturnType<typeof snapshot>, unknown]> = [
      [{ finish: 'halo', setAt: now - 1000 }, snapshot('none', { features: {} }), 'kept'],
      [{ finish: 'halo', setAt: now - 1000 }, snapshot('active', { cacheUntil: iso(-1) }), 'kept'],
      [{ finish: 'halo', setAt: now - 1000, accountId: '33333333-3333-4333-8333-333333333333' }, snapshot('active'), null],
      [{ finish: 'halo', setAt: now - 8 * 86_400_000 }, snapshot('active'), null],
      [{ finish: 'chrome', setAt: now - 1000 }, snapshot('active'), null],
    ]
    for (const [intent, body, expected] of cases) {
      const f = journey(creds, intent)
      f.request.mockResolvedValueOnce(body)
      await f.coordinator.entitlement()
      expect(f.request.mock.calls.map(([path]) => path), JSON.stringify(intent)).toEqual(['/v1/billing/supporter'])
      expect(f.intent()).toEqual(expected === 'kept' ? intent : expected)
    }
  })

  it('keeps the choice when the server refuses the save, and relinks on a rejected credential', async () => {
    const f = journey(creds, { finish: 'etched', setAt: now - 1000 })
    f.request.mockResolvedValueOnce(snapshot('active')).mockResolvedValueOnce({ status: 403, body: { error: 'supporter_required' } })
    expect(await f.coordinator.entitlement()).toMatchObject({ state: 'ready', cosmetics: { enabled: false } })
    expect(f.intent()).toMatchObject({ finish: 'etched' })
    // A refused save is not retried on every read.
    f.request.mockResolvedValueOnce(snapshot('active'))
    await f.coordinator.entitlement()
    expect(f.request.mock.calls.filter(([path]) => path === '/v1/billing/cosmetics')).toHaveLength(1)
    f.advance(61_000)
    f.request.mockResolvedValueOnce(snapshot('active')).mockResolvedValueOnce({ status: 401, body: null })
    expect(await f.coordinator.entitlement()).toEqual({ state: 'not_linked' })
    expect(f.stored()).toEqual({ kind: 'relink_required' })
  })

  it('binds a choice to the linked account, clears it on an explicit save or disconnect, and signals the save', async () => {
    const f = journey(creds)
    expect(await f.coordinator.setFinishIntent('halo')).toBe('halo')
    expect(f.intent()).toMatchObject({ finish: 'halo', accountId: creds.accountId })
    expect(await f.coordinator.finishIntent()).toBe('halo')
    f.request.mockResolvedValueOnce({ status: 200, body: { enabled: true, finish: 'glass' } })
    expect(await f.coordinator.saveCosmetics({ enabled: true, finish: 'glass' })).toBe(true)
    expect(f.intent()).toBeNull()
    expect(f.projectionChanged).toHaveBeenCalledOnce()
    await f.coordinator.setFinishIntent('etched')
    f.request.mockResolvedValueOnce({ status: 204, body: null })
    await f.coordinator.run('disconnect')
    expect(f.intent()).toBeNull()
    const unlinked = journey()
    await unlinked.coordinator.setFinishIntent('halo')
    expect(unlinked.intent()).toEqual({ finish: 'halo', setAt: now })
  })

  it('accepts the finish-choice message only in its exact shapes, from extension pages', () => {
    expect(parseBackgroundRequest({ type: 'SUPPORTER_FINISH_INTENT' })).toEqual({ type: 'SUPPORTER_FINISH_INTENT' })
    expect(parseBackgroundRequest({ type: 'SUPPORTER_FINISH_INTENT', finish: 'halo' })).toEqual({ type: 'SUPPORTER_FINISH_INTENT', finish: 'halo' })
    expect(parseBackgroundRequest({ type: 'SUPPORTER_FINISH_INTENT', finish: null })).toEqual({ type: 'SUPPORTER_FINISH_INTENT', finish: null })
    for (const invalid of [{ finish: 'aurora' }, { finish: 'halo', enabled: true }, { finish: 'halo', accountId: creds.accountId }, { finish: 1 }]) {
      expect(parseBackgroundRequest({ type: 'SUPPORTER_FINISH_INTENT', ...invalid })).toBeNull()
    }
    expect(MESSAGE_SENDER_SCOPE.SUPPORTER_FINISH_INTENT).toBe('extension-page')
  })
})

describe('pre-purchase finish choice failures', () => {
  const snapshot = (extra: Record<string, unknown> = {}) => ({ status: 200, body: { schemaVersion: 1, accountId: creds.accountId, environment: 'live', revision: 3, status: 'active', serverTime: iso(0), accessFrom: iso(-100), accessUntil: iso(3600), cacheUntil: iso(900), supportPeriods: 1, features: { 'supporter.banner.v1': true, 'supporter.finish.v1': true }, cosmetics: { enabled: false, finish: 'glass' }, ...extra } })
  function setup(intent: unknown) {
    // Long-lived so simulated hours of backoff never reach credential renewal.
    let value: unknown = { ...creds, expiresAt: iso(30 * 86_400), refreshExpiresAt: iso(60 * 86_400) }
    let saved = intent
    let clock = now
    const request = vi.fn<(_: string, body?: Record<string, unknown>, bearer?: string) => Promise<{ status: number; body: unknown }>>()
    const coordinator = new SupporterAccountCoordinator({ read: async () => value, write: async next => { value = next }, request, now: () => clock, readIntent: async () => saved, writeIntent: async next => { saved = next } })
    return { coordinator, request, intent: () => saved, advance: (ms: number) => { clock += ms } }
  }

  it('keeps the verified membership when applying the choice fails in transit', async () => {
    const f = setup({ finish: 'halo', setAt: now - 1000 })
    f.request.mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error('offline'))
    expect(await f.coordinator.entitlement()).toMatchObject({ state: 'ready', status: 'active', cosmetics: { enabled: false } })
    expect(f.intent()).toMatchObject({ finish: 'halo' })
  })

  it('never overrides a finish the account already has equipped', async () => {
    const f = setup({ finish: 'halo', setAt: now - 1000 })
    f.request.mockResolvedValueOnce(snapshot({ cosmetics: { enabled: true, finish: 'etched' } }))
    expect(await f.coordinator.entitlement()).toMatchObject({ cosmetics: { enabled: true, finish: 'etched' } })
    expect(f.request.mock.calls.map(([path]) => path)).toEqual(['/v1/billing/supporter'])
    expect(f.intent()).toBeNull()
  })

  it('backs off between failed applies and gives up after five', async () => {
    const f = setup({ finish: 'halo', setAt: now - 1000 })
    f.request.mockImplementation(async path => path === '/v1/billing/cosmetics' ? { status: 503, body: null } : snapshot())
    const posts = () => f.request.mock.calls.filter(([path]) => path === '/v1/billing/cosmetics').length
    for (let attempt = 1; attempt <= 5; attempt++) {
      await f.coordinator.entitlement()
      expect(posts()).toBe(attempt)
      await f.coordinator.entitlement()
      expect(posts()).toBe(attempt)
      f.advance(61 * 60_000)
    }
    expect(f.intent()).toBeNull()
    await f.coordinator.entitlement()
    expect(posts()).toBe(5)
  })

  it('reports a waiting link without touching credentials or the network', async () => {
    const f = setup(null)
    expect(await f.coordinator.hasPendingLink()).toBe(false)
    const waiting = new SupporterAccountCoordinator({ read: async () => ({ kind: 'pending', secret: 'c'.repeat(64), code: 'ABCDE-12345', expiresAt: iso(600), nextPoll: now }), write: async () => {}, request: f.request })
    expect(await waiting.hasPendingLink()).toBe(true)
    expect(f.request).not.toHaveBeenCalled()
  })
})

describe('shared appearance reads (cachedEntitlement)', () => {
  const perks = { 'supporter.banner.v1': true, 'supporter.finish.v1': true }
  const none = { 'supporter.banner.v1': false, 'supporter.finish.v1': false }
  const snapshot = (features: Record<string, boolean>, extra: Record<string, unknown> = {}) => ({ status: 200, body: { schemaVersion: 1, accountId: creds.accountId, environment: 'live', revision: 3,
    status: Object.values(features).some(Boolean) ? 'active' : 'none', serverTime: iso(0), accessFrom: iso(-100), accessUntil: iso(3600), cacheUntil: iso(900), supportPeriods: 1,
    features, cosmetics: { enabled: true, finish: 'halo' }, ...extra } })
  function setup(first: { status: number; body: unknown }) {
    let value: unknown = { ...creds, expiresAt: iso(30 * 86_400), refreshExpiresAt: iso(60 * 86_400) }
    let clock = now
    const request = vi.fn<(path: string, body?: Record<string, unknown>, bearer?: string) => Promise<{ status: number; body: unknown }>>(async () => first)
    const coordinator = new SupporterAccountCoordinator({ read: async () => value, write: async next => { value = next }, request, now: () => clock })
    const reads = () => request.mock.calls.filter(([path]) => path === '/v1/billing/supporter').length
    return { coordinator, request, reads, advance: (ms: number) => { clock += ms }, store: (next: unknown) => { value = next } }
  }

  it('shares one read with perks across tabs for 40 s, serving the remaining validity', async () => {
    const f = setup(snapshot(perks))
    expect(await f.coordinator.cachedEntitlement()).toMatchObject({ state: 'ready', validForMs: 60_000 })
    f.advance(25_000)
    // Another tab, or a remount, 25 s later: no request, and 25 s less validity.
    expect(await f.coordinator.cachedEntitlement()).toMatchObject({ state: 'ready', validForMs: 35_000, cosmetics: { finish: 'halo' } })
    expect(f.reads()).toBe(1)
    f.advance(15_000)
    await f.coordinator.cachedEntitlement()
    expect(f.reads()).toBe(2)
  })

  it('re-checks an account without perks only at the server cacheUntil (at most 15 minutes)', async () => {
    const f = setup(snapshot(none))
    expect(await f.coordinator.cachedEntitlement()).toMatchObject({ state: 'ready', features: [] })
    for (let minute = 1; minute < 15; minute++) { f.advance(60_000); await f.coordinator.cachedEntitlement() }
    expect(f.reads()).toBe(1)
    f.advance(60_000)
    await f.coordinator.cachedEntitlement()
    expect(f.reads()).toBe(2)
  })

  it('never trusts a server cache window beyond 15 minutes', async () => {
    const f = setup(snapshot(none, { cacheUntil: iso(86_400) }))
    await f.coordinator.cachedEntitlement()
    f.advance(15 * 60_000)
    await f.coordinator.cachedEntitlement()
    expect(f.reads()).toBe(2)
  })

  it('shares a failed read for 30 s instead of every tab retrying it', async () => {
    const f = setup({ status: 503, body: null })
    expect(await f.coordinator.cachedEntitlement()).toEqual({ state: 'unavailable', reason: 'temporarily_unavailable' })
    f.advance(29_000)
    await f.coordinator.cachedEntitlement()
    expect(f.reads()).toBe(1)
    f.advance(1_000)
    await f.coordinator.cachedEntitlement()
    expect(f.reads()).toBe(2)
  })

  it('a settings read is always fresh and refreshes what tabs are served', async () => {
    const f = setup(snapshot(none))
    await f.coordinator.cachedEntitlement()
    f.request.mockResolvedValue(snapshot(perks))
    expect(await f.coordinator.entitlement()).toMatchObject({ features: expect.arrayContaining(['supporter.banner.v1']) })
    expect(await f.coordinator.cachedEntitlement()).toMatchObject({ features: expect.arrayContaining(['supporter.banner.v1']) })
    expect(f.reads()).toBe(2)
  })

  it('drops the shared read on a cosmetics save, a finish choice, sign-out and another account', async () => {
    const f = setup(snapshot(perks))
    await f.coordinator.cachedEntitlement()
    f.request.mockImplementation(async path => path === '/v1/billing/cosmetics' ? { status: 200, body: {} } : snapshot(perks))
    expect(await f.coordinator.saveCosmetics({ enabled: true, finish: 'etched' })).toBe(true)
    await f.coordinator.cachedEntitlement()
    expect(f.reads()).toBe(2)
    await f.coordinator.setFinishIntent(null)
    await f.coordinator.cachedEntitlement()
    expect(f.reads()).toBe(3)
    // Another account signed in on this device: the first account's read is never served.
    f.store({ ...creds, accountId: '99999999-9999-4999-8999-999999999999', expiresAt: iso(30 * 86_400), refreshExpiresAt: iso(60 * 86_400) })
    f.request.mockResolvedValue({ status: 200, body: { ...snapshot(none).body, accountId: '99999999-9999-4999-8999-999999999999' } })
    expect(await f.coordinator.cachedEntitlement()).toMatchObject({ state: 'ready', features: [] })
    expect(f.reads()).toBe(4)
    f.request.mockResolvedValue({ status: 204, body: null })
    await f.coordinator.run('disconnect')
    expect(await f.coordinator.cachedEntitlement()).toEqual({ state: 'not_linked' })
    expect(f.reads()).toBe(4)
  })
})
