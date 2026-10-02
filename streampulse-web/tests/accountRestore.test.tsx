import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountRestore from '../src/routes/account/AccountRestore'
import SupporterThanks from '../src/routes/public/SupporterThanks'
import { AccountError, restoreRequest } from '../src/lib/accountApi'
import { captureAccountRestore, clearAccountRestore, getAccountRestore, isPrivateSupporterRoute } from '../src/lib/accountRestore'

vi.mock('../src/lib/accountApi', async original => ({ ...await original<typeof import('../src/lib/accountApi')>(), restoreRequest: vi.fn() }))
const secret = 'a'.repeat(64)
const inspect = { label: 'Desktop extension', expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() }
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
  it('inspects the waiting installation but never approves before a deliberate click', async () => {
    capture(); restore()
    await screen.findByRole('button', { name: 'Confirm restore' })
    expect(screen.getByText('Desktop extension')).toBeTruthy()
    expect(restoreRequest).toHaveBeenCalledTimes(1)
    expect(restoreRequest).toHaveBeenCalledWith('/inspect', { secret })
    vi.mocked(restoreRequest).mockResolvedValueOnce({})
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }))
    await screen.findByRole('heading', { name: 'Restore confirmed' })
    expect(restoreRequest).toHaveBeenLastCalledWith('/approve', { secret, confirmed: true })
    expect(getAccountRestore()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Confirm restore' })).toBeNull()
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
  })
  it('refuses to confirm an installation with its own paid history', async () => {
    capture(); restore(); await screen.findByRole('button', { name: 'Confirm restore' })
    vi.mocked(restoreRequest).mockRejectedValueOnce(new AccountError(409, 'restore_conflict'))
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
  it('renders an installation label as plain text and does not accept malformed expiry', async () => {
    capture(); vi.mocked(restoreRequest).mockResolvedValueOnce({ ...inspect, label: '<img onerror=evil()>' }); const view = restore()
    await screen.findByText('<img onerror=evil()>'); expect(view.container.querySelector('img[onerror]')).toBeNull()
    view.unmount(); capture(); vi.mocked(restoreRequest).mockResolvedValueOnce({ label: 'Desktop', expiresAt: 'not a date' }); restore()
    await screen.findByRole('button', { name: 'Try again' })
    expect(screen.queryByRole('button', { name: 'Confirm restore' })).toBeNull()
  })
  it('rechecks in-memory expiry on confirm and avoids sending a stale secret', async () => {
    capture(); restore(); await screen.findByRole('button', { name: 'Confirm restore' }); clearAccountRestore()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'This restore link is unavailable' })).toBeTruthy())
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
  })
})
