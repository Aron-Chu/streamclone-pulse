import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Feedback from '../src/routes/public/Feedback'
import Support from '../src/routes/public/Support'

type Captured = { key: string | null; body: Record<string, unknown> }

let issue: (token: string) => void = () => {}
let resets = 0
let renderOpts: Record<string, unknown> | null = null
let requests: Captured[] = []

function installTurnstile() {
  resets = 0
  renderOpts = null
  window.turnstile = {
    render: (_el, opts) => {
      renderOpts = opts
      issue = token => act(() => opts.callback(token))
      return 'widget-1'
    },
    reset: () => { resets += 1 },
    remove: () => {},
  }
}

function respondWith(...replies: Array<() => Response | Promise<Response>>) {
  requests = []
  const queue = [...replies]
  const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    requests.push({ key: headers.get('Idempotency-Key'), body: JSON.parse(String(init?.body)) })
    const next = queue.shift()
    if (!next) throw new Error('unexpected request')
    return next()
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

async function renderCard() {
  render(<MemoryRouter><Feedback /></MemoryRouter>)
  await waitFor(() => expect(screen.getByTestId('support-form')).toBeTruthy())
}

function message() { return screen.getByLabelText('Your message') as HTMLTextAreaElement }
function typeMessage(text: string) { fireEvent.change(message(), { target: { value: text } }) }
function consent() { fireEvent.click(screen.getByLabelText('I consent to submitting this text to StreamPulse support.')) }
function send() { fireEvent.submit(screen.getByTestId('support-form')) }
function submitButton() { return screen.getByRole('button', { name: /Send feedback|Try again/ }) as HTMLButtonElement }
function consentBox() { return screen.getByLabelText('I consent to submitting this text to StreamPulse support.') as HTMLInputElement }
/** Fires the widget's error-callback with a Cloudflare client error code; returns what the card returned. */
function widgetError(code: string): unknown {
  let handled: unknown
  act(() => { handled = (renderOpts!['error-callback'] as (errorCode: string) => unknown)(code) })
  return handled
}

beforeEach(() => {
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '1x00000000000000000000AA')
  installTurnstile()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  delete window.turnstile
})

