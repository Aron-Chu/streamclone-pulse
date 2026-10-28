import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, StaticRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Withdraw from '../src/routes/public/Withdraw'
import Refunds from '../src/routes/public/Refunds'
import Terms from '../src/routes/public/Terms'
import { apiClient } from '../src/lib/apiClient'

vi.mock('../src/ui/components/PublicLayout', () => ({ PublicLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock('../src/lib/apiClient', () => ({ apiClient: vi.fn(), isApiError: (value: unknown) => !!value && typeof value === 'object' && 'status' in value }))
vi.mock('../src/lib/supportForm', async importOriginal => {
  const original = await importOriginal<typeof import('../src/lib/supportForm')>()
  return { ...original, feedbackSiteKey: () => 'test-site-key', ensureTurnstileScript: () => Promise.resolve() }
})

const key = 'a0b1c2d3-1234-4567-8123-a0b1c2d3e4f5'
let issueToken: ((token: string) => void) | undefined
const reset = vi.fn(() => { issueToken?.('fresh-token') })

beforeEach(() => {
  window.sessionStorage.clear()
  vi.stubEnv('VITE_SUPPORTER_WITHDRAWAL_ENABLED', 'true')
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(key)
  window.turnstile = {
    render: vi.fn((_host, options) => { issueToken = options.callback; queueMicrotask(() => options.callback('test-token')); return 'widget' }),
    remove: vi.fn(), reset,
  }
  vi.mocked(apiClient).mockReset()
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); delete window.turnstile; issueToken = undefined; reset.mockClear() })

function show() { render(<MemoryRouter><Withdraw /></MemoryRouter>) }
async function enterReview() {
  fireEvent.change(await screen.findByLabelText('Your name'), { target: { value: 'Test Buyer' } })
  fireEvent.change(screen.getByLabelText('Email for your acknowledgement'), { target: { value: 'buyer@example.test' } })
  fireEvent.change(screen.getByLabelText('Details to identify the subscription'), { target: { value: 'Receipt in_123' } })
  fireEvent.click(screen.getByRole('button', { name: 'Review withdrawal' }))
  await waitFor(() => expect((screen.getByRole('button', { name: 'Confirm withdrawal' }) as HTMLButtonElement).disabled).toBe(false))
}

describe('Supporter withdrawal', () => {
  it('never prerenders a form that could send private details in a GET URL', () => {
    const html = renderToString(<StaticRouter location="/withdraw"><Withdraw /></StaticRouter>)
    expect(html).not.toContain('<form')
    expect(html).toMatch(/email us instead/i)
  })

  it('reviews first, then submits once and shows only a recorded acknowledgement', async () => {
    vi.mocked(apiClient).mockResolvedValue({ status: 200, data: { reference: key, received_at: '2026-10-28T18:30:23Z' } })
    show()
    await enterReview()
    expect(window.turnstile?.render).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'withdrawal' }))
    expect(apiClient).not.toHaveBeenCalled()
    expect(screen.getByText(/I wish to withdraw/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }))
    expect(await screen.findByRole('heading', { name: 'Withdrawal request received' })).toBeTruthy()
    expect(screen.getByText(/does not mean a refund has already been issued/)).toBeTruthy()
    expect(apiClient).toHaveBeenCalledTimes(1)
    expect(apiClient).toHaveBeenCalledWith('/v1/portal/supporter/withdrawals', expect.objectContaining({
      method: 'POST', sensitive: true, credentials: 'omit', headers: { 'Idempotency-Key': key },
      body: { name: 'Test Buyer', email: 'buyer@example.test', contract: 'Receipt in_123', turnstile_token: 'test-token' },
    }))
  })

  it('keeps the same request and key after an uncertain result', async () => {
    vi.mocked(apiClient).mockRejectedValueOnce({ kind: 'timeout', status: 0 }).mockResolvedValueOnce({ status: 200, data: { reference: key, received_at: '2026-10-28T18:30:23Z' } })
    show(); await enterReview()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }))
    expect(await screen.findByText(/could not confirm whether your request was received/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Edit details' })).toBeNull()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Try the same request again' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: 'Try the same request again' }))
    expect(await screen.findByRole('heading', { name: 'Withdrawal request received' })).toBeTruthy()
    const calls = vi.mocked(apiClient).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[0][1]?.headers).toEqual(calls[1][1]?.headers)
    expect(calls[1][1]?.body).toEqual({ name: 'Test Buyer', email: 'buyer@example.test', contract: 'Receipt in_123', turnstile_token: 'fresh-token' })
  })

  it('reuses only the anonymous request key after the page is reopened', async () => {
    vi.mocked(apiClient).mockRejectedValueOnce({ kind: 'timeout', status: 0 }).mockResolvedValueOnce({ status: 200, data: { reference: key, received_at: '2026-10-28T18:30:23Z' } })
    const first = render(<MemoryRouter><Withdraw /></MemoryRouter>)
    await enterReview()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }))
    expect(await screen.findByText(/could not confirm whether your request was received/)).toBeTruthy()
    const stored = JSON.stringify(window.sessionStorage)
    expect(stored).toContain(key)
    expect(stored).not.toContain('buyer@example.test')
    expect(stored).not.toContain('Receipt in_123')
    first.unmount()
    show()
    expect(await screen.findByText(/earlier request in this tab may have been received/i)).toBeTruthy()
    await enterReview()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }))
    expect(await screen.findByRole('heading', { name: 'Withdrawal request received' })).toBeTruthy()
    expect(vi.mocked(apiClient).mock.calls[1][1]?.headers).toEqual({ 'Idempotency-Key': key })
    expect(JSON.stringify(window.sessionStorage)).not.toContain(key)
  })

  it('honors the longer retry delay supplied by the server', async () => {
    vi.mocked(apiClient).mockRejectedValueOnce({ kind: 'http', status: 429, retryAfterMs: 120_000, body: { retry_after_seconds: 900 } })
    show(); await enterReview()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm withdrawal' }))
    expect(await screen.findByText(/The form is busy/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Try the same request again' }) as HTMLButtonElement).disabled).toBe(true)
    const countdown = screen.getByText(/Try again in \d+ seconds/).textContent || ''
    expect(Number(countdown.match(/\d+/)?.[0])).toBeGreaterThan(850)
  })

  it('offers the email alternative when the form is disabled', async () => {
    vi.stubEnv('VITE_SUPPORTER_WITHDRAWAL_ENABLED', 'false')
    show()
    expect(await screen.findByText(/online form is unavailable/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Review withdrawal' })).toBeNull()
    expect(screen.getByRole('link', { name: 'privacy@streampulse.stream' }).getAttribute('href')).toBe('mailto:privacy@streampulse.stream')
  })

  it('exposes the withdrawal link on the policy only when the build gate is enabled', () => {
    const { unmount } = render(<MemoryRouter><Refunds /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'Withdraw from contract here' }).getAttribute('href')).toBe('/withdraw')
    unmount()
    vi.stubEnv('VITE_SUPPORTER_WITHDRAWAL_ENABLED', 'false')
    render(<MemoryRouter><Refunds /></MemoryRouter>)
    expect(screen.queryByRole('link', { name: 'Withdraw from contract here' })).toBeNull()
  })

  it('keeps both withdrawal methods in the integrated legal copy', () => {
    const refunds = render(<MemoryRouter><Refunds /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'withdrawal form' }).getAttribute('href')).toBe('/withdraw')
    refunds.unmount()
    render(<MemoryRouter><Terms /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'withdrawal form' }).getAttribute('href')).toBe('/withdraw')
    expect(screen.getByTestId('terms-seller-and-law').textContent).toContain('of your request')
  })
})
