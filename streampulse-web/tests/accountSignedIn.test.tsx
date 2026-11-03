import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountPage from '../src/routes/account/AccountPage'
import { AccountError, accountRequest } from '../src/lib/accountApi'
import { getAccountConfirmation } from '../src/lib/accountConfirmation'
import { leaveAccountPagesAfterSignOut, resetAccountSessionForTests } from '../src/lib/accountSession'

vi.mock('../src/lib/accountApi', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/accountApi')>(), accountRequest: vi.fn() }))
vi.mock('../src/lib/accountConfirmation', () => ({ getAccountConfirmation: vi.fn(), clearAccountConfirmation: vi.fn() }))
vi.mock('../src/lib/accountSession', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/accountSession')>(), leaveAccountPagesAfterSignOut: vi.fn() }))
vi.mock('../src/ui/components/PublicLayout', () => ({ PublicLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

let cookie = ''
const returnPath = '/account/billing/return?attempt=12345678-1234-4234-8234-123456789abc'

beforeEach(() => {
  resetAccountSessionForTests()
  cookie = `__Host-pulse_csrf=${'e'.repeat(64)}`
  vi.spyOn(document, 'cookie', 'get').mockImplementation(() => cookie)
  vi.mocked(accountRequest).mockReset().mockResolvedValue({ accountId: 'account-a' })
  vi.mocked(getAccountConfirmation).mockReturnValue('a'.repeat(64))
  vi.mocked(leaveAccountPagesAfterSignOut).mockReset()
})

describe('sign-in page for a signed-in visitor', () => {
  // The signed-in sign-in page ships with Sign in with Twitch (VITE_TWITCH_SIGNIN=1).
  beforeEach(() => { vi.stubEnv('VITE_TWITCH_SIGNIN', '1') })
  afterEach(() => { vi.unstubAllEnvs() })

  it('keeps the email form, with no account check, while Sign in with Twitch is off', () => {
    vi.stubEnv('VITE_TWITCH_SIGNIN', '')
    render(<MemoryRouter initialEntries={['/account/sign-in']}><AccountPage /></MemoryRouter>)
    expect(screen.getByLabelText('Email address')).toBeTruthy()
    expect(accountRequest).not.toHaveBeenCalled()
  })

  it('shows where to go next instead of the email form', async () => {
    render(<MemoryRouter initialEntries={['/account/sign-in']}><AccountPage /></MemoryRouter>)
    expect(screen.getByRole('status').textContent).toBe('Checking your account…')
    expect(screen.queryByLabelText('Email address')).toBeNull()
    expect(await screen.findByRole('heading', { level: 1, name: 'You’re signed in' })).toBeTruthy()
    expect(screen.queryByLabelText('Email address')).toBeNull()
    const main = screen.getByRole('heading', { level: 1 }).parentElement!
    expect(main.querySelector('.pulse-account-actions a[href="/account/settings"]')?.textContent).toBe('Account & devices')
    expect(main.querySelector('.pulse-account-actions a[href="/account/billing"]')?.textContent).toBe('Membership & billing')
    expect(accountRequest).toHaveBeenCalledTimes(1)
    expect(accountRequest).not.toHaveBeenCalledWith('/auth/start', expect.anything())
  })

  it('keeps a billing continuation on the billing link', async () => {
    render(<MemoryRouter initialEntries={[`/account/sign-in?returnTo=${encodeURIComponent(returnPath)}`]}><AccountPage /></MemoryRouter>)
    await screen.findByRole('heading', { level: 1, name: 'You’re signed in' })
    expect(screen.getAllByRole('link', { name: 'Membership & billing' })[0]!.getAttribute('href')).toBe(returnPath)
  })

  it('offers the way back to a clip, and keeps billing on its own page', async () => {
    vi.stubEnv('VITE_PUBLIC_NATIVE_CLIPS', 'on')
    const clip = '/analytics/clips/BraveClipSlug-abc_1'
    render(<MemoryRouter initialEntries={[`/account/sign-in?returnTo=${encodeURIComponent(clip)}`]}><AccountPage /></MemoryRouter>)
    await screen.findByRole('heading', { level: 1, name: 'You’re signed in' })
    const actions = document.querySelector('.pulse-account-actions')!
    expect(actions.querySelector('.pulse-account-primary')?.textContent).toBe('Back to the clip')
    expect(actions.querySelector('.pulse-account-primary')?.getAttribute('href')).toBe(clip)
    expect(actions.querySelectorAll('.pulse-account-primary')).toHaveLength(1)
    expect(actions.querySelector('a[href="/account/billing"]')?.textContent).toBe('Membership & billing')
  })

  it('signs out, then reloads the sign-in page', async () => {
    render(<MemoryRouter initialEntries={['/account/sign-in']}><AccountPage /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(leaveAccountPagesAfterSignOut).toHaveBeenCalledOnce())
    expect(accountRequest).toHaveBeenLastCalledWith('/auth/logout', {})
  })

  it('reports a failed sign-out and stays signed in', async () => {
    render(<MemoryRouter initialEntries={['/account/sign-in']}><AccountPage /></MemoryRouter>)
    vi.mocked(accountRequest).mockRejectedValueOnce(new AccountError(403))
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    expect((await screen.findByRole('alert')).textContent).toBe('This request could not be verified. Reload the page and try again.')
    expect(screen.getByRole('heading', { level: 1, name: 'You’re signed in' })).toBeTruthy()
    expect(leaveAccountPagesAfterSignOut).not.toHaveBeenCalled()
  })

  it('falls back to the sign-in page when the session check fails', async () => {
    vi.mocked(accountRequest).mockRejectedValue(new AccountError(401))
    render(<MemoryRouter initialEntries={['/account/sign-in']}><AccountPage /></MemoryRouter>)
    expect(await screen.findByRole('button', { name: 'Continue with Twitch' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Email sign-in stays as the backup.' })).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 1, name: 'You’re signed in' })).toBeNull()
  })

  it('says the account can’t be reached instead of checking forever (1.12), and checks again on Try again', async () => {
    vi.mocked(accountRequest).mockRejectedValue(new AccountError(503, 'request_unavailable'))
    render(<MemoryRouter initialEntries={['/account/sign-in']}><AccountPage /></MemoryRouter>)
    expect(await screen.findByText('Can’t reach your account right now.')).toBeTruthy()
    expect(screen.queryByText('Checking your account…')).toBeNull()
    vi.mocked(accountRequest).mockResolvedValue({ accountId: 'account-a' })
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'You’re signed in' })).toBeTruthy()
  })
})

describe('confirming a sign-in', () => {
  it('refreshes the header session once the API confirms it', async () => {
    cookie = ''
    render(<MemoryRouter initialEntries={['/account/confirm']}><AccountPage /></MemoryRouter>)
    vi.mocked(accountRequest).mockImplementation(async path => {
      // The API sets the session cookies on the confirmation response.
      if (path === '/auth/complete') cookie = `__Host-pulse_csrf=${'f'.repeat(64)}`
      return path === '/me' ? { accountId: 'account-a' } : {}
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm sign-in' }))
    expect(await screen.findByRole('heading', { name: 'You’re signed in' })).toBeTruthy()
    await waitFor(() => expect(accountRequest).toHaveBeenCalledWith('/me'))
    expect(vi.mocked(accountRequest).mock.calls.map(([path]) => path)).toEqual(['/auth/complete', '/me'])
    await act(async () => { await Promise.resolve() })
  })
})
