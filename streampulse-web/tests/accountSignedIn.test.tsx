import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('falls back to the email form when the session check fails', async () => {
    vi.mocked(accountRequest).mockRejectedValue(new AccountError(401))
    render(<MemoryRouter initialEntries={['/account/sign-in']}><AccountPage /></MemoryRouter>)
    expect(await screen.findByLabelText('Email address')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Tester sign-in' })).toBeTruthy()
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
