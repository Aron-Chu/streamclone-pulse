// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { accountRequest, billingRequest } from '../src/lib/accountApi'
afterEach(() => vi.unstubAllGlobals())
it.each(['../portal', '../../account/auth/logout', '%2e%2e/portal', 'id?next=/portal', 'id#fragment', 'https://evil.example', '123e4567-e89b-12d3-a456-426614174000\n'])('rejects untrusted checkout ID %s before fetch', async (id) => {
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
