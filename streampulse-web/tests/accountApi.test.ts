// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { ACCOUNT_REQUEST_TIMEOUT_MS, BILLING_POST_TIMEOUT_MS, accountRequest, billingRequest } from '../src/lib/accountApi'

afterEach(() => vi.unstubAllGlobals())

it.each(['../portal', '../../account/auth/logout', '%2e%2e/portal', 'id?next=/portal', 'id#fragment', 'https://evil.example', '123e4567-e89b-12d3-a456-426614174000\n'])('rejects untrusted checkout ID %s before fetch', async id => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await expect(billingRequest(`/checkout/${id}`)).rejects.toMatchObject({ status: 400 })
  expect(fetch).not.toHaveBeenCalled()
})

it('allows checkout and pagination identifiers without changing the endpoint', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
  vi.stubGlobal('fetch', fetch)
  const id = '123e4567-e89b-12d3-a456-426614174000'
  await billingRequest(`/checkout/${id}`)
  await accountRequest(`/devices?cursor=${id}`)
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([`/v1/billing/checkout/${id}`, `/v1/account/devices?cursor=${id}`])
})

it('rejects extra query parameters in pagination', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await expect(accountRequest('/devices?cursor=123e4567-e89b-12d3-a456-426614174000&other=1')).rejects.toMatchObject({ status: 400 })
  expect(fetch).not.toHaveBeenCalled()
})

it('gives only the checkout and portal POSTs the long billing timeout', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
  vi.stubGlobal('fetch', fetch)
  const timeout = vi.spyOn(AbortSignal, 'timeout')
  try {
    const id = '123e4567-e89b-12d3-a456-426614174000'
    await billingRequest('/checkout', {})
    await billingRequest('/portal', {})
    await billingRequest('/supporter')
    await billingRequest(`/checkout/${id}`)
    await accountRequest('/auth/start', { email: 'fixture@example.invalid' })
    await accountRequest('/me')
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([
      BILLING_POST_TIMEOUT_MS, BILLING_POST_TIMEOUT_MS,
      ACCOUNT_REQUEST_TIMEOUT_MS, ACCOUNT_REQUEST_TIMEOUT_MS, ACCOUNT_REQUEST_TIMEOUT_MS, ACCOUNT_REQUEST_TIMEOUT_MS,
    ])
    expect([BILLING_POST_TIMEOUT_MS, ACCOUNT_REQUEST_TIMEOUT_MS]).toEqual([35_000, 12_000])
  } finally {
    timeout.mockRestore()
  }
})

it('carries a bounded Retry-After and a well-formed attempt ID on errors', async () => {
  const attempt = '123e4567-e89b-42d3-a456-426614174000'
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'try_later' }), { status: 429, headers: { 'Retry-After': '20' } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'checkout_pending', attemptId: attempt }), { status: 409 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'checkout_pending', attemptId: '../portal' }), { status: 409, headers: { 'Retry-After': '99999' } }))
  vi.stubGlobal('fetch', fetch)
  await expect(billingRequest('/supporter')).rejects.toMatchObject({ status: 429, code: 'try_later', retryAfterSeconds: 20 })
  await expect(billingRequest('/checkout', {})).rejects.toMatchObject({ status: 409, code: 'checkout_pending', attemptId: attempt })
  const error = await billingRequest('/checkout', {}).catch(value => value)
  expect(error.attemptId).toBeUndefined()
  // A Checkout or portal session budget can be daily (backend #162): bounded at a day.
  expect(error.retryAfterSeconds).toBe(86_400)
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'try_later' }), { status: 429, headers: { 'Retry-After': '99999' } }))
  await expect(billingRequest('/supporter')).rejects.toMatchObject({ status: 429, retryAfterSeconds: 900 })
})