describe('support feedback card', () => {
  it('files "Something\'s wrong" as a bug with a derived subject, explicit consent and the challenge token', async () => {
    respondWith(json(200, { case_id: 'case-123' }))
    await renderCard()
    typeMessage('Pulse tab is blank on every channel')
    consent()
    issue('tok-1')
    send()
    await screen.findByText('Saved. Thank you.')
    expect(requests[0]!.body).toEqual({
      category: 'bug',
      subject: 'Pulse tab is blank on every channel',
      description: 'Pulse tab is blank on every channel',
      consent: true,
      turnstile_token: 'tok-1',
    })
    expect(within(screen.getByTestId('support-form-success')).getByText('case-123')).toBeTruthy()
  })

  it('files "I have an idea" as a suggestion and sends contact consent only with an email', async () => {
    respondWith(json(200, { case_id: 'case-9' }))
    await renderCard()
    fireEvent.click(screen.getByLabelText('I have an idea'))
    typeMessage('Dark chat colours please')
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'me@example.com' } })
    consent()
    issue('tok-1')
    send()
    expect(await screen.findByText('Allow a reply to this email, or leave the email blank.')).toBeTruthy()
    expect(requests).toHaveLength(0)
    fireEvent.click(screen.getByLabelText('I consent to being contacted at this email about this report.'))
    send()
    await screen.findByText('Saved. Thank you.')
    expect(requests[0]!.body).toMatchObject({ category: 'suggestion', email: 'me@example.com', contact_consent: true })
  })

  it('keeps one idempotency key across retries of the same text and starts a new one on any edit or after success', async () => {
    respondWith(json(500, { error: 'boom' }), json(500, { error: 'boom' }), json(200, { case_id: 'c1' }), json(200, { case_id: 'c2' }))
    await renderCard()
    typeMessage('First try')
    consent()
    issue('tok-1')
    send()
    await screen.findByText("Couldn't send. Your message is still here.")
    issue('tok-2')
    send()
    await waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]!.key).toBe(requests[0]!.key)

    typeMessage('First try, edited')
    issue('tok-3')
    send()
    await screen.findByText('Saved. Thank you.')
    expect(requests[2]!.key).not.toBe(requests[1]!.key)

    fireEvent.click(screen.getByRole('button', { name: 'Send something else' }))
    typeMessage('First try, edited')
    consent()
    issue('tok-4')
    send()
    await waitFor(() => expect(requests).toHaveLength(4))
    expect(requests[3]!.key).not.toBe(requests[2]!.key)
    expect(new Set(requests.map(r => r.key)).size).toBe(3)
  })

  it('resets the challenge token after success and after failure', async () => {
    const fetchMock = respondWith(json(500, { error: 'boom' }), json(200, { case_id: 'c1' }))
    await renderCard()
    typeMessage('Something broke')
    consent()
    issue('tok-1')
    send()
    await screen.findByText("Couldn't send. Your message is still here.")
    expect(resets).toBe(1)
    // The spent token is gone: sending again waits for a new one.
    send()
    expect(await screen.findByText('Still checking that you are not a bot. Try again in a moment.')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    issue('tok-2')
    send()
    await screen.findByText('Saved. Thank you.')
    expect(requests[1]!.body.turnstile_token).toBe('tok-2')
    expect(resets).toBe(2)

    fireEvent.click(screen.getByRole('button', { name: 'Send something else' }))
    typeMessage('Another thing')
    consent()
    send()
    expect(await screen.findByText('Still checking that you are not a bot. Try again in a moment.')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shows a sending state that pauses the form without taking focus off Send', async () => {
    let release: (response: Response) => void = () => {}
    respondWith(() => new Promise<Response>(resolve => { release = resolve }))
    await renderCard()
    typeMessage('Slow network')
    consent()
    issue('tok-1')
    const submit = submitButton()
    submit.focus()
    send()
    expect(await screen.findByText('Sending…')).toBeTruthy()
    expect(screen.getByTestId('support-form').getAttribute('aria-busy')).toBe('true')
    // Paused, not disabled: Chrome blurs a focused control that becomes
    // disabled, which dropped the keyboard reader back to <body>.
    expect(submit.matches(':disabled')).toBe(false)
    expect(submit.getAttribute('aria-disabled')).toBe('true')
    expect(document.activeElement).toBe(submit)
    expect(message().readOnly).toBe(true)
    // While the first send is in flight, edits and a second press do nothing.
    fireEvent.click(consentBox())
    expect(consentBox().checked).toBe(true)
    send()
    expect(requests).toHaveLength(1)
    release(json(200, { case_id: 'c1' })())
    await screen.findByText('Saved. Thank you.')
  })

  it('keeps focus on Send after a failed send and moves it to the message after "Send something else"', async () => {
    respondWith(json(500, { error: 'boom' }), json(200, { case_id: 'c1' }))
    await renderCard()
    typeMessage('Focus check')
    consent()
    issue('tok-1')
    submitButton().focus()
    send()
    await screen.findByText("Couldn't send. Your message is still here.")
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }))
    issue('tok-2')
    send()
    await screen.findByText('Saved. Thank you.')
    fireEvent.click(screen.getByRole('button', { name: 'Send something else' }))
    await waitFor(() => expect(document.activeElement).toBe(message()))
  })

  it('moves focus to the field a server rejection points at', async () => {
    respondWith(json(400, { error: 'invalid_email' }))
    await renderCard()
    typeMessage('Reply to me')
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'me@example.com' } })
    fireEvent.click(screen.getByLabelText('I consent to being contacted at this email about this report.'))
    consent()
    issue('tok-1')
    submitButton().focus()
    send()
    expect(await screen.findByText('The server did not accept that email. Check it, or leave it blank.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText(/^Email/))
  })

  it('moves focus to the unavailable panel when it replaces the form the reader was in', async () => {
    respondWith(json(503, { error: 'disabled' }))
    await renderCard()
    typeMessage('Is this on?')
    consent()
    issue('tok-1')
    submitButton().focus()
    send()
    const off = await screen.findByTestId('support-form-unavailable')
    await waitFor(() => expect(document.activeElement).toBe(within(off).getByText(/The private feedback form is unavailable right now/)))
  })

  it('keeps the text when sending fails and offers Try again', async () => {
    respondWith(() => Promise.reject(new TypeError('network down')), () => Promise.reject(new TypeError('network down')))
    await renderCard()
    typeMessage('Keep me')
    consent()
    issue('tok-1')
    send()
    expect(await screen.findByText("Couldn't send. Your message is still here.")).toBeTruthy()
    expect(message().value).toBe('Keep me')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('treats a 200 without a case ID as not sent', async () => {
    respondWith(json(200, {}))
    await renderCard()
    typeMessage('Where is my case?')
    consent()
    issue('tok-1')
    send()
    expect(await screen.findByText("Couldn't send. Your message is still here.")).toBeTruthy()
    expect(screen.queryByText('Saved. Thank you.')).toBeNull()
  })

  it('uses Retry-After for too many attempts and holds Send until then', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      respondWith(json(429, { error: 'rate_limited' }, { 'Retry-After': '30' }))
      await renderCard()
      typeMessage('Spam? No.')
      consent()
      issue('tok-1')
      send()
      const alert = await screen.findByTestId('support-form-rate-limit')
      const said = 'Too many attempts. Try again in about 30 seconds. Your message is still here.'
      expect(alert.textContent).toBe(said)
      expect(submitButton().getAttribute('aria-disabled')).toBe('true')
      expect(message().value).toBe('Spam? No.')
      // The countdown ticks outside the alert; the alert itself is said once.
      const countdown = screen.getByTestId('support-rate-countdown')
      expect(countdown.getAttribute('aria-hidden')).toBe('true')
      expect(countdown.closest('[role="alert"], [role="status"], [aria-live]')).toBeNull()
      const before = countdown.textContent
      await act(async () => { vi.advanceTimersByTime(3_000) })
      expect(screen.getByTestId('support-rate-countdown').textContent).not.toBe(before)
      expect(screen.getByTestId('support-form-rate-limit').textContent).toBe(said)
      expect(screen.getByTestId('support-form-announce').textContent).toBe('')
      issue('tok-2')
      send()
      expect(requests).toHaveLength(1)
      await act(async () => { vi.advanceTimersByTime(28_000) })
      await waitFor(() => expect(screen.queryByTestId('support-form-rate-limit')).toBeNull())
      expect(screen.queryByTestId('support-rate-countdown')).toBeNull()
      expect(submitButton().getAttribute('aria-disabled')).toBeNull()
      // Said once, politely, when sending is allowed again.
      await waitFor(() => expect(screen.getByTestId('support-form-announce').textContent).toBe('You can send again.'))
      expect(screen.getByTestId('support-form-announce').getAttribute('role')).toBe('status')
    } finally {
      vi.useRealTimers()
    }
  })

  it('asks the reader to wait a minute when the server names no Retry-After, then lets them send again', async () => {
    // The backend's 429 for this route sends no Retry-After, and a cross-origin
    // reply hides it unless CORS exposes it: Send must not stay off until reload.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      respondWith(json(429, { error: 'rate_limited' }), json(200, { case_id: 'c-after-wait' }))
      await renderCard()
      typeMessage('Again')
      consent()
      issue('tok-1')
      send()
      expect((await screen.findByTestId('support-form-rate-limit')).textContent).toContain('Too many attempts. Wait a minute, then try again.')
      await act(async () => { vi.advanceTimersByTime(30_000) })
      expect(screen.getByTestId('support-form-rate-limit')).toBeTruthy()
      await act(async () => { vi.advanceTimersByTime(31_000) })
      await waitFor(() => expect(screen.queryByTestId('support-form-rate-limit')).toBeNull())
      issue('tok-2')
      send()
      await screen.findByText('Saved. Thank you.')
      expect(requests).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('counts the visible wait from when the 429 arrives, not from when the page loaded', async () => {
    // `now` used to move only on mount and on each countdown tick, so the first
    // frame of a 429 after five quiet minutes read "Send again in 360s".
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const shown: string[] = []
    const collect = (records: MutationRecord[]) => {
      for (const record of records) {
        const countdown = (record.target.nodeType === Node.TEXT_NODE ? record.target.parentElement : record.target as Element)
          ?.closest('[data-testid="support-rate-countdown"]')
        if (record.type === 'characterData' && countdown) shown.push(record.oldValue ?? '')
      }
    }
    const observer = new MutationObserver(collect)
    try {
      respondWith(json(429, { error: 'rate_limited' }))
      await renderCard()
      typeMessage('Took a while to write this')
      consent()
      issue('tok-1')
      vi.setSystemTime(Date.now() + 5 * 60_000)
      observer.observe(screen.getByTestId('support-form'), { subtree: true, characterData: true, characterDataOldValue: true })
      send()
      const countdown = await screen.findByTestId('support-rate-countdown')
      collect(observer.takeRecords())
      shown.push(countdown.textContent ?? '')
      const seconds = shown.map(text => Number(/\d+/.exec(text)?.[0]))
      expect(seconds.every(value => value >= 1 && value <= 60), `countdown showed ${JSON.stringify(shown)}`).toBe(true)
    } finally {
      observer.disconnect()
      vi.useRealTimers()
    }
  })

  it('switches to the unavailable state when the hosted form is off, keeping the message to copy', async () => {
    respondWith(json(503, { error: 'disabled' }))
    await renderCard()
    typeMessage('Is this on?')
    consent()
    issue('tok-1')
    send()
    const off = await screen.findByTestId('support-form-unavailable')
    expect(off.textContent).toMatch(/private feedback form is unavailable right now, so your message was not sent/)
    // Public alternatives are labelled public, never private.
    const alternatives = within(off).getByTestId('feedback-public-alternatives')
    expect(alternatives.textContent).toMatch(/Public alternatives\. Anyone can read these/)
    expect(alternatives.textContent).not.toMatch(/private/i)
    expect(within(off).getByRole('link', { name: 'Open a public issue on GitHub (opens in a new tab)' })).toBeTruthy()
    expect(within(off).getByRole('button', { name: 'Copy safe diagnostics' })).toBeTruthy()
    expect((within(off).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Is this on?')
    expect(screen.queryByTestId('support-form')).toBeNull()
  })

  it('says when the bot check failed and keeps the text', async () => {
    respondWith(json(400, { error: 'turnstile_failed' }))
    await renderCard()
    typeMessage('Human here')
    consent()
    issue('tok-1')
    send()
    expect(await screen.findByText("The bot check didn't go through. Your message is still here; try again.")).toBeTruthy()
    expect(message().value).toBe('Human here')
  })

  it('keeps the form and the message when the bot check errors, and starts a fresh challenge on the next Send', async () => {
    respondWith(json(200, { case_id: 'c-after-check' }))
    await renderCard()
    typeMessage('Human, honest')
    consent()
    // A challenge timeout while the reader is still typing changes nothing on screen.
    expect(widgetError('300030')).toBe(true)
    expect(screen.queryByTestId('support-form-unavailable')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(resets).toBe(0)

    // Send starts a fresh challenge and waits for it.
    send()
    expect(await screen.findByText('Still checking that you are not a bot. Try again in a moment.')).toBeTruthy()
    expect(resets).toBe(1)
    // That one fails too: now the reader is told, and the text stays.
    widgetError('600010')
    expect((await screen.findByRole('alert')).textContent).toBe("The bot check didn't go through. Your message is still here; try again.")
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(message().value).toBe('Human, honest')
    expect(screen.queryByTestId('support-form-unavailable')).toBeNull()

    send()
    expect(resets).toBe(2)
    issue('tok-fresh')
    send()
    await screen.findByText('Saved. Thank you.')
    expect(requests).toHaveLength(1)
    expect(requests[0]!.body.turnstile_token).toBe('tok-fresh')
  })

  it.each(['110200', '400020'])('shows the unavailable panel when the widget reports configuration error %s', async (code) => {
    respondWith()
    await renderCard()
    typeMessage('Is the check broken?')
    widgetError(code)
    const off = await screen.findByTestId('support-form-unavailable')
    expect((within(off).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Is the check broken?')
  })

  it('falls back to the unavailable panel when every fresh challenge fails', async () => {
    const fetchMock = respondWith()
    await renderCard()
    typeMessage('Blocked iframe')
    consent()
    widgetError('200500')
    send()
    widgetError('200500')
    expect(await screen.findByText("The bot check didn't go through. Your message is still here; try again.")).toBeTruthy()
    send()
    widgetError('200500')
    const off = await screen.findByTestId('support-form-unavailable')
    expect((within(off).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Blocked iframe')
    expect(resets).toBe(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('leaves a sent case on screen when the next challenge errors', async () => {
    respondWith(json(200, { case_id: 'case-kept' }))
    await renderCard()
    typeMessage('All good')
    consent()
    issue('tok-1')
    send()
    await screen.findByText('Saved. Thank you.')
    widgetError('110200')
    expect(screen.getByText('Saved. Thank you.')).toBeTruthy()
    expect(screen.queryByTestId('support-form-unavailable')).toBeNull()
  })

  it('points a server rejection at the message field', async () => {
    respondWith(json(400, { error: 'invalid_description' }))
    await renderCard()
    typeMessage('Fine locally')
    consent()
    issue('tok-1')
    send()
    expect(await screen.findByText('The server could not accept this message. Shorten it and try again.')).toBeTruthy()
    expect(message().getAttribute('aria-invalid')).toBe('true')
  })

  it('nudges for an empty message and limits the message in UTF-8 bytes', async () => {
    const fetchMock = respondWith()
    await renderCard()
    consent()
    issue('tok-1')
    send()
    expect(await screen.findByText('Add a few words first.')).toBeTruthy()
    typeMessage('😀'.repeat(1001))
    expect(screen.getByTestId('support-message-count').textContent).toBe('4,004 / 4,000 bytes')
    send()
    expect(await screen.findByText(/Shorten your message to fit 4,000 bytes/)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'an empty message',
      fill: () => { consent() },
      text: 'Add a few words first.',
      field: () => message(),
      hint: 'feedback-message-hint',
    },
    {
      name: 'an invalid email',
      fill: () => {
        typeMessage('Hello')
        fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'not-an-email' } })
        consent()
      },
      text: 'Enter a valid email, or leave it blank.',
      field: () => screen.getByLabelText(/^Email/),
      hint: 'feedback-email-hint',
    },
    {
      name: 'an email without reply consent',
      fill: () => {
        typeMessage('Hello')
        fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'me@example.com' } })
        consent()
      },
      text: 'Allow a reply to this email, or leave the email blank.',
      field: () => screen.getByLabelText('I consent to being contacted at this email about this report.'),
      hint: 'feedback-contact-hint',
    },
    {
      name: 'the consent box unticked',
      fill: () => { typeMessage('Hello') },
      text: 'Tick the consent box to send this.',
      field: () => consentBox(),
      hint: 'feedback-consent-hint',
    },
  ])('moves focus to the field to fix for $name, with the problem as its description', async ({ fill, text, field, hint }) => {
    const fetchMock = respondWith()
    await renderCard()
    fill()
    issue('tok-1')
    submitButton().focus()
    send()
    const hintNode = await screen.findByText(text)
    expect(hintNode.id).toBe(hint)
    await waitFor(() => expect(document.activeElement).toBe(field()))
    expect(field().getAttribute('aria-invalid')).toBe('true')
    expect(field().getAttribute('aria-describedby')?.split(' ')).toContain(hint)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('marks the reply-consent box, not the email, when reply consent is missing', async () => {
    respondWith()
    await renderCard()
    typeMessage('Hello')
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'me@example.com' } })
    consent()
    issue('tok-1')
    send()
    await screen.findByText('Allow a reply to this email, or leave the email blank.')
    expect(screen.getByLabelText(/^Email/).getAttribute('aria-invalid')).toBeNull()
    expect(screen.getByLabelText('I consent to being contacted at this email about this report.').getAttribute('aria-invalid')).toBe('true')
  })

  it('says the problem through the status line when focus is already on the field', async () => {
    respondWith()
    await renderCard()
    typeMessage('Hello')
    const emailBox = screen.getByLabelText(/^Email/) as HTMLInputElement
    fireEvent.change(emailBox, { target: { value: 'not-an-email' } })
    consent()
    issue('tok-1')
    // Enter in the email box submits with focus already there.
    emailBox.focus()
    send()
    await screen.findByText('Enter a valid email, or leave it blank.')
    expect(document.activeElement).toBe(emailBox)
    await waitFor(() => expect(screen.getByTestId('support-form-announce').textContent).toBe('Enter a valid email, or leave it blank.'))
  })

  it.each([
    { width: 261, size: 'compact' },
    { width: 556, size: 'flexible' },
  ])('renders Turnstile interaction-only and $size when the card has $width px for it', async ({ width, size }) => {
    // 300px is the narrowest normal/flexible widget; a 320px phone leaves 261px.
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width)
    try {
      await renderCard()
      await waitFor(() => expect(renderOpts).not.toBeNull())
      expect(renderOpts).toMatchObject({ appearance: 'interaction-only', size })
      const host = screen.getByTestId('support-turnstile')
      expect(host.classList.contains('is-shown')).toBe(false)
      act(() => { (renderOpts!['before-interactive-callback'] as () => void)() })
      expect(host.classList.contains('is-shown')).toBe(true)
    } finally {
      clientWidth.mockRestore()
    }
  })

  it('requires the explicit consent checkbox', async () => {
    const fetchMock = respondWith()
    await renderCard()
    typeMessage('No consent yet')
    issue('tok-1')
    send()
    expect(await screen.findByText('Tick the consent box to send this.')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('page outline', () => {
  it.each(['1x00000000000000000000AA', ''])('puts the /support h1 before the private feedback link card (site key %j)', (key) => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', key)
    render(<MemoryRouter><Support /></MemoryRouter>)
    const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
    expect(headings[0]!.tagName).toBe('H1')
    expect(headings[0]!.textContent).toBe('Support & Troubleshooting')
    expect(document.querySelectorAll('h1')).toHaveLength(1)
    expect(headings[1]!.textContent).toBe('Send private feedback')
  })

  it.each(['1x00000000000000000000AA', ''])('gives /feedback one h1 that names the form (site key %j)', (key) => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', key)
    render(<MemoryRouter><Feedback /></MemoryRouter>)
    const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
    expect(headings[0]!.tagName).toBe('H1')
    expect(headings[0]!.textContent).toBe('Send feedback')
    expect(document.querySelectorAll('h1')).toHaveLength(1)
    expect(document.getElementById('send-feedback')!.getAttribute('aria-labelledby')).toBe('feedback-title')
  })
})

describe('/support link card', () => {
  it('keeps the send-feedback anchor and links it to /feedback instead of embedding the form', () => {
    render(<MemoryRouter><Support /></MemoryRouter>)
    const card = screen.getByTestId('support-feedback-link')
    expect(card.id).toBe('send-feedback')
    expect(card.textContent).toMatch(/Only the StreamPulse team reads it\. No account needed\./)
    expect(within(card).getByRole('link', { name: 'Send feedback' }).getAttribute('href')).toBe('/feedback')
    expect(screen.queryByTestId('support-form')).toBeNull()
    expect(screen.queryByTestId('support-form-unavailable')).toBeNull()
    // Troubleshooting content stays on /support.
    expect(screen.getByRole('heading', { name: 'Extension not appearing on Twitch' })).toBeTruthy()
  })

  it('does not promise private delivery when the build cannot take messages', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    render(<MemoryRouter><Support /></MemoryRouter>)
    const card = screen.getByTestId('support-feedback-link')
    expect(screen.getByTestId('support-feedback-link-sub').textContent)
      .toBe("The private feedback form isn't taking messages right now. The feedback page lists public alternatives.")
    expect(card.textContent).not.toMatch(/Only the StreamPulse team reads it/)
    expect(within(card).getByRole('link', { name: 'Send feedback' }).getAttribute('href')).toBe('/feedback')
  })
})

describe('/feedback page', () => {
  it('says the form is private and needs no account, with email only for a reply', async () => {
    await renderCard()
    expect(screen.getByTestId('feedback-private-note').textContent).toBe('Private. Only the StreamPulse team reads it; nothing here is posted publicly.')
    expect(screen.getByRole('heading', { level: 1 }).parentElement!.textContent).toMatch(/No account needed\./)
    expect(screen.getByText(/optional, only if you.d like a reply/)).toBeTruthy()
    // The reply-consent box appears only once an email is typed; the send consent is always there.
    expect(screen.queryByLabelText('I consent to being contacted at this email about this report.')).toBeNull()
    expect(consentBox()).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'reader@example.com' } })
    expect(screen.getByLabelText('I consent to being contacted at this email about this report.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Support & Troubleshooting' }).getAttribute('href')).toBe('/support')
  })

  it('shows the unavailable panel with public alternatives when the build has no site key', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', 'https://discord.gg/sp-test-code')
    render(<MemoryRouter><Feedback /></MemoryRouter>)
    const off = screen.getByTestId('support-form-unavailable')
    expect(off.textContent).toMatch(/The private feedback form is unavailable right now\./)
    expect(screen.queryByTestId('support-form')).toBeNull()
    expect(within(off).getByRole('link', { name: 'Ask in the public Discord (opens in a new tab)' }).getAttribute('href')).toBe('https://discord.gg/sp-test-code')
    expect(within(off).getByRole('button', { name: 'Copy safe diagnostics' })).toBeTruthy()
  })

  it('drops the private note and the second Discord line while the form is unavailable', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', 'https://discord.gg/sp-test-code')
    render(<MemoryRouter><Feedback /></MemoryRouter>)
    expect(screen.getByTestId('support-form-unavailable')).toBeTruthy()
    expect(screen.queryByTestId('feedback-private-note')).toBeNull()
    expect(screen.queryByTestId('support-discord-line')).toBeNull()
    expect(screen.getAllByRole('link', { name: /Discord/ })
      .filter(a => !a.closest('footer, nav'))).toHaveLength(1)
  })

  it('drops the private note and the Discord line when a send finds the form switched off', async () => {
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', 'https://discord.gg/sp-test-code')
    respondWith(json(503, { error: 'disabled' }))
    await renderCard()
    expect(screen.getByTestId('feedback-private-note')).toBeTruthy()
    expect(screen.getByTestId('support-discord-line')).toBeTruthy()
    typeMessage('Is this on?')
    consent()
    issue('tok-1')
    send()
    const off = await screen.findByTestId('support-form-unavailable')
    expect(off.textContent).toMatch(/so your message was not sent/)
    expect(screen.queryByTestId('feedback-private-note')).toBeNull()
    expect(screen.queryByTestId('support-discord-line')).toBeNull()
    expect(within(off).getByRole('link', { name: 'Ask in the public Discord (opens in a new tab)' })).toBeTruthy()
  })

  it('keeps the private note above a sent case', async () => {
    respondWith(json(201, { case_id: 'case-note-1' }))
    await renderCard()
    typeMessage('Thanks')
    consent()
    issue('tok-1')
    send()
    await screen.findByTestId('support-form-success')
    expect(screen.getByTestId('feedback-private-note')).toBeTruthy()
  })

  it('hides Discord from the public alternatives without a valid invite', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    vi.stubEnv('VITE_PUBLIC_DISCORD_INVITE_URL', '')
    render(<MemoryRouter><Feedback /></MemoryRouter>)
    const off = screen.getByTestId('support-form-unavailable')
    expect(within(off).queryByText(/Discord/)).toBeNull()
    expect(within(off).getByRole('link', { name: 'Open a public issue on GitHub (opens in a new tab)' })).toBeTruthy()
  })

  it('offers the labelled public alternatives after a failed send, keeping the form and the message', async () => {
    respondWith(json(500, { error: 'boom' }))
    await renderCard()
    typeMessage('Charts are blank')
    consent()
    issue('tok-1')
    send()
    await screen.findByTestId('support-form-error')
    const alternatives = screen.getByTestId('feedback-public-alternatives')
    expect(alternatives.textContent).toMatch(/^Public alternatives\./)
    expect(screen.getByTestId('support-form')).toBeTruthy()
    expect(message().value).toBe('Charts are blank')
    expect(screen.queryByTestId('support-form-success')).toBeNull()
  })

  it('shows success only with the case ID the server returned', async () => {
    respondWith(json(201, { case_id: 'case-feedback-1' }))
    await renderCard()
    typeMessage('Love the chart')
    consent()
    issue('tok-1')
    send()
    const done = await screen.findByTestId('support-form-success')
    expect(done.textContent).toContain('case-feedback-1')
    expect(screen.queryByTestId('feedback-public-alternatives')).toBeNull()
  })
})
