import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Supporter from '../src/routes/public/Supporter'
import { stripePortalLoginUrl } from '../src/lib/accountStripePortalLogin'

/**
 * Optional Stripe customer-portal login link (spec P2.6). Without a valid one the
 * lost-Twitch sentence stays plain text; an empty or foreign link never renders.
 */
vi.mock('../src/ui/components/PublicLayout', () => ({ PublicLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

afterEach(() => { vi.unstubAllEnvs() })

const LOST_TWITCH = 'Lost access to your Twitch account? You can still cancel or update billing in Stripe’s customer portal with the email you paid with. That changes billing only. It doesn’t move your membership to another Twitch account; contact us and we’ll help.'

describe('stripePortalLoginUrl', () => {
  it('accepts only an https billing.stripe.com /p/login/ address', () => {
    expect(stripePortalLoginUrl('https://billing.stripe.com/p/login/test_abc123')).toBe('https://billing.stripe.com/p/login/test_abc123')
    expect(stripePortalLoginUrl('  https://billing.stripe.com/p/login/aBc_9  ')).toBe('https://billing.stripe.com/p/login/aBc_9')
    for (const bad of [
      undefined, null, 42, '', '   ',
      'http://billing.stripe.com/p/login/abc',
      'https://checkout.stripe.com/p/login/abc',
      'https://billing.stripe.com.example.com/p/login/abc',
      'https://evil.example/p/login/abc',
      'https://user:pw@billing.stripe.com/p/login/abc',
      'https://billing.stripe.com:444/p/login/abc',
      'https://billing.stripe.com/p/login/',
      'https://billing.stripe.com/p/session/abc',
      'https://billing.stripe.com/p/login/abc?prefilled_email=a%40b.c',
      'https://billing.stripe.com/p/login/abc#x',
      'javascript:alert(1)',
    ]) expect(stripePortalLoginUrl(bad)).toBeNull()
  })
})

describe('/supporter lost-Twitch sentence', () => {
  it('stays plain text when VITE_STRIPE_PORTAL_LOGIN_URL is unset', () => {
    vi.stubEnv('VITE_STRIPE_PORTAL_LOGIN_URL', '')
    render(<MemoryRouter><Supporter /></MemoryRouter>)
    const sentence = screen.getByTestId('supporter-lost-twitch')
    expect(sentence.textContent?.replace(/\s+/g, ' ').trim()).toBe(LOST_TWITCH)
    expect(sentence.querySelector('a')).toBeNull()
  })

  it('stays plain text for an address that is not a Stripe portal login', () => {
    vi.stubEnv('VITE_STRIPE_PORTAL_LOGIN_URL', 'https://example.com/p/login/abc')
    render(<MemoryRouter><Supporter /></MemoryRouter>)
    expect(screen.getByTestId('supporter-lost-twitch').querySelector('a')).toBeNull()
  })

  it('links the Stripe portal login when a valid one is configured, with the same words', () => {
    vi.stubEnv('VITE_STRIPE_PORTAL_LOGIN_URL', 'https://billing.stripe.com/p/login/test_abc123')
    render(<MemoryRouter><Supporter /></MemoryRouter>)
    const sentence = screen.getByTestId('supporter-lost-twitch')
    expect(sentence.textContent?.replace(/\s+/g, ' ').trim()).toBe(LOST_TWITCH)
    const link = screen.getByTestId('supporter-stripe-portal-login')
    expect(link.getAttribute('href')).toBe('https://billing.stripe.com/p/login/test_abc123')
    expect(link.textContent).toBe('Stripe’s customer portal')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })
})
