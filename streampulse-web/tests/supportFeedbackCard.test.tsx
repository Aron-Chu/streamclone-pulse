import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Support from '../src/routes/public/Support'

type Captured = { key: string | null; body: Record<string, unknown> }

let issue: (token: string) => void = () => {}
let resets = 0
let requests: Captured[] = []

function installTurnstile() {
  resets = 0
  window.turnstile = {
    render: (_el, opts) => {
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
  render(<MemoryRouter><Support /></MemoryRouter>)
  await waitFor(() => expect(screen.getByTestId('support-form')).toBeTruthy())
}

function message() { return screen.getByLabelText('Your message') as HTMLTextAreaElement }
function typeMessage(text: string) { fireEvent.change(message(), { target: { value: text } }) }
function consent() { fireEvent.click(screen.getByLabelText('I consent to submitting this text to StreamPulse support.')) }
function send() { fireEvent.submit(screen.getByTestId('support-form')) }

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

  it('shows a sending state that pauses the form', async () => {
    let release: (response: Response) => void = () => {}
    respondWith(() => new Promise<Response>(resolve => { release = resolve }))
    await renderCard()
    typeMessage('Slow network')
    consent()
    issue('tok-1')
    send()
    expect(await screen.findByText('Sending…')).toBeTruthy()
    expect(message().closest('fieldset')!.disabled).toBe(true)
    expect(screen.getByTestId('support-form').getAttribute('aria-busy')).toBe('true')
    release(json(200, { case_id: 'c1' })())
    await screen.findByText('Saved. Thank you.')
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
      expect(alert.textContent).toMatch(/Too many attempts\. Try again in (30|29) seconds\. Your message is still here\./)
      expect((screen.getByRole('button', { name: /Send feedback/ }) as HTMLButtonElement).disabled).toBe(true)
      expect(message().value).toBe('Spam? No.')
      await act(async () => { vi.advanceTimersByTime(31_000) })
      await waitFor(() => expect(screen.queryByTestId('support-form-rate-limit')).toBeNull())
      expect((screen.getByRole('button', { name: /Send feedback/ }) as HTMLButtonElement).disabled).toBe(false)
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

  it('switches to the unavailable state when the hosted form is off, keeping the message to copy', async () => {
    respondWith(json(503, { error: 'disabled' }))
    await renderCard()
    typeMessage('Is this on?')
    consent()
    issue('tok-1')
    send()
    const off = await screen.findByTestId('support-form-unavailable')
    expect(off.textContent).toMatch(/unavailable/)
    expect(within(off).getByRole('link', { name: 'Open a public issue on GitHub' })).toBeTruthy()
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
