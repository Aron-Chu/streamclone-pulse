import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ErrorEvent } from '@sentry/react'
const sentrySdk = vi.hoisted(() => ({ captureMessage: vi.fn() }))
vi.mock('@sentry/react', async importOriginal => ({ ...(await importOriginal<typeof import('@sentry/react')>()), captureMessage: sentrySdk.captureMessage }))

import {
  ACCOUNT_ISSUE_MESSAGE,
  accountSurfaceFor,
  captureAccountIssue,
  isSecretBearingRoute,
  resetAccountIssuesForTests,
  sanitizePortalPath,
  scrubPortalEvent,
} from '../src/lib/sentry'

const ATTEMPT = '12345678-1234-4234-8234-123456789abc'
const JWT = ['eyJhbGciOiJSUzI1NiJ9', 'eyJzdWIiOiJQUklWQVRFIn0', 'c2ln'].join('.')
const ACCOUNT_ROUTES = ['/account/billing', '/account/billing/return', '/account/settings', '/account/sign-in', '/account/moments', '/supporter/thanks']
const SECRET_ROUTES = ['/account/twitch/callback', '/account/confirm', '/account/link-device', '/account/restore', '/account', '/account/anything-new']
/** Nothing that names a person, an account or a payment may leave the page. */
const FORBIDDEN = [/[0-9a-f]{8}-[0-9a-f]{4}-/i, /@/, /eyJ/, /\b(?:cs|cus|sub|pi|in)_[A-Za-z0-9]/, /__Host-/, /StreamerName/, /\?/, /intent=/, /attempt=/]

afterEach(() => {
  window.history.replaceState(null, '', '/')
  sessionStorage.clear()
  resetAccountIssuesForTests()
  sentrySdk.captureMessage.mockReset()
})

