import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  accountBillingReturnFromSearch,
  accountBillingReturnPath,
  accountBillingSignInHref,
  consumeAccountBillingReturn,
  readAccountBillingReturn,
  rememberAccountBillingReturn,
} from '../src/lib/accountBillingReturn'

const attempt = '12345678-1234-4234-8234-123456789abc'
const returnPath = `/account/billing/return?attempt=${attempt}`
const storageKey = 'pulse.account.billingReturn.v1'

afterEach(() => vi.useRealTimers())

describe('allowlisted account billing return', () => {
  it.each(['/account/billing', '/account/billing/return', returnPath, `${returnPath}&cancelled=1`])('preserves %s', path => {
    expect(accountBillingReturnPath(path)).toBe(path)
    const href = accountBillingSignInHref(path)
    expect(href.startsWith('/account/sign-in?')).toBe(true)
    expect(accountBillingReturnFromSearch(href.slice(href.indexOf('?')))).toBe(path)
  })

  it('normalizes and retains a cancelled checkout hint through storage', () => {
    const path = `/account/billing/return?cancelled=1&attempt=${attempt}`
    expect(accountBillingReturnPath(path)).toBe(`${returnPath}&cancelled=1`)
    rememberAccountBillingReturn(path)
    expect(consumeAccountBillingReturn()).toBe(`${returnPath}&cancelled=1`)
  })

  it.each([
    undefined,
    '',
    'https://evil.test/account/billing',
    'https://streampulse.stream/account/billing',
    '//evil.test/account/billing',
    '/\\evil.test/account/billing',
    'javascript:alert(1)',
    '/account/settings',
    '/account/billing/../settings',
    '/account/billing/%2e%2e/settings',
    '/account/billing?next=https://evil.test',
    '/account/billing#secret',
    '/account/billing/return?success=true',
    '/account/billing/return?attempt=------------------------------------',
    `/account/billing/return?attempt=${attempt}&attempt=${attempt}`,
    `/account/billing/return?attempt=${attempt}&redirect=https://evil.test`,
    '/account/billing/return?cancelled=1',
    `/account/billing/return?attempt=${attempt}&cancelled=0`,
    `/account/billing/return?attempt=${attempt}&cancelled=true`,
    `/account/billing/return?attempt=${attempt}&cancelled=1&cancelled=1`,
    `/account/billing/return?attempt=${attempt}&cancelled=1&next=https://evil.test`,
    `/account/billing/return?attempt=${attempt}#fragment`,
    `/account/billing/return?attempt=${'a'.repeat(300)}`,
  ])('rejects unsupported destination %s', value => {
    expect(accountBillingReturnPath(value)).toBeNull()
    expect(accountBillingSignInHref(value)).toBe('/account/sign-in')
  })

  it('rejects duplicate returnTo values and missing destinations', () => {
    expect(accountBillingReturnFromSearch('?returnTo=%2Faccount%2Fbilling&returnTo=%2Faccount%2Fbilling')).toBeNull()
    expect(accountBillingReturnFromSearch('')).toBeNull()
  })

  it('persists only a short-lived navigation hint and consumes it once', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    rememberAccountBillingReturn(returnPath)
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({ path: returnPath, expiresAt: 1_900_000 })
    expect(readAccountBillingReturn()).toBe(returnPath)
    expect(consumeAccountBillingReturn()).toBe(returnPath)
    expect(readAccountBillingReturn()).toBeNull()
  })

  it('expires after the email-link lifetime without extending on read', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    rememberAccountBillingReturn(returnPath)
    now.mockReturnValue(1_899_999)
    expect(readAccountBillingReturn()).toBe(returnPath)
    now.mockReturnValue(1_900_000)
    expect(readAccountBillingReturn()).toBeNull()
    expect(localStorage.getItem(storageKey)).toBeNull()
  })

  it.each([
    'not json',
    'null',
    JSON.stringify({ path: 'https://evil.test', expiresAt: 1_900_000 }),
    JSON.stringify({ path: returnPath, expiresAt: '1900000' }),
    JSON.stringify({ path: returnPath, expiresAt: 2_000_000 }),
  ])('discards malformed or excessive stored context %s', value => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    localStorage.setItem(storageKey, value)
    expect(readAccountBillingReturn()).toBeNull()
    expect(localStorage.getItem(storageKey)).toBeNull()
  })

  it('clears an older hint when starting a standard sign-in', () => {
    rememberAccountBillingReturn(returnPath)
    rememberAccountBillingReturn(null)
    expect(readAccountBillingReturn()).toBeNull()
  })

  it('keeps sign-in available when browser storage is denied', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => rememberAccountBillingReturn(returnPath)).not.toThrow()
    expect(consumeAccountBillingReturn()).toBeNull()
  })
})
