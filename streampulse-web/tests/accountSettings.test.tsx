import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import AccountSettings from '../src/routes/account/AccountSettings'
import { AccountError, accountRequest } from '../src/lib/accountApi'
vi.mock('../src/lib/accountApi', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/accountApi')>(), accountRequest: vi.fn() }))
vi.mock('../src/ui/components/PublicLayout', () => ({ PublicLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

describe('account settings', () => {
 it('shows signed-in status without an internal ID, requires revoke confirmation, and retains retry on failure', async () => {
  vi.mocked(accountRequest).mockImplementation(async (path) => {
   if (path === '/me') return { accountId: 'account-a' }
   if (path === '/devices/revoke') throw new Error('offline')
   return { devices: [{ id: 'device-a', label: 'My extension', expiresAt: '2027-01-01T00:00:00Z' }] }
  })
  render(<MemoryRouter><AccountSettings /></MemoryRouter>)
  expect(await screen.findByText('You’re signed in to StreamPulse.')).toBeTruthy()
  expect(screen.queryByText('account-a')).toBeNull()
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke My extension' }))
  expect(accountRequest).not.toHaveBeenCalledWith('/devices/revoke', expect.anything())
  fireEvent.click(screen.getByRole('button', { name: 'Confirm revocation' }))
  await waitFor(() => expect(accountRequest).toHaveBeenCalledWith('/devices/revoke', { deviceId: 'device-a' }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Confirm revocation' }) as HTMLButtonElement).disabled).toBe(false)
  expect(screen.getByText(/Website saves stay in this browser/)).toBeTruthy()
 })
})

describe('signing out', () => {
  it('tells other open account tabs to re-check', async () => {
    localStorage.setItem('pulse.account.signedInAt.v1', String(Date.now()))
    vi.mocked(accountRequest).mockImplementation(async path => path === '/me' ? { accountId: 'account-a' } : path === '/devices' ? { devices: [] } : {})
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    try {
      render(<MemoryRouter><AccountSettings /></MemoryRouter>)
      fireEvent.click(await screen.findByRole('button', { name: /Sign out/ }))
      await waitFor(() => expect(assign).toHaveBeenCalledWith('/account/sign-in'))
      expect(localStorage.getItem('pulse.account.signedInAt.v1')).toBeNull()
    } finally { vi.unstubAllGlobals() }
  })
})

describe('signed-out visitor', () => {
  it('sees a neutral sign-in card, not a red "session expired" alert with Retry', async () => {
    vi.mocked(accountRequest).mockImplementation(async () => { throw new AccountError(401, 'sign_in_required') })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    const card = await screen.findByTestId('account-settings-signed-out')
    expect(card.textContent).toContain('Sign in to see your account')
    expect(screen.getByRole('link', { name: 'Tester sign-in' }).getAttribute('href')).toBe('/account/sign-in')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/expired/i)
  })

  it('treats any 401 before a first successful load as signed out', async () => {
    vi.mocked(accountRequest).mockImplementation(async () => { throw new AccountError(401) })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    expect(await screen.findByTestId('account-settings-signed-out')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('keeps the expired text for a dead sign-in link', async () => {
    vi.mocked(accountRequest).mockImplementation(async () => { throw new AccountError(401, 'link_invalid_or_expired') })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    expect((await screen.findByRole('alert')).textContent).toMatch(/expired/)
    expect(screen.queryByTestId('account-settings-signed-out')).toBeNull()
  })

  it('keeps the expired text when the session ends after a successful load', async () => {
    vi.mocked(accountRequest).mockImplementation(async path => {
      if (path === '/devices/revoke') throw new Error('offline')
      return path === '/me' ? { accountId: 'account-a' } : { devices: [{ id: 'device-a', label: 'My extension', expiresAt: '2027-01-01T00:00:00Z' }] }
    })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke My extension' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revocation' }))
    const retry = await screen.findByRole('button', { name: 'Retry' })
    // The session ends; Retry re-runs the load after it had succeeded once.
    vi.mocked(accountRequest).mockImplementation(async () => { throw new AccountError(401) })
    fireEvent.click(retry)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/session or link has expired/))
    expect(screen.queryByTestId('account-settings-signed-out')).toBeNull()
    expect(screen.queryByText('You’re signed in to StreamPulse.')).toBeNull()
  })
})
