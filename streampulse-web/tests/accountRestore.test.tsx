import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountRestore from '../src/routes/account/AccountRestore'
import SupporterThanks from '../src/routes/public/SupporterThanks'
import { AccountError, restoreRequest } from '../src/lib/accountApi'
import { captureAccountRestore, clearAccountRestore, getAccountRestore, isPrivateSupporterRoute } from '../src/lib/accountRestore'

vi.mock('../src/lib/accountApi', async original => ({ ...await original<typeof import('../src/lib/accountApi')>(), restoreRequest: vi.fn() }))
const secret = 'a'.repeat(64)
const inspect = { label: 'Chrome extension', comparisonCode: 'A4C8E2', expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() }
function capture(hash = secret) { window.history.replaceState({}, '', `/account/restore?ignored=1#${hash}`); captureAccountRestore() }
function restore() { return render(<MemoryRouter initialEntries={['/account/restore']}><AccountRestore /></MemoryRouter>) }

beforeEach(() => { vi.clearAllMocks(); clearAccountRestore(); window.history.replaceState({}, '', '/'); vi.mocked(restoreRequest).mockResolvedValue(inspect) })
afterEach(() => { vi.useRealTimers(); clearAccountRestore() })

describe('restore secret custody', () => {
  it('strips every query and fragment before reading the secret, keeps it in memory only', () => {
    capture()
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/account/restore')
    expect(getAccountRestore()).toBe(secret)
    expect(document.documentElement.outerHTML).not.toContain(secret)
    expect(JSON.stringify(localStorage)).not.toContain(secret)
    expect(JSON.stringify(sessionStorage)).not.toContain(secret)
    clearAccountRestore(); expect(getAccountRestore()).toBeNull()
  })
  it.each(['../escape', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), `secret=${secret}`])('rejects malformed fragment %s', fragment => {
    capture(fragment); expect(getAccountRestore()).toBeNull(); expect(window.location.hash).toBe('')
  })
  it('expires its in-memory copy after fifteen minutes', () => {
    vi.useFakeTimers(); capture(); vi.advanceTimersByTime(15 * 60_000); expect(getAccountRestore()).toBeNull()
  })
  it('does not capture other routes and treats payment-return routes as private bootstrap surfaces', () => {
    window.history.replaceState({}, '', '/supporter/thanks#' + secret); captureAccountRestore(); expect(getAccountRestore()).toBeNull()
    expect(isPrivateSupporterRoute('/supporter/thanks')).toBe(true)
    expect(isPrivateSupporterRoute('/account/restore')).toBe(true)
    expect(isPrivateSupporterRoute('/supporter')).toBe(false)
  })
})

