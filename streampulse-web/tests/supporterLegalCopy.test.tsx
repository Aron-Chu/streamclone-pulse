import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ComponentType } from 'react'
import { describe, expect, it } from 'vitest'
import Privacy from '../src/routes/public/Privacy'
import Refunds from '../src/routes/public/Refunds'
import Supporter from '../src/routes/public/Supporter'
import Terms from '../src/routes/public/Terms'

/**
 * The public Supporter pages must describe what the backend actually does
 * (audit LG-2, LG-3, LG-5, LG-6), and say plainly that paid sign-ups are closed.
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
  it.each(pages)('%s states that Supporter sign-ups are not open yet', (_, Page, testId) => {
    render(<MemoryRouter><Page /></MemoryRouter>)
    const notice = screen.getByTestId('prelaunch-notice')
    expect(notice.textContent).toMatch(/^Supporter sign-ups are not open yet\./)
    expect(screen.getByTestId(testId).contains(notice)).toBe(true)
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

  it('Terms keeps the selling entity, address and law visibly pending owner input', () => {
    render(<MemoryRouter><Terms /></MemoryRouter>)
    const pending = screen.getByTestId('terms-pending-owner-input')
    for (const label of ['Selling entity', 'Legal address', 'Governing law', 'Consumer cancellation rights']) {
      expect(pending.textContent).toContain(label)
    }
    expect(pending.textContent?.match(/Pending — not yet stated\./g)).toHaveLength(4)
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

  it('Supporter says plainly that the 7TV header backdrop moved to Supporter, and no longer promises that nothing free will move', () => {
    render(<MemoryRouter><Supporter /></MemoryRouter>)
    const body = screen.getByTestId('supporter-offer').textContent ?? ''
    expect(body).not.toMatch(/none will be moved|nothing free will move|will never be moved/i)
    expect(body).not.toMatch(/clip downloading/i)
    expect(screen.getByTestId('supporter-moved').textContent).toBe('Emote rain, the 7TV header backdrop, was free up to extension 0.2.1. From 0.2.2 it is a Supporter perk, and a backdrop you saved is kept for when you support. No other free feature moved behind Supporter.')
    expect(body).not.toMatch(/header accent|overlay finishes/i)
  })

  it('Terms names the moved backdrop and no withdrawn perk names', () => {
    const body = textOf(Terms, 'terms-of-use')
    expect(body).toContain('From 0.2.2 it is a Supporter perk')
    expect(body).not.toMatch(/header accent|overlay finishes|none will be moved/i)
  })

  it('Privacy keeps the privacy mailbox and describes the account cookies on the portal origin', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    expect(screen.getByTestId('privacy-contact').querySelector('a[href="mailto:privacy@streampulse.stream"]')).toBeTruthy()
    const body = screen.getByTestId('privacy-policy').textContent ?? ''
    expect(body).toMatch(/Supporter sign-ups are not open yet; card details go to Stripe, never to StreamPulse/)
    expect(body).toMatch(/set when you use the account pages on https:\/\/streampulse\.stream/)
    expect(body).not.toMatch(/all set by the StreamPulse API at/)
  })

  it('directs new buyers to the extension and Continue with Twitch, with no competing account choice', () => {
    render(<MemoryRouter><Supporter /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Get the extension' }).getAttribute('href')).toMatch(/^https:\/\/chromewebstore\.google\.com\//)
    expect(screen.getByTestId('supporter-availability').textContent).toMatch(/you’ll choose Continue with Twitch, then pay on Stripe/)
    expect(screen.queryByRole('link', { name: 'Use a StreamPulse website account' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'Open account billing' })).toBeNull()
    expect(screen.getByTestId('supporter-offer').textContent).not.toMatch(/Restore my Supporter|restore link/)
  })
  it.each([['Privacy', Privacy, 'privacy-policy'], ['Terms', Terms, 'terms-of-use']] as const)('%s leaves the billing email with Stripe and describes no email restore or installation account', (_, Page, testId) => {
    const body = textOf(Page, testId)
    expect(body).not.toMatch(/keyed hash of (your|that) (checkout )?email/i)
    expect(body).not.toMatch(/membership recovery|recovery link|restore link|installation account/i)
    expect(body).toMatch(/Continue with Twitch/)
  })

  it('Privacy says what reaches StreamPulse from Stripe instead of claiming the billing email never does', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    const billing = screen.getByTestId('privacy-billing-email').textContent ?? ''
    expect(billing).toMatch(/payment notifications to StreamPulse\s+can include that email, your name and billing address/)
    expect(billing).toMatch(/removes those details before saving it/)
    expect(billing).toMatch(/never matches accounts by email/)
    // Stripping customer_* fields (backend #162) and the inbox prune (#150) are not
    // on backend master yet, so this handling is stated for when sign-ups open.
    expect(billing).toMatch(/Once sign-ups open, StreamPulse\s+checks each notification's signature/)
    const twitch = screen.getByTestId('privacy-continue-with-twitch').textContent ?? ''
    expect(twitch).toMatch(/keyed hash of your Twitch user ID/)
    expect(twitch).toMatch(/never receives your Twitch password, Twitch email or a\s+Twitch access token/)
  })

  it('Terms separates losing Twitch access from cancelling billing in Stripe', () => {
    render(<MemoryRouter><Terms /></MemoryRouter>)
    const billing = screen.getByTestId('terms-billing-email').textContent ?? ''
    expect(billing).toMatch(/you can still cancel billing through Stripe/)
    expect(billing).toMatch(/moving a\s+membership to another account needs our help/)
    // Continue with Twitch is not live yet, so the account model is stated conditionally.
    expect(screen.getByTestId('terms-your-account').textContent).toMatch(/^\s*Once Continue with Twitch is open, your StreamPulse account is your Twitch identity/)
  })

  it('Privacy says where Twitch display details are kept on the website and in the extension', () => {
    const body = textOf(Privacy, 'privacy-policy')
    expect(body).toMatch(/not stored on StreamPulse's servers\. On the website, only that\s+browser tab keeps them; in the extension, they're kept for the current browser session/)
    expect(body).toMatch(/chrome\.storage\.session — short-lived Pulse and coverage caches for the current\s+browser session and, after the extension signs in with Twitch, your Twitch display name\s+and picture/)
  })

  // The extension's tester and public builds try one silent Twitch sign-in on a
  // true first install, with no click (src/options/SupporterJourney.tsx and
  // src/background/twitchSignIn.ts). Privacy must not say a Twitch proof is sent
  // only after a click.
  it('Privacy discloses the extension’s one silent check after a fresh install', () => {
    const body = textOf(Privacy, 'privacy-policy')
    expect(body).not.toMatch(/Twitch sign-in only if you choose/)
    expect(body).not.toMatch(/sent only when you choose\s+Continue with Twitch\)/)
    expect(body).toMatch(/one check without a window after a\s+fresh install, which can only sign you back in/)
    const check = screen.getByTestId('privacy-extension-first-install').textContent ?? ''
    expect(check).toMatch(/checks once with\s+Twitch, without opening a window/)
    expect(check).toMatch(/This check never creates an account,\s+and it doesn't run again after you sign out/)
    expect(body).toMatch(/sent only when you choose\s+Continue with Twitch or during the one check after a fresh install/)
  })

  it('Privacy describes the server-side extension record and Twitch’s disconnect notification', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    const extensions = screen.getByTestId('privacy-extensions').textContent ?? ''
    expect(extensions).toMatch(/a label naming the store, the browser family and the sign-in time, plus hashed credentials\s+and their expiry/)
    expect(extensions).toMatch(/A signed-out or expired\s+extension stays on that record, without access, until the account is deleted/)
    const twitch = screen.getByTestId('privacy-third-party-twitch').textContent ?? ''
    expect(twitch).toMatch(/If you disconnect StreamPulse in your Twitch settings, Twitch sends\s+StreamPulse a notification with your Twitch user ID/)
    expect(twitch).toMatch(/only to sign\s+that account out everywhere and does not store/)
  })

  it('Refunds asks for requests from the billing email given to Stripe, not an account address', () => {
    const body = textOf(Refunds, 'refund-policy')
    expect(body).not.toMatch(/address on the account/)
    expect(body.match(/from the billing\s+email you gave Stripe at checkout/g)).toHaveLength(2)
  })
})
