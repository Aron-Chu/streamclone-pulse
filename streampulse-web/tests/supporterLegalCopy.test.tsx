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
  it.each(pages)('%s states that paid sign-ups are not open yet', (_, Page, testId) => {
    render(<MemoryRouter><Page /></MemoryRouter>)
    const notice = screen.getByTestId('prelaunch-notice')
    expect(notice.textContent).toMatch(/^Paid sign-ups are not open yet\./)
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

  it('Privacy keeps the privacy mailbox and describes the account cookies on the portal origin', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    expect(screen.getByTestId('privacy-contact').querySelector('a[href="mailto:privacy@streampulse.stream"]')).toBeTruthy()
    const body = screen.getByTestId('privacy-policy').textContent ?? ''
    expect(body).toMatch(/paid Supporter sign-ups are not open yet/)
    expect(body).toMatch(/set when you use the account pages on https:\/\/streampulse\.stream/)
    expect(body).not.toMatch(/all set by the StreamPulse API at/)
  })
})
