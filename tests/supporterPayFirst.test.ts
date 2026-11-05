import { describe, expect, it, vi } from 'vitest'
import { SupporterAccountCoordinator } from '../src/background/supporterAccount.ts'
import { SupporterPayFirstCoordinator, validatedStripeUrl, PAY_FIRST_WATCH_MS } from '../src/background/supporterPayFirst.ts'
import { parseBackgroundRequest } from '../src/shared/parseBackgroundRequest.ts'
import { MESSAGE_SENDER_SCOPE } from '../src/background/pulseBroadcastTargets.ts'

const now = Date.parse('2026-10-01T12:00:00Z')
const iso = (delta: number) => new Date(now + delta).toISOString()
const credentials = { accountId: '22222222-2222-4222-8222-222222222222', deviceId: '11111111-1111-4111-8111-111111111111', token: 'a'.repeat(64), refreshToken: 'b'.repeat(64), expiresAt: iso(86_400_000), refreshExpiresAt: iso(90 * 86_400_000) }
const attemptId = '33333333-3333-4333-8333-333333333333'
const restoreId = '44444444-4444-4444-8444-444444444444'
function fixture(twitchSignIn = false) {
  let account: unknown = null, key: unknown = null, journey: unknown = null, clock = now
  let membership: Record<string, unknown> = { schemaVersion: 1, accountId: credentials.accountId, environment: 'live', revision: 1, status: 'none', serverTime: iso(0), accessFrom: iso(-1000), accessUntil: iso(3_600_000), cacheUntil: iso(60_000), features: {}, checkoutEnabled: true, installationAccountsEnabled: true, accountKind: 'installation', restoreEligible: true }
  const request = vi.fn(async (path: string, _body?: Record<string, unknown>, _bearer?: string): Promise<{status: number; body: unknown}> => {
    if (path === '/v1/account/installations') return { status: 201, body: credentials }
    return { status: 404, body: null }
  })
  const identityChanged = vi.fn(async () => {})
  const supporter = new SupporterAccountCoordinator({ read: async () => account, write: async value => { account = value }, readInstallationKey: async () => key, writeInstallationKey: async value => { key = value }, request: async (path, body, bearer) => path === '/v1/billing/supporter' ? { status: 200, body: membership } : request(path, body, bearer), now: () => clock, identityChanged })
  const open = vi.fn(async (_url: string) => {})
  const recreate = () => new SupporterPayFirstCoordinator({ account: supporter, request, read: async () => journey, write: async value => { journey = value }, open, now: () => clock, twitchSignIn })
  const pay = recreate()
  return { supporter, pay, recreate, request, open, identityChanged, stored: () => ({ account, key: key && typeof key === 'object' ? (key as { key: string }).key : key, bootstrap: key, journey }), advance: (ms: number) => { clock += ms }, setMembership: (changes: Record<string, unknown>) => { membership = { ...membership, ...changes } }, seed: (value: { account?: unknown; journey?: unknown }) => { if ('account' in value) account = value.account; if ('journey' in value) journey = value.journey } }
}

