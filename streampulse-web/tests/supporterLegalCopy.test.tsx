import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentType } from 'react'
import { describe, expect, it } from 'vitest'
import Privacy from '../src/routes/public/Privacy'
import Refunds from '../src/routes/public/Refunds'
import Support from '../src/routes/public/Support'
import Supporter from '../src/routes/public/Supporter'
import Terms from '../src/routes/public/Terms'

/**
 * The public Supporter pages must describe what the backend actually does
 * (audit LG-2, LG-3, LG-5, LG-6). This held launch-day candidate removes the
 * prelaunch wording only after the separate release gates are satisfied.
 */
const pages: Array<[string, ComponentType, string]> = [
  ['Terms', Terms, 'terms-of-use'],
  ['Refunds', Refunds, 'refund-policy'],
  ['Supporter', Supporter, 'supporter-offer'],
  ['Privacy', Privacy, 'privacy-policy'],
]

function textOf(Page: ComponentType, testId: string): string {
  render(<MemoryRouter><Page /></MemoryRouter>)
  return screen.getByTestId(testId).textContent ?? ''
}

describe('Supporter legal copy', () => {
  it.each(pages)('%s has no prelaunch notice in the held launch-day copy', (_, Page, testId) => {
    render(<MemoryRouter><Page /></MemoryRouter>)
    expect(screen.queryByTestId('prelaunch-notice')).toBeNull()
    expect(screen.getByTestId(testId).textContent).not.toMatch(/sign-ups are not open yet|once sign-ups open|once paid sales open/i)
  })

  it.each(pages)('%s makes none of the withdrawn promises', (_, Page, testId) => {
    const body = textOf(Page, testId)
    for (const withdrawn of [
      /including any tax it calculates/i,
      /short grace period/i,
      /existing members/i,
      /existing Supporters/i,
      /suspended or ended/i,
      /unused part of the paid month/i,
      /if it ever ships/i,
      /designed, not shipped/i,
      /designed but not shipped/i,
    ]) expect(body, String(withdrawn)).not.toMatch(withdrawn)
  })

  it('Terms states the USD price, the renewal windows and what refunds and disputes do', () => {
    const body = textOf(Terms, 'terms-of-use')
    expect(body).toContain('US$4.99 per month, charged in US dollars')
    expect(body).toContain('Taxes are handled as stated at checkout')
    expect(body).toMatch(/cancel at any time in the Stripe Customer Portal/)
    expect(body).toMatch(/takes effect at the end of the period you already paid for/)
    expect(body).toMatch(/active for up to 72 hours after the paid period ends/)
    expect(body).toMatch(/7-day grace period/)
    expect(body).toMatch(/A full refund, or a payment dispute that reverses the charge, ends Supporter access for the period/)
    expect(body).toMatch(/A partial refund keeps that access/)
    expect(body).toMatch(/While a dispute is open, access is suspended/)
    expect(body).toMatch(/If StreamPulse ends a Supporter membership, the current month is refunded in full and Supporter access ends/)
    expect(body).toMatch(/no public Twitch chat badge — it is not included/)
  })

  it('Terms preserves the corrected seller details and the approved change-notice period', () => {
    render(<MemoryRouter><Terms /></MemoryRouter>)
    const seller = screen.getByTestId('terms-seller-and-law')
    expect(seller.textContent?.replace(/\s+/g, ' ')).toContain(
      'Aron Chu, 906 N Miller Rd, Unit 3099, Tempe, AZ 85288, USA.',
    )
    expect(seller.textContent).toContain('governed by the law of Arizona, USA')
    expect(screen.getByTestId('terms-of-use').textContent?.replace(/\s+/g, ' ')).toContain(
      'billing email at least 30 days before the change takes effect',
    )
    expect(screen.queryByTestId('terms-pending-owner-input')).toBeNull()
  })

  it('Terms gives the Pulse Supporter section an anchor the extension links to (/terms#supporter)', () => {
    const { container } = render(<MemoryRouter><Terms /></MemoryRouter>)
    const heading = container.querySelector('h2#supporter')
    expect(heading?.textContent).toBe('Pulse Supporter')
  })

  it('Supporter links billing help to the public Stripe portal, privacy mailbox and Supporter terms', () => {
    render(<MemoryRouter><Supporter /></MemoryRouter>)
    const contact = screen.getByRole('link', { name: 'contact us' })
    expect(contact.getAttribute('href')).toBe('mailto:privacy@streampulse.stream')
    expect(screen.getByTestId('supporter-billing-help').contains(contact)).toBe(true)
    const portal = screen.getByRole('link', { name: 'Stripe’s customer portal' })
    expect(portal.getAttribute('href')).toBe('https://billing.stripe.com/p/login/fZueVd91paK85MAgKt8AE00')
    expect(portal.getAttribute('target')).toBe('_blank')
    expect(portal.getAttribute('rel')?.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
    expect(screen.getByTestId('supporter-billing-help').contains(portal)).toBe(true)
    expect(screen.getByRole('link', { name: 'Supporter terms' }).getAttribute('href')).toBe('/terms#supporter')
  })

  it('Refunds matches the backend access rules for refunds, disputes and failed renewals', () => {
    const body = textOf(Refunds, 'refund-policy')
    expect(body).toMatch(/A full refund ends Supporter access for the period that charge paid for/)
    expect(body).toMatch(/A partial refund keeps your access for the rest of that period/)
    expect(body).toMatch(/A membership ended by StreamPulse\. The current month is refunded in full, and Supporter access ends/)
    expect(body).toMatch(/While a dispute is open, Supporter access for the disputed period is suspended while it is under review/)
    expect(body).toMatch(/If the dispute reverses the charge, access for that period ends/)
    expect(body).toMatch(/active for up to 72 hours after the paid period ends/)
    expect(body).toMatch(/7-day grace period/)
    expect(body).toMatch(/self-service in the Stripe Customer Portal/)
    expect(body).toMatch(/Cancelling takes effect at the end of the period you have already paid for/)
  })

  it('Supporter states the USD price, keeps the chat badge excluded and promises nothing more', () => {
    render(<MemoryRouter><Supporter /></MemoryRouter>)
    const terms = screen.getByTestId('supporter-terms').textContent ?? ''
    expect(terms).toContain('US$4.99 per month, charged in US dollars')
    expect(terms).toContain('Handled as stated at checkout')
    expect(terms).toMatch(/7-day grace period/)
    expect(terms).toMatch(/A full refund ends access for that period; a partial refund keeps it/)
    const body = screen.getByTestId('supporter-offer').textContent ?? ''
    expect(body).toMatch(/No public Twitch chat badge\. A chat badge is not included in Supporter/)
    expect(body).not.toMatch(/at no extra cost/i)
    expect(body).toMatch(/active for up to 72 hours after the paid period ends/)
  })

  it('Supporter lists the three perks the extension sells: title paint, the tenure crest and emote rain', () => {
    render(<MemoryRouter><Supporter /></MemoryRouter>)
    const list = screen.getByRole('heading', { name: 'What Supporter includes' }).nextElementSibling!
    const items = [...list.querySelectorAll('li')].map(item => item.textContent ?? '')
    expect(items.some(item => /^Title paint/.test(item))).toBe(true)
    expect(items.some(item => /^Tenure crest/.test(item))).toBe(true)
    expect(items.some(item => /^Emote rain/.test(item))).toBe(true)
    expect(items.join(' ')).not.toMatch(/signature/i)
  })

  it('Supporter keeps the free offer and perk descriptions without claiming a free feature moved', () => {
    render(<MemoryRouter><Supporter /></MemoryRouter>)
    const body = screen.getByTestId('supporter-offer').textContent ?? ''
    expect(body).not.toMatch(/none will be moved|nothing free will move|will never be moved/i)
    expect(body).not.toMatch(/clip downloading/i)
    expect(screen.queryByTestId('supporter-moved')).toBeNull()
    expect(screen.getByRole('heading', { name: 'What stays free' })).toBeTruthy()
    expect(body).not.toMatch(/moved from free|was free up to|backdrop you saved/i)
    expect(body).not.toMatch(/header accent|overlay finishes/i)
  })

  it('Terms keeps the backdrop in the perk list without the removed migration claim', () => {
    const body = textOf(Terms, 'terms-of-use')
    expect(body).toContain('Emote rain: 7TV emotes behind your Pulse panel header, still or falling: the 7TV header backdrop.')
    expect(body).not.toMatch(/moved from free|was free up to|backdrop you saved/i)
    expect(body).not.toMatch(/header accent|overlay finishes|none will be moved/i)
  })

  it.each([...pages.map(([name, Page]) => [name, Page] as const), ['Support', Support] as const])('%s states the owner-confirmed billing response time', (_, Page) => {
    render(<MemoryRouter><Page /></MemoryRouter>)
    const response = screen.getByText(/Aron answers billing, cancellation and refund requests within 7 days\./)
    expect(response.textContent).not.toMatch(/refunds? (completed|resolved|processed) within 7 days/i)
    expect(screen.getAllByRole('link').some(link => link.getAttribute('href') === 'mailto:privacy@streampulse.stream')).toBe(true)
  })

  it('Privacy keeps the privacy mailbox and describes the account cookies on the portal origin', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    expect(screen.getByTestId('privacy-contact').querySelector('a[href="mailto:privacy@streampulse.stream"]')).toBeTruthy()
    const body = screen.getByTestId('privacy-policy').textContent ?? ''
    expect(body).toMatch(/Card details go to Stripe, never to StreamPulse/)
    expect(body).toMatch(/set when you use the account pages on https:\/\/streampulse\.stream/)
    expect(body).not.toMatch(/all set by the StreamPulse API at/)
  })

  it('directs new buyers to a nonpaid extension connection, then a separate offered purchase', () => {
    render(<MemoryRouter><Supporter /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Get the extension' }).getAttribute('href')).toMatch(/^https:\/\/chromewebstore\.google\.com\//)
    expect(screen.getByTestId('supporter-availability').textContent).toMatch(/Choose Become a Supporter.*and pay on Stripe/)
    expect(screen.getByTestId('supporter-availability').textContent).toMatch(/No Twitch sign-in or separate StreamPulse sign-up is needed/)
    expect(screen.queryByRole('link', { name: 'Use a StreamPulse website account' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Open account billing' })).toBeNull()
    expect(screen.getByTestId('supporter-offer').textContent).not.toMatch(/Restore my Supporter|restore link/)
  })
  it.each([['Privacy', Privacy, 'privacy-policy'], ['Terms', Terms, 'terms-of-use']] as const)('%s describes extension connections without requiring a Twitch identity', (_, Page, testId) => {
    const body = textOf(Page, testId)
    expect(body).toMatch(/extension(?:-only)? connections?/i)
    expect(body).toMatch(/without (a Twitch identity|Twitch)/)
    expect(body).not.toMatch(/To buy Supporter you'll sign in with Twitch|Continue with Twitch with the same Twitch account/)
    expect(body).not.toMatch(/does not keep your billing email or a hash of it/)
  })

  it('Privacy says what reaches StreamPulse from Stripe instead of claiming the billing email never does', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    const billing = screen.getByTestId('privacy-billing-email').textContent ?? ''
    expect(billing).toMatch(/Verified payment notifications can send\s+StreamPulse that email, your name and billing address/)
    expect(billing).toMatch(/checks the notification's\s+signature and removes contact details before saving the new payment notification/)
    expect(billing).toMatch(/keyed, one-way hash of the billing email as a recovery\s+lookup, rather than the address itself/)
    expect(billing).toMatch(/does not automatically combine accounts\s+or grant Supporter access/)
    expect(billing).toMatch(/refreshes the hash using your current Stripe billing email and checks that email again/)
    expect(screen.getByTestId('privacy-installation-account').textContent).toMatch(/Looking at your status does not create a connection/)
    expect(screen.getByTestId('privacy-installation-account').textContent).toMatch(/does not sync My Moments: bookmarks, notes and watched history stay in this browser/)
    const twitch = screen.getByTestId('privacy-continue-with-twitch').textContent ?? ''
    expect(twitch).toMatch(/keyed hash of your Twitch user ID/)
    expect(twitch).toMatch(/never receives your Twitch password, Twitch email or a\s+Twitch access token/)
  })

  it('Terms preserves billing management without promising automatic connection recovery', () => {
    render(<MemoryRouter><Terms /></MemoryRouter>)
    const billing = screen.getByTestId('terms-billing-email').textContent ?? ''
    expect(billing).toMatch(/reinstalling or using another browser does not\s+restore it automatically/)
    expect(billing).toMatch(/your extension offers Restore existing Supporter/)
    expect(billing).toMatch(/manage billing\s+through Stripe with your current billing email/)
    expect(billing).toMatch(/Billing changes\s+do not move Supporter to another account/)
    expect(screen.getByTestId('terms-your-account').textContent).toMatch(/private credentials saved in your browser profile/)
    expect(screen.getByRole('link', { name: "Stripe's billing-email portal" }).getAttribute('href')).toMatch(/^https:\/\/billing\.stripe\.com\/p\/login\//)
  })

  it('Privacy says where Twitch display details are kept on the website and in the extension', () => {
    const body = textOf(Privacy, 'privacy-policy')
    expect(body).toMatch(/not stored on StreamPulse's servers\. On the website, only that\s+browser tab keeps them; in the extension, they're kept for the current browser session/)
    expect(body).toMatch(/Extension session storage \(storage\.session\) — short-lived Pulse and coverage caches for the current\s+browser session and, after the extension signs in with Twitch, your Twitch display name\s+and picture/)
  })

  // Sign-in is unavailable in this release, so this release never runs the silent first-install
  // check and the policy doesn't describe it. Sign-in is still stated conditionally.
  it('Privacy leaves out the first-install Twitch check that this release does not run', () => {
    const body = textOf(Privacy, 'privacy-policy')
    expect(body).not.toMatch(/Twitch sign-in only if you choose/)
    expect(screen.queryByTestId('privacy-extension-first-install')).toBeNull()
    expect(body).not.toMatch(/fresh install/)
    expect(body).toMatch(/Extension Twitch sign-in is not available in this release\. When available, the extension uses Twitch sign-in only to confirm your Twitch\s+user ID, when you choose Continue with Twitch\./)
    expect(body).toMatch(/sent only when you choose\s+Continue with Twitch, not available in this release\)/)
    const twitch = screen.getByTestId('privacy-third-party-twitch').textContent ?? ''
    expect(twitch).toMatch(/only when you choose Continue with Twitch, Twitch's sign-in service/)
  })

  it('Privacy describes the server-side extension record and Twitch’s disconnect notification', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    const extensions = screen.getByTestId('privacy-extensions').textContent ?? ''
    expect(extensions).toMatch(/a device label, connection time, hashed credentials and\s+their expiry/)
    expect(extensions).toMatch(/Connection records remain\s+after access ends; revocation is not account deletion/)
    expect(screen.getByTestId('privacy-policy').textContent).toMatch(/An extension-only account has no account email address/)
    expect(screen.getByTestId('privacy-policy').textContent).not.toMatch(/email the address below from the account's own address|sessions and device links are revoked and the account record is removed/)
    const twitch = screen.getByTestId('privacy-third-party-twitch').textContent ?? ''
    expect(twitch).toMatch(/If you disconnect StreamPulse in your Twitch settings, Twitch sends\s+StreamPulse a notification with your Twitch user ID/)
    expect(twitch).toMatch(/only to sign\s+that account out everywhere and does not store/)
  })

  it('Refunds accepts requests after loss of the current billing email without asking for card secrets', () => {
    const body = textOf(Refunds, 'refund-policy')
    expect(body).not.toMatch(/address on the account/)
    expect(body).toMatch(/If possible, use\s+your current Stripe billing email/)
    expect(body).toMatch(/If you cannot access it, contact us anyway/)
    expect(body).not.toMatch(/from the billing\s+email you gave Stripe at checkout/)
    expect(body).toMatch(/do not include your full card number\s+or security code/)
  })
})