describe('restore confirmation', () => {
  it('requires visual comparison with the requesting extension before approval', async () => {
    capture(); restore()
    const confirm = await screen.findByRole('button', { name: 'Confirm restore' })
    expect(screen.getByText('A4C8E2')).toBeTruthy()
    expect(confirm.hasAttribute('disabled')).toBe(true)
    fireEvent.click(confirm)
    expect(restoreRequest).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('checkbox', { name: /code matches the extension/i }))
    expect(confirm.hasAttribute('disabled')).toBe(false)
  })
  it('does not describe an approval timeout as an expired link or invite another request', async () => {
    capture(); restore()
    await screen.findByRole('button', { name: 'Confirm restore' })
    fireEvent.click(screen.getByRole('checkbox', { name: /code matches the extension/i }))
    vi.mocked(restoreRequest).mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }))
    await screen.findByRole('heading', { name: 'Check your extension for the result' })
    expect(screen.getByText(/confirmation may have completed/i)).toBeTruthy()
    expect(screen.queryByText(/request a new restore link/i)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm restore' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Help & support' }).classList.contains('pulse-account-primary')).toBe(true)
    expect(document.querySelectorAll('[data-testid="supporter-restore"] .pulse-account-primary')).toHaveLength(1)
  })
  it('inspects the waiting installation but never approves before a deliberate click', async () => {
    capture(); restore()
    await screen.findByRole('button', { name: 'Confirm restore' })
    expect(screen.getByText('Chrome extension')).toBeTruthy()
    expect(restoreRequest).toHaveBeenCalledTimes(1)
    expect(restoreRequest).toHaveBeenCalledWith('/inspect', { secret })
    vi.mocked(restoreRequest).mockResolvedValueOnce({})
    fireEvent.click(screen.getByRole('checkbox', { name: /code matches the extension/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }))
    await screen.findByRole('heading', { name: 'Restore confirmed' })
    expect(restoreRequest).toHaveBeenLastCalledWith('/approve', { secret, confirmed: true })
    expect(getAccountRestore()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm restore' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Help & support' }).classList.contains('pulse-account-primary')).toBe(true)
    expect(document.querySelectorAll('[data-testid="supporter-restore"] .pulse-account-primary')).toHaveLength(1)
  })
  it('does not inspect when the fragment is missing or malformed', () => {
    restore(); expect(screen.getByRole('heading', { name: 'This restore link is unavailable' })).toBeTruthy()
    expect(restoreRequest).not.toHaveBeenCalled()
  })
  it('shows a fresh-link instruction for an invalid, expired or already used link', async () => {
    capture(); vi.mocked(restoreRequest).mockRejectedValueOnce(new AccountError(401, 'restore_invalid_or_expired')); restore()
    await screen.findByRole('heading', { name: 'This restore link is unavailable' })
    expect(getAccountRestore()).toBeNull()
    expect(screen.getByText(/request a new restore link/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Help & support' }).classList.contains('pulse-account-primary')).toBe(true)
    expect(document.querySelectorAll('[data-testid="supporter-restore"] .pulse-account-primary')).toHaveLength(1)
  })
  it('refuses to confirm an installation with its own paid history', async () => {
    capture(); restore(); await screen.findByRole('button', { name: 'Confirm restore' })
    vi.mocked(restoreRequest).mockRejectedValueOnce(new AccountError(409, 'restore_conflict'))
    fireEvent.click(screen.getByRole('checkbox', { name: /code matches the extension/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }))
    await screen.findByRole('heading', { name: 'These memberships cannot be combined' })
    expect(screen.getByRole('link', { name: 'Contact billing support' }).getAttribute('href')).toBe('mailto:privacy@streampulse.stream')
    expect(getAccountRestore()).toBeNull()
  })
  it('retains only a retryable inspect action during a service outage', async () => {
    capture(); vi.mocked(restoreRequest).mockRejectedValueOnce(new Error('private details')); restore()
    await screen.findByRole('button', { name: 'Try again' })
    expect(screen.queryByText('private details')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('button', { name: 'Confirm restore' })
  })
  it.each([{ label: '<img onerror=evil()>' }, { expiresAt: 'not a date' }, { comparisonCode: 'aaaaaa' }, { comparisonCode: null }, { comparisonCode: 'A4C8E2<script>' }])('rejects misleading labels, malformed expiry or comparison codes: %j', async invalid => {
    capture(); vi.mocked(restoreRequest).mockResolvedValueOnce({ ...inspect, ...invalid }); const view = restore()
    await screen.findByRole('button', { name: 'Try again' })
    expect(view.container.querySelector('img[onerror]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm restore' })).toBeNull()
  })
  it('rechecks in-memory expiry on confirm and avoids sending a stale secret', async () => {
    capture(); restore(); await screen.findByRole('button', { name: 'Confirm restore' }); clearAccountRestore()
    fireEvent.click(screen.getByRole('checkbox', { name: /code matches the extension/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'This restore link is unavailable' })).toBeTruthy())
    expect(restoreRequest).toHaveBeenCalledTimes(1)
  })
  it('honors a rate-limit Retry-After before allowing another read-only inspection', async () => {
    capture(); vi.mocked(restoreRequest).mockRejectedValueOnce(new AccountError(429, 'rate_limited', 90)); restore()
    const retry = await screen.findByRole('button', { name: 'Try again' })
    expect(retry.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Wait 90 seconds before checking again.')).toBeTruthy()
    fireEvent.click(retry)
    expect(restoreRequest).toHaveBeenCalledTimes(1)
  })
})

describe('static payment return', () => {
  it.each(['/supporter/thanks?attempt=fake&success=1', '/supporter/thanks?attempt=fake&cancelled=1'])('makes no authenticated reads or payment claims for %s', path => {
    render(<MemoryRouter initialEntries={[path]}><SupporterThanks /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Return to your extension' })).toBeTruthy()
    expect(screen.getByText(/Your extension will check its status/)).toBeTruthy()
    expect(screen.queryByText(/Payment received|nothing was charged|Supporter is active/i)).toBeNull()
    expect(restoreRequest).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Help & support' }).classList.contains('pulse-account-primary')).toBe(true)
    expect(document.querySelectorAll('[data-testid="supporter-checkout-return"] .pulse-account-primary')).toHaveLength(1)
  })
})