describe('explicit nonpaid installation connection', () => {
  it('does not enroll on reads; concurrent explicit connections enroll once without starting payment', async () => {
    const f = fixture()
    await f.pay.billing('status')
    await f.pay.billing('check')
    await f.supporter.entitlement()
    expect(f.request).not.toHaveBeenCalled()
    expect(f.stored().account).toBeNull()

    expect(await Promise.all([f.pay.billing('connect'), f.pay.billing('connect')])).toEqual([{ state: 'idle' }, { state: 'idle' }])
    expect(f.request.mock.calls.map(([path]) => path)).toEqual(['/v1/account/installations'])
    expect(await f.supporter.localAccountId()).toBe(credentials.accountId)
    expect(f.stored().bootstrap).toMatchObject({ state: 'claimed', accountId: credentials.accountId })
    expect(f.open).not.toHaveBeenCalled()
    expect(f.stored().journey).not.toHaveProperty('billing')
    expect(JSON.stringify(await f.pay.billing('connect'))).not.toMatch(/token|installationKey|accountId|aaaa|bbbb/)
  })

  it.each([
    [false, false], [false, true], [true, false], [undefined, true], [true, undefined], ['true', true], [true, 'true'],
  ])('keeps payment closed unless both server flags are literal true: %s / %s', async (checkoutEnabled, installationAccountsEnabled) => {
    const f = fixture()
    f.setMembership({ checkoutEnabled, installationAccountsEnabled })
    expect(await f.pay.billing('connect')).toEqual({ state: 'closed' })
    expect(await f.supporter.localAccountId()).toBe(credentials.accountId)
    expect(f.request.mock.calls.map(([path]) => path)).toEqual(['/v1/account/installations'])
    expect(f.open).not.toHaveBeenCalled()
  })

  it.each([
    { environment: 'sandbox' },
    { accountId: '55555555-5555-4555-8555-555555555555' },
    { schemaVersion: 999 },
    { accountKind: 'email' },
    { accountKind: undefined },
  ])('does not use an unverified or non-installation capability to start payment: %j', async change => {
    const f = fixture()
    f.setMembership(change)
    expect(await f.pay.billing('connect')).toEqual({ state: 'unavailable' })
    expect(f.request.mock.calls.map(([path]) => path)).toEqual(['/v1/account/installations'])
    expect(f.open).not.toHaveBeenCalled()
  })

  it.each([404, 409, 429, 503])('does not fall through to payment or a website when enrollment returns %s', async status => {
    const f = fixture()
    f.request.mockResolvedValue({ status, body: status === 409 ? { error: 'installation_initialized' } : null })
    expect(await f.pay.billing('connect')).toEqual({ state: status === 404 ? 'closed' : 'unavailable' })
    expect(f.stored().account).toBeNull()
    expect(f.request).toHaveBeenCalledTimes(1)
    expect(f.open).not.toHaveBeenCalled()
  })

  it('keeps a lost connection response nonpaid and permits an explicit retry with the same key', async () => {
    const f = fixture()
    f.request.mockRejectedValueOnce(new Error('offline'))
    expect(await f.pay.billing('connect')).toEqual({ state: 'unavailable' })
    const firstKey = f.stored().key
    expect(await f.pay.billing('connect')).toEqual({ state: 'idle' })
    expect(f.request.mock.calls.map(([path, body]) => [path, body?.installationKey])).toEqual([
      ['/v1/account/installations', firstKey], ['/v1/account/installations', firstKey],
    ])
    expect(f.open).not.toHaveBeenCalled()
  })

  it('preserves an existing email identity without creating an installation or opening billing', async () => {
    const f = fixture()
    const account = { kind: 'linked', ...credentials }
    f.seed({ account })
    f.setMembership({ accountKind: 'email' })
    expect(await f.pay.billing('connect')).toEqual({ state: 'unavailable' })
    expect(f.stored().account).toEqual(account)
    expect(f.stored().key).toBeNull()
    expect(f.request).not.toHaveBeenCalled()
    expect(f.open).not.toHaveBeenCalled()
  })

  it('preserves a paid installation identity without starting another payment', async () => {
    const f = fixture()
    const account = { kind: 'linked', ...credentials, installation: true }
    f.seed({ account })
    f.setMembership({ status: 'active' })
    expect(await f.pay.billing('connect')).toEqual({ state: 'idle' })
    expect(f.stored().account).toEqual(account)
    expect(f.request).not.toHaveBeenCalled()
    expect(f.open).not.toHaveBeenCalled()
  })

  it.each([
    { state: 'error' },
    { state: 'unavailable', reason: 'temporarily_unavailable' },
    { state: 'unavailable', reason: 'environment_mismatch' },
    { state: 'not_linked' },
  ] as const)('keeps payment paused after a connection with an unanswered capability: %j', async capability => {
    const f = fixture()
    vi.spyOn(f.supporter, 'entitlement').mockResolvedValueOnce(capability)
    expect(await f.pay.billing('connect')).toEqual({ state: 'unavailable' })
    expect(f.request.mock.calls.map(([path]) => path)).toEqual(['/v1/account/installations'])
    expect(f.open).not.toHaveBeenCalled()
  })

  it('does not allow a failed capability read to fall through to checkout', async () => {
    const f = fixture()
    vi.spyOn(f.supporter, 'entitlement').mockRejectedValueOnce(new Error('offline'))
    expect(await f.pay.billing('connect')).toEqual({ state: 'unavailable' })
    expect(f.request.mock.calls.map(([path]) => path)).toEqual(['/v1/account/installations'])
    expect(f.open).not.toHaveBeenCalled()
  })

  it('ignores a delayed open capability after the connected identity signs out', async () => {
    const f = fixture()
    await f.supporter.ensureInstallation('connect')
    const capability = await f.supporter.entitlement()
    let resolveCapability!: (value: typeof capability) => void
    const read = vi.spyOn(f.supporter, 'entitlement').mockImplementationOnce(() => new Promise(resolve => { resolveCapability = resolve }))
    f.request.mockResolvedValue({ status: 204, body: null })
    const connecting = f.pay.billing('connect')
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
    await f.supporter.run('disconnect')
    resolveCapability(capability)
    expect(await connecting).toEqual({ state: 'unavailable' })
    expect(f.stored().account).toBeNull()
    expect(f.request.mock.calls.map(([path]) => path)).toEqual(['/v1/account/installations', '/v1/account/devices/disconnect'])
    expect(f.open).not.toHaveBeenCalled()
  })

  it('refuses the installation entry when Twitch sign-in is enabled', async () => {
    const f = fixture(true)
    expect(await f.pay.billing('connect')).toEqual({ state: 'unavailable' })
    expect(f.stored().account).toBeNull()
    expect(f.request).not.toHaveBeenCalled()
    expect(f.open).not.toHaveBeenCalled()
  })

  it.each(['waiting', 'confirming'] as const)('does not poll, recover or reopen an existing %s checkout', async phase => {
    const f = fixture()
    f.seed({ account: { kind: 'linked', ...credentials, installation: true }, journey: { billing: { accountId: credentials.accountId, attemptId, phase, until: now + 600_000, watchUntil: now + 600_000, nextPoll: now - 1, ...(phase === 'waiting' ? { url: 'https://checkout.stripe.com/c/pay/owned' } : {}) } } })
    expect(await f.pay.billing('connect')).toEqual({ state: 'reconnect_required' })
    expect(f.request).not.toHaveBeenCalled()
    expect(f.open).not.toHaveBeenCalled()
    expect(f.stored().journey).toHaveProperty('billing.attemptId', attemptId)
  })

  it('preserves an unresolved earlier payment without enrolling another identity', async () => {
    const f = fixture()
    const barrier = { hash: 'd'.repeat(64), until: now + 600_000 }
    f.seed({ journey: { unresolvedAccounts: [barrier] } })
    expect(await f.pay.billing('connect')).toEqual({ state: 'reconnect_required' })
    expect(f.stored().journey).toHaveProperty('unresolvedAccounts', [barrier])
    expect(f.stored().account).toBeNull()
    expect(f.request).not.toHaveBeenCalled()
    expect(f.open).not.toHaveBeenCalled()
  })

  it.each([
    { restore: { accountId: credentials.accountId, restoreId, secret: 'c'.repeat(64), comparisonCode: 'A3B4C5', expiresAt: iso(600_000), nextPoll: now - 1, interval: 5000 } },
    { restoreStart: { accountId: credentials.accountId, key: 'c'.repeat(64), until: now + 600_000, nextRetry: now - 1 } },
  ])('does not poll or continue restoration when explicitly connecting: %j', async journey => {
    const f = fixture()
    const account = { kind: 'linked', ...credentials, installation: true }
    f.seed({ account, journey })
    expect(await f.pay.billing('connect')).toEqual({ state: 'reconnect_required' })
    expect(f.stored().account).toEqual(account)
    expect(f.request).not.toHaveBeenCalled()
    expect(f.open).not.toHaveBeenCalled()
  })

  it.each(['billingRetryUntil', 'restoreRetryUntil'])('respects the existing %s without any enrollment or billing request', async field => {
    const f = fixture()
    f.seed({ journey: { [field]: now + 90_000 } })
    expect(await f.pay.billing('connect')).toEqual({ state: 'try_later', retryAt: now + 90_000 })
    expect(f.request).not.toHaveBeenCalled()
    expect(f.open).not.toHaveBeenCalled()
    expect(f.stored().key).toBeNull()
  })

  it('accepts only the exact new connection message within the existing extension-page sender scope', () => {
    expect(parseBackgroundRequest({ type: 'SUPPORTER_BILLING', action: 'connect' })).toEqual({ type: 'SUPPORTER_BILLING', action: 'connect' })
    expect(MESSAGE_SENDER_SCOPE.SUPPORTER_BILLING).toBe('extension-page')
    for (const field of ['url', 'token', 'accountId', 'checkoutEnabled', 'installationAccountsEnabled']) {
      expect(parseBackgroundRequest({ type: 'SUPPORTER_BILLING', action: 'connect', [field]: true })).toBeNull()
    }
  })
})