describe('Sentry on account pages (Supporter launch spec 2026-10-10 §5.5)', () => {
  it('runs on account and billing pages, never on a secret-bearing one', () => {
    for (const path of ACCOUNT_ROUTES) expect(isSecretBearingRoute(path)).toBe(false)
    for (const path of SECRET_ROUTES) expect(isSecretBearingRoute(path)).toBe(true)
    for (const path of ['/', '/supporter', '/terms', '/analytics/x']) expect(isSecretBearingRoute(path)).toBe(false)
    expect(accountSurfaceFor('/account/billing/return?attempt=x')).toBe('billing_return')
    expect(accountSurfaceFor('/supporter')).toBeUndefined()
  })

  it('initialises outside secret-bearing pages only (main.tsx)', () => {
    const main = readFileSync(resolve(import.meta.dirname, '../src/main.tsx'), 'utf8')
    expect(main).toMatch(/if \(!isSecretBearingRoute\(window\.location\.pathname\)\) initPortalSentry\(\)/)
    expect(main).not.toMatch(/\b(?:setUser|setContext|setExtra)\(/)
    for (const file of ['lib/sentry.ts', 'lib/supporterOffer.ts', 'routes/account/BillingPage.tsx', 'routes/public/BecomeSupporterButton.tsx']) {
      expect(readFileSync(resolve(import.meta.dirname, '../src', file), 'utf8')).not.toMatch(/\b(?:setUser|setContext|setExtra)\(/)
    }
  })

  it('drops every event while the current page is secret-bearing, including after SPA navigation', () => {
    for (const path of SECRET_ROUTES) {
      window.history.replaceState(null, '', path)
      expect(scrubPortalEvent({ type: undefined, message: 'Failed to fetch' })).toBeNull()
    }
  })

  it('names only the page: no query, attempt, intent, identity, token or email in the envelope', () => {
    sessionStorage.setItem('pulse.account.twitchIdentity.v1', JSON.stringify({ session: 'x', displayName: 'StreamerName', avatarUrl: 'https://static-cdn.jtvnw.net/a.png' }))
    document.body.innerHTML = '<p>buyer@example.com</p>'
    for (const route of ACCOUNT_ROUTES) {
      const href = `${route}?attempt=${ATTEMPT}&intent=subscribe#id_token=${JWT}`
      window.history.replaceState(null, '', href)
      const event = {
        type: undefined,
        message: `Checkout ${ATTEMPT} failed for buyer@example.com cus_PRIVATE ${JWT}`,
        transaction: href,
        user: { id: ATTEMPT, email: 'buyer@example.com' },
        request: { url: `https://streampulse.stream${href}`, headers: { Cookie: '__Host-pulse_session=PRIVATE' } },
        contexts: { account: { id: ATTEMPT } },
        extra: { displayName: 'StreamerName' },
        breadcrumbs: [{ category: 'navigation', data: { to: href } }, { category: 'fetch', data: { url: `/v1/billing/checkout/${ATTEMPT}` } }],
        tags: { route: href, error_code: 'checkout_open_failed', account_surface: accountSurfaceFor(route), customer: 'cus_PRIVATE', error_type: `sub_${ATTEMPT}` },
        exception: { values: [{ type: 'Error', value: `pi_PRIVATE ${JWT}`, stacktrace: { frames: [{ filename: `https://streampulse.stream/assets/main.js?attempt=${ATTEMPT}`, lineno: 3, colno: 9 }] } }] },
      } as unknown as ErrorEvent
      const clean = scrubPortalEvent(event)!
      const envelope = JSON.stringify(clean)
      for (const pattern of FORBIDDEN) expect(envelope, `${route}: ${pattern}`).not.toMatch(pattern)
      expect(clean.tags?.route).toBe(route)
      expect(clean.tags?.error_code).toBe('checkout_open_failed')
      expect(clean.tags?.account_surface).toBe(accountSurfaceFor(route))
      expect(clean.transaction).toBe(route)
      expect(clean.message).toBe('Diagnostic text omitted')
      expect(Object.keys(clean)).not.toEqual(expect.arrayContaining(['user']))
      for (const key of ['user', 'request', 'contexts', 'extra', 'breadcrumbs']) expect(clean).not.toHaveProperty(key)
    }
  })

  it('keeps only enum values for error_code and account_surface', () => {
    window.history.replaceState(null, '', '/account/billing')
    const clean = scrubPortalEvent({ type: undefined, tags: { error_code: 'buyer@example.com', account_surface: 'billing/../x' } } as unknown as ErrorEvent)!
    expect(clean.tags).not.toHaveProperty('error_code')
    expect(clean.tags).not.toHaveProperty('account_surface')
  })

  it('reports an account issue once per code per page load, with only the fixed message and tags', () => {
    window.history.replaceState(null, '', `/account/billing/return?attempt=${ATTEMPT}`)
    const capture = sentrySdk.captureMessage
    captureAccountIssue('checkout_confirm_slow')
    captureAccountIssue('checkout_confirm_slow')
    captureAccountIssue('billing_read_failed')
    expect(capture).toHaveBeenCalledTimes(2)
    expect(capture.mock.calls[0]).toEqual([ACCOUNT_ISSUE_MESSAGE, { level: 'warning', tags: { error_code: 'checkout_confirm_slow', account_surface: 'billing_return' } }])
    // The fixed message survives the text scrubber verbatim; nothing else does.
    expect(scrubPortalEvent({ type: undefined, message: ACCOUNT_ISSUE_MESSAGE })!.message).toBe(ACCOUNT_ISSUE_MESSAGE)
  })

  it('names Supporter and account pages in the route allowlist, and nothing else new', () => {
    for (const path of ['/supporter', '/supporter/thanks', '/terms', '/refunds', ...ACCOUNT_ROUTES]) expect(sanitizePortalPath(`${path}?attempt=${ATTEMPT}`)).toBe(path)
    for (const path of SECRET_ROUTES) expect(sanitizePortalPath(path)).toBe('/:unknown')
  })
})
