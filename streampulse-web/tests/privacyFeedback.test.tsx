import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import Privacy from '../src/routes/public/Privacy'

/**
 * The /feedback form links "How we handle it" to /privacy, so the policy must
 * describe the form's real processing (streampulse-backend support outbox and
 * Turnstile, website FeedbackForm) and promise no retention period the backend
 * does not enforce: PULSE_SUPPORT_RETENTION_ENABLED is off by default.
 */
function section(testId: string): string {
  return screen.getByTestId(testId).textContent ?? ''
}

describe('Privacy: feedback form', () => {
  it('has a Feedback form section that the form can link to', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    const block = screen.getByTestId('privacy-feedback')
    expect(screen.getByTestId('privacy-policy').contains(block)).toBe(true)
    expect(screen.getByRole('heading', { level: 2, name: 'Feedback form' }).id).toBe('feedback-form')
  })

  it('lists what the website sends, with the reply email only alongside its consent', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    const sent = section('privacy-feedback-sent')
    expect(sent).toMatch(/needs no account/)
    expect(sent).toMatch(/kind of feedback you picked, your message, a subject line taken from the start of the\s+message/)
    expect(sent).toMatch(/I consent to submitting this text to StreamPulse support/)
    expect(sent).toMatch(/sent only together with your\s+tick on “I consent to being contacted at this email about this report”/)
    expect(sent).toMatch(/attaches no diagnostics, page address or browser\s+details/)
    expect(sent).toMatch(/copies a summary to your clipboard and\s+sends nothing/)
  })

  it('names what is stored, including the delivery copy, and that the IP address is not stored', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    const stored = section('privacy-feedback-stored')
    expect(stored).toMatch(/the reply email if\s+you gave one, whether each consent box was ticked/)
    expect(stored).toMatch(/stays there after the email is sent/)
    expect(stored).toMatch(/failed-delivery record/)
    expect(stored).toMatch(/Your IP address is not stored with the case/)
    const delivery = section('privacy-feedback-delivery')
    expect(delivery).toMatch(/private support inbox/)
    expect(delivery).toMatch(/reply-to address/)
    expect(delivery).toMatch(/Nothing sent through the form is posted publicly/)
  })

  it('describes the Turnstile check and lists Cloudflare as a recipient', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    const check = section('privacy-feedback-turnstile')
    expect(check).toMatch(/Cloudflare Turnstile/)
    expect(check).toMatch(/processes your IP address and signals from your browser/)
    expect(check).toMatch(/never logs or stores/)
    expect(section('privacy-third-party-turnstile')).toMatch(/only on the feedback\s+form/)
    expect(section('privacy-feedback-logs')).toMatch(/never your message,\s+your email or the Turnstile token/)
  })

  it('says the staff Discord channel gets the message text and a short reference, never the email', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    const delivery = section('privacy-feedback-delivery')
    expect(delivery).toMatch(/When enabled, the message text and a short reference \(never your\s+email\) are also posted to a private staff-only Discord channel\./)
    expect(delivery).toMatch(/Nothing sent through\s+the form is posted publicly/)
    const discord = section('privacy-third-party-discord')
    expect(discord).toMatch(/Discord \(feedback form only, when enabled\)/)
    expect(discord).toMatch(/private staff-only Discord channel/)
    expect(discord).toMatch(/Your email is\s+never posted there/)
    expect(section('privacy-feedback-retention')).toMatch(/any staff Discord post are kept until the team\s+deletes them/)
    expect(section('privacy-feedback-deletion')).toMatch(/any staff Discord post/)
  })

  it('names Sentry, what it receives, that account pages have it off and that IP addresses are not stored', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    const sentry = section('privacy-third-party-sentry')
    expect(sentry).toMatch(/Sentry \(website error monitoring\)/)
    expect(sentry).toMatch(/error\s+report: the kind of error, where in the site's code it happened, the site\s+version and the page route/)
    expect(sentry).toMatch(/Account pages have it off\./)
    expect(sentry).toMatch(/Your IP address is seen by Sentry\s+while a report is sent, as with any web request, and is not stored\./)
    expect(sentry).toMatch(/extension does not use Sentry/)
    // The unnamed "error-monitoring processor" wording is gone.
    expect(screen.getByTestId('privacy-policy').textContent).not.toMatch(/error-monitoring DSN/)
  })

  it('lists the outgoing mail service and support inbox as recipients of the report', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    const mail = section('privacy-third-party-support-mail')
    expect(mail).toMatch(/feedback form only/)
    expect(mail).toMatch(/receive the case ID, kind, subject, message and any\s+reply email/)
  })

  it('does not promise a time limit for the in-memory record of the network address', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    const logs = section('privacy-feedback-logs')
    expect(logs).toMatch(/may also keep the\s+address in memory until it next restarts/)
    expect(logs).toMatch(/Neither is stored with the case or written to\s+logs/)
    expect(logs).not.toMatch(/ten minutes/)
  })

  it('names answering feedback reports among the purposes', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    expect(section('privacy-purpose')).toMatch(
      /Feedback reports, and any reply email you give with one, are used only\s+to read and answer that report/,
    )
  })

  it('states the current retention (no automatic deletion) without inventing a period', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    const retention = section('privacy-feedback-retention')
    expect(retention).toMatch(/Automatic deletion of feedback reports is switched\s+off until StreamPulse chooses a retention period/)
    expect(retention).toMatch(/kept until they are deleted by hand/)
    expect(retention).not.toMatch(/\d+\s*(days?|months?|years?)/i)
  })

  it('says how to ask for deletion through the existing privacy mailbox', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    const deletion = screen.getByTestId('privacy-feedback-deletion')
    expect(deletion.querySelector('a[href="mailto:privacy@streampulse.stream"]')).toBeTruthy()
    expect(deletion.textContent).toMatch(/with the case\s+ID shown after you sent it/)
  })
})