describe('worker-private pay-first journey', () => {
  it('creates only on interaction, reuses credentials, opens exact Stripe host, and never exposes secrets', async () => {
    const f = fixture()
    expect(await f.pay.billing('status')).toEqual({ state: 'idle' })
    expect(f.request).not.toHaveBeenCalled()
    f.request.mockImplementationOnce(async () => ({ status: 201, body: credentials }))
    f.request.mockImplementationOnce(async () => ({ status: 200, body: { attemptId, url: 'https://checkout.stripe.com/c/pay/cs_test_local', expiresAt: iso(30 * 60_000) } }))
    const result = await f.pay.billing('checkout')
    expect(result).toEqual({ state: 'waiting', attemptId })
    expect(f.open).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/cs_test_local')
    expect(f.request.mock.calls[0][1]).toMatchObject({ installationKey: expect.stringMatching(/^[a-f0-9]{64}$/), label: 'StreamPulse extension' })
    expect(f.request.mock.calls[1]).toEqual(['/v1/billing/checkout', {}, credentials.token])
    expect(JSON.stringify(result)).not.toMatch(/cs_test|aaaa|bbbb|installationKey/)
    await f.pay.billing('checkout')
    expect(f.open).toHaveBeenCalledTimes(1)
    expect(f.request.mock.calls.filter(([path]) => path === '/v1/billing/checkout')).toHaveLength(1)
    expect(await f.pay.billing('resume')).toEqual({ state: 'waiting', attemptId })
    expect(f.open).toHaveBeenCalledTimes(2)
    expect(f.request.mock.calls.filter(([path]) => path === '/v1/billing/checkout')).toHaveLength(1)
  })
  it('falls back on installation 404 without credential or billing writes', async () => {
    const f = fixture()
    f.request.mockResolvedValue({ status: 404, body: null })
    expect(await f.pay.billing('checkout')).toEqual({ state: 'fallback' })
    expect(f.open).not.toHaveBeenCalled()
    expect(f.request).toHaveBeenCalledTimes(1)
    expect(f.stored().account).toBeNull()
  })
  it('retries a lost installation response with the same private key and serializes repeated starts', async () => {
    const f = fixture()
    f.request.mockRejectedValueOnce(new Error('lost creation response'))
    expect(await f.supporter.ensureInstallation()).toEqual({ state: 'error' })
    const firstKey = f.stored().key
    const [one, two] = await Promise.all([f.supporter.ensureInstallation(), f.supporter.ensureInstallation()])
    expect(one).toMatchObject({ state: 'linked', accountId: credentials.accountId })
    expect(two).toEqual(one)
    expect(f.stored().key).toBe(firstKey)
    expect(f.request.mock.calls.map(([, body]) => body?.installationKey)).toEqual([firstKey, firstKey])
    expect(JSON.stringify(one)).not.toContain(String(firstKey))
  })
  it('keeps the durable installation key on rejection and explicitly restores through a fresh empty installation', async () => {
    const f = fixture()
    await f.supporter.ensureInstallation()
    const rejectedKey = f.stored().key
    await expect(f.supporter.withCredential(async () => ({ status: 401 }))).rejects.toThrow('account_authorization_required')
    expect(f.stored().key).toBe(rejectedKey)
    f.request.mockImplementation(async (path, body) => {
      if (path === '/v1/account/installations') return body?.installationKey === rejectedKey ? { status: 409, body: { error: 'installation_initialized' } } : { status: 201, body: credentials }
      if (path === '/v1/account/restores') return { status: 201, body: { restoreId, pollingSecret: 'c'.repeat(64), expiresAt: iso(900_000), intervalSeconds: 5, comparisonCode: 'A3B4C5' } }
      return { status: 404, body: null }
    })
    expect(await f.pay.restore('start', 'payer@example.test')).toEqual({ state: 'pending', expiresAt: iso(900_000), comparisonCode: 'A3B4C5' })
    expect(f.stored().key).not.toBe(rejectedKey)
  })
  it('retries a lost restore bootstrap with the same pending key', async () => {
    const f = fixture()
    f.request.mockRejectedValueOnce(new Error('installation response lost'))
    expect(await f.pay.restore('start', 'payer@example.test')).toEqual({ state: 'unavailable', reason: 'connection' })
    const pendingKey = f.stored().key
    expect(f.stored().bootstrap).toMatchObject({ state: 'pending' })
    f.request.mockResolvedValueOnce({ status: 201, body: credentials }).mockResolvedValueOnce({ status: 201, body: { restoreId, pollingSecret: 'c'.repeat(64), expiresAt: iso(900_000), intervalSeconds: 5, comparisonCode: 'A3B4C5' } })
    expect(await f.pay.restore('start', 'payer@example.test')).toEqual({ state: 'pending', expiresAt: iso(900_000), comparisonCode: 'A3B4C5' })
    expect(f.request.mock.calls.filter(([path]) => path === '/v1/account/installations').map(([, body]) => body?.installationKey)).toEqual([pendingKey, pendingKey])
  })
  it('resumes persisted Checkout and restore waits when the worker coordinator is reconstructed', async () => {
    const payment = fixture()
    payment.request.mockResolvedValueOnce({ status: 201, body: credentials }).mockResolvedValueOnce({ status: 200, body: { attemptId, url: 'https://checkout.stripe.com/c/pay/cs_test_local', expiresAt: iso(86_400_000) } })
    await payment.pay.billing('checkout')
    const restartedPayment = payment.recreate()
    expect(await restartedPayment.hasPending()).toBe(true)
    expect(await restartedPayment.billing('checkout')).toMatchObject({ state: 'waiting', attemptId })
    expect(payment.request.mock.calls.filter(([path]) => path === '/v1/billing/checkout')).toHaveLength(1)
    payment.advance(5000); payment.setMembership({ status: 'active' })
    payment.request.mockResolvedValueOnce({ status: 200, body: { attemptId, state: 'active' } })
    expect(await restartedPayment.billing('status')).toEqual({ state: 'active' })
    const recovery = fixture()
    recovery.request.mockResolvedValueOnce({ status: 201, body: credentials }).mockResolvedValueOnce({ status: 201, body: { restoreId, pollingSecret: 'c'.repeat(64), expiresAt: iso(900_000), intervalSeconds: 5, comparisonCode: 'A3B4C5' } })
    await recovery.pay.restore('start', 'payer@example.test')
    const restartedRecovery = recovery.recreate()
    expect(await restartedRecovery.hasPending()).toBe(true)
    recovery.advance(5000)
    recovery.request.mockResolvedValueOnce({ status: 200, body: { state: 'approved', ...credentials } })
    expect(await restartedRecovery.restore('status')).toEqual({ state: 'restored' })
    expect(recovery.request.mock.calls.filter(([path]) => path === '/v1/account/restores')).toHaveLength(1)
  })
  it('retains an unexpired restore through an explicitly unattempted credential refresh', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ status: 201, body: { ...credentials, expiresAt: iso(61_000) } }).mockResolvedValueOnce({ status: 201, body: { restoreId, pollingSecret: 'c'.repeat(64), expiresAt: iso(900_000), intervalSeconds: 5, comparisonCode: 'A3B4C5' } })
    expect(await f.pay.restore('start', 'payer@example.test')).toEqual({ state: 'pending', expiresAt: iso(900_000), comparisonCode: 'A3B4C5' })
    f.advance(5000)
    f.request.mockResolvedValueOnce({ status: 503, body: { error: 'refresh_not_attempted' } })
    expect(await f.pay.restore('status')).toEqual({ state: 'pending', expiresAt: iso(900_000), comparisonCode: 'A3B4C5' })
    expect(f.stored().journey).toMatchObject({ restore: { restoreId, accountId: credentials.accountId, secret: 'c'.repeat(64) } })
    expect(await f.pay.hasPending()).toBe(true)
    expect(f.request.mock.calls.filter(([path]) => path === '/v1/account/restores/poll')).toHaveLength(0)
    expect(await f.pay.restore('status')).toEqual({ state: 'pending', expiresAt: iso(900_000), comparisonCode: 'A3B4C5' })
    f.advance(31_000)
    const renewed = { ...credentials, token: 'f'.repeat(64), refreshToken: 'e'.repeat(64) }
    const restored = { ...credentials, accountId: '55555555-5555-4555-8555-555555555555', deviceId: '66666666-6666-4666-8666-666666666666', token: 'd'.repeat(64), refreshToken: 'e'.repeat(64) }
    f.request.mockResolvedValueOnce({ status: 200, body: renewed }).mockResolvedValueOnce({ status: 200, body: { state: 'approved', ...restored } })
    expect(await f.pay.restore('status')).toEqual({ state: 'restored' })
    expect(f.request).toHaveBeenLastCalledWith('/v1/account/restores/poll', { restoreId, pollingSecret: 'c'.repeat(64), restoreKey: expect.stringMatching(/^[a-f0-9]{64}$/) }, renewed.token)
    expect(await f.supporter.localAccountId()).toBe(restored.accountId)
  })
  it('retains the uncertain payment barrier after credentials are revoked', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ status: 201, body: credentials }).mockResolvedValueOnce({ status: 200, body: { attemptId, url: 'https://checkout.stripe.com/c/pay/cs_test_local', expiresAt: iso(86_400_000) } })
    await f.pay.billing('checkout')
    await expect(f.supporter.withCredential(async () => ({ status: 401 }))).rejects.toThrow('account_authorization_required')
    expect(await f.pay.billing('checkout')).toMatchObject({ state: 'reconnect_required' })
    expect(await f.pay.hasPending()).toBe(false)
    expect(f.request.mock.calls.filter(([path]) => path === '/v1/billing/checkout')).toHaveLength(1)
  })
  it('revokes a newly minted restore family when approval races disconnect, without adopting it', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ status: 201, body: credentials }).mockResolvedValueOnce({ status: 201, body: { restoreId, pollingSecret: 'c'.repeat(64), expiresAt: iso(900_000), intervalSeconds: 5, comparisonCode: 'A3B4C5' } })
    await f.pay.restore('start', 'payer@example.test')
    f.advance(5000)
    let resolve!: (value: { status: number; body: unknown }) => void
    f.request.mockImplementationOnce(() => new Promise(done => { resolve = done })).mockResolvedValue({ status: 204, body: null })
    const poll = f.pay.restore('status')
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledWith('/v1/account/restores/poll', { restoreId, pollingSecret: 'c'.repeat(64), restoreKey: expect.stringMatching(/^[a-f0-9]{64}$/) }, credentials.token))
    const disconnect = f.supporter.run('disconnect')
    resolve({ status: 200, body: { state: 'approved', ...credentials, token: 'd'.repeat(64), refreshToken: 'e'.repeat(64), accountId: '55555555-5555-4555-8555-555555555555', deviceId: '66666666-6666-4666-8666-666666666666' } })
    await poll; await disconnect
    expect(f.request).toHaveBeenCalledWith('/v1/account/devices/disconnect', { token: 'd'.repeat(64) }, undefined)
    expect(f.request).toHaveBeenCalledWith('/v1/account/devices/disconnect', { token: credentials.token }, undefined)
    expect(f.stored().account).toBeNull()
    expect(await f.supporter.run('status')).toEqual({ state: 'signed_out' })
  })
  it('manages the restored current account without discarding an older account payment barrier', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ status: 201, body: credentials }).mockResolvedValueOnce({ status: 200, body: { attemptId, url: 'https://checkout.stripe.com/c/pay/cs_test_local', expiresAt: iso(86_400_000) } })
    await f.pay.billing('checkout')
    const restored = { state: 'approved', ...credentials, accountId: '55555555-5555-4555-8555-555555555555', token: 'd'.repeat(64), refreshToken: 'e'.repeat(64) }
    await f.supporter.adoptRestoredCredentials(restored, credentials.accountId)
    f.setMembership({ accountId: restored.accountId, status: 'active' })
    f.request.mockResolvedValueOnce({ status: 200, body: { url: 'https://billing.stripe.com/p/session/restored' } })
    expect(await f.pay.billing('portal')).toEqual({ state: 'idle' })
    expect(f.open).toHaveBeenLastCalledWith('https://billing.stripe.com/p/session/restored')
    expect(f.request).toHaveBeenLastCalledWith('/v1/billing/portal', {}, restored.token)
    expect(await f.pay.billing('checkout')).toMatchObject({ state: 'active' })
    expect(f.request.mock.calls.filter(([path]) => path === '/v1/billing/checkout')).toHaveLength(1)
  })
  it.each(['https://checkout.stripe.com.evil.test/a', 'http://checkout.stripe.com/a', 'https://u:p@checkout.stripe.com/a', 'https://checkout.stripe.com:444/a', 'https://billing.stripe.com/a'])('refuses checkout URL %s', async url => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ status: 201, body: credentials }).mockResolvedValueOnce({ status: 200, body: { attemptId, url } })
    expect(await f.pay.billing('checkout')).toEqual({ state: 'still_confirming', attemptId })
    expect(f.open).not.toHaveBeenCalled()
  })
  it('keeps uncertain POST bounded and persisted; never automatically POSTs checkout again', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ status: 201, body: credentials }).mockRejectedValueOnce(new Error('lost response'))
    expect(await f.pay.billing('checkout')).toEqual({ state: 'confirming' })
    expect(await f.pay.hasPending()).toBe(true)
    f.advance(PAY_FIRST_WATCH_MS + 1)
    expect(await f.pay.billing('status')).toEqual({ state: 'still_confirming', automaticPolling: false })
    expect(await f.pay.hasPending()).toBe(false)
    expect(await f.pay.billing('checkout')).toEqual({ state: 'still_confirming', automaticPolling: false })
    expect(f.request.mock.calls.filter(([path]) => path === '/v1/billing/checkout')).toHaveLength(1)
  })
  it('expired attempt permits a new deliberate attempt; pending is owned, throttled and never pays twice', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ status: 201, body: credentials }).mockResolvedValueOnce({ status: 409, body: { error: 'checkout_pending', attemptId } })
    expect(await f.pay.billing('checkout')).toEqual({ state: 'confirming', attemptId })
    expect(f.open).not.toHaveBeenCalled()
    f.advance(5000)
    f.request.mockResolvedValueOnce({ status: 200, body: { attemptId, state: 'expired' } })
    expect(await f.pay.billing('status')).toEqual({ state: 'expired' })
    expect(f.request).toHaveBeenLastCalledWith(`/v1/billing/checkout/${attemptId}`, undefined, credentials.token)
  })
  it('does not reinterpret an unproven failed attempt as permission to pay again', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ status: 201, body: credentials }).mockResolvedValueOnce({ status: 409, body: { error: 'checkout_pending', attemptId } })
    await f.pay.billing('checkout'); f.advance(5000)
    f.request.mockResolvedValueOnce({ status: 200, body: { attemptId, state: 'failed' } })
    expect(await f.pay.billing('status')).toMatchObject({ state: 'confirming', attemptId })
    expect(await f.pay.billing('checkout')).toMatchObject({ state: 'confirming', attemptId })
    expect(f.request.mock.calls.filter(([path]) => path === '/v1/billing/checkout')).toHaveLength(1)
  })
  it('restores with private polling secret, requires target credentials, and wakes without a settings page', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ status: 201, body: credentials }).mockResolvedValueOnce({ status: 201, body: { restoreId, pollingSecret: 'c'.repeat(64), expiresAt: iso(900_000), intervalSeconds: 5, comparisonCode: 'A3B4C5' } })
    const response = await f.pay.restore('start', 'payer@example.test')
    expect(response).toEqual({ state: 'pending', expiresAt: iso(900_000), comparisonCode: 'A3B4C5' })
    expect(JSON.stringify(response)).not.toMatch(/cccc|payer|restoreId/)
    f.advance(5000)
    const recovered = { ...credentials, accountId: '55555555-5555-4555-8555-555555555555', token: 'd'.repeat(64), refreshToken: 'e'.repeat(64) }
    f.request.mockResolvedValueOnce({ status: 200, body: { state: 'approved', ...recovered } })
    expect(await f.pay.restore('status')).toEqual({ state: 'restored' })
    expect(f.request).toHaveBeenLastCalledWith('/v1/account/restores/poll', { restoreId, pollingSecret: 'c'.repeat(64), restoreKey: expect.stringMatching(/^[a-f0-9]{64}$/) }, credentials.token)
    expect(await f.supporter.run('status')).toMatchObject({ state: 'linked', accountId: recovered.accountId })
    expect(await f.pay.hasPending()).toBe(false)
  })
  it('restore conflicts and expiry are terminal; never leaks email matches', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ status: 201, body: credentials }).mockResolvedValueOnce({ status: 409, body: { error: 'restore_conflict' } })
    expect(await f.pay.restore('start', 'payer@example.test')).toEqual({ state: 'ineligible' })
    expect(await f.pay.hasPending()).toBe(false)
  })
  it('expires a changed-email restore without signing out the current browser', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ status: 201, body: credentials }).mockResolvedValueOnce({ status: 201, body: { restoreId, pollingSecret: 'c'.repeat(64), expiresAt: iso(900_000), intervalSeconds: 5, comparisonCode: 'A3B4C5' } })
    await f.pay.restore('start', 'payer@example.test')
    f.advance(5000)
    f.request.mockResolvedValueOnce({ status: 410, body: { error: 'restore_invalid_or_expired' } })
    expect(await f.pay.restore('status')).toEqual({ state: 'expired' })
    expect(await f.supporter.run('status')).toMatchObject({ state: 'linked', accountId: credentials.accountId })
    expect(f.request.mock.calls.filter(([path]) => path === '/v1/account/restores/poll')).toHaveLength(1)
    expect(f.stored().journey).not.toHaveProperty('restore')
  })
  it('expires a pending restore at its deadline without polling or retaining a secret', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ status: 201, body: credentials }).mockResolvedValueOnce({ status: 201, body: { restoreId, pollingSecret: 'c'.repeat(64), expiresAt: iso(900_000), intervalSeconds: 5, comparisonCode: 'A3B4C5' } })
    await f.pay.restore('start', 'payer@example.test')
    f.advance(900_000)
    expect(await f.pay.restore('status')).toEqual({ state: 'expired' })
    expect(await f.pay.hasPending()).toBe(false)
    expect(JSON.stringify(f.stored().journey)).not.toContain('c'.repeat(64))
    expect(f.request.mock.calls.filter(([path]) => path === '/v1/account/restores/poll')).toHaveLength(0)
  })
  it('opens Portal with the current bearer and never sends a customer identifier from settings', async () => {
    const f = fixture()
    f.request.mockResolvedValueOnce({ status: 201, body: credentials }).mockResolvedValueOnce({ status: 200, body: { url: 'https://billing.stripe.com/p/session/local_fixture' } })
    expect(await f.pay.billing('portal')).toEqual({ state: 'idle' })
    expect(f.request).toHaveBeenLastCalledWith('/v1/billing/portal', {}, credentials.token)
    expect(f.open).toHaveBeenCalledWith('https://billing.stripe.com/p/session/local_fixture')
  })
  it('validates hosts for Portal separately', () => {
    expect(validatedStripeUrl('https://checkout.stripe.com/c/pay/cs_test_local#fidkdWxOYHwnPyd1blppbHNgWmR', 'checkout')).toBe('https://checkout.stripe.com/c/pay/cs_test_local#fidkdWxOYHwnPyd1blppbHNgWmR')
    expect(validatedStripeUrl('https://billing.stripe.com/p/session/test', 'portal')).toBe('https://billing.stripe.com/p/session/test')
    expect(validatedStripeUrl('https://checkout.stripe.com/c/pay/test', 'portal')).toBeNull()
    expect(validatedStripeUrl('https://billing.stripe.com/p/session/test#other', 'portal')).toBeNull()
  })
  it.each([{ checkoutEnabled: false }, { environment: 'sandbox' }, { installationAccountsEnabled: false }])('keeps Checkout closed for %j', async changes => {
    const f = fixture(); f.setMembership(changes)
    const result = await f.pay.billing('checkout')
    expect(result.state).toBe(changes.environment ? 'unavailable' : changes.installationAccountsEnabled === false ? 'unavailable' : 'closed')
    expect(f.request.mock.calls.filter(([path]) => path === '/v1/billing/checkout')).toHaveLength(0)
    expect(f.open).not.toHaveBeenCalled()
  })
  it('keeps both billing and restore extension-page-only and rejects authority injection', () => {
    expect(MESSAGE_SENDER_SCOPE.SUPPORTER_BILLING).toBe('extension-page')
    expect(MESSAGE_SENDER_SCOPE.SUPPORTER_RESTORE).toBe('extension-page')
    expect(parseBackgroundRequest({ type: 'SUPPORTER_BILLING', action: 'checkout' })).toEqual({ type: 'SUPPORTER_BILLING', action: 'checkout' })
    expect(parseBackgroundRequest({ type: 'SUPPORTER_RESTORE', action: 'start', email: ' payer@example.test ' })).toEqual({ type: 'SUPPORTER_RESTORE', action: 'start', email: 'payer@example.test' })
    for (const field of ['url', 'token', 'accountId', 'price', 'pollingSecret']) {
      expect(parseBackgroundRequest({ type: 'SUPPORTER_BILLING', action: 'checkout', [field]: 'injected' })).toBeNull()
      expect(parseBackgroundRequest({ type: 'SUPPORTER_RESTORE', action: 'start', email: 'payer@example.test', [field]: 'injected' })).toBeNull()
    }
    expect(parseBackgroundRequest({ type: 'SUPPORTER_RESTORE', action: 'status', email: 'payer@example.test' })).toBeNull()
  })
})
