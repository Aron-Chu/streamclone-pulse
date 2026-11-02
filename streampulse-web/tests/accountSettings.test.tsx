import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountSettings from '../src/routes/account/AccountSettings'
import { AccountError, accountRequest } from '../src/lib/accountApi'
import { rememberStepUp } from '../src/lib/accountStepUp'
import { refreshAccountSession, resetAccountSessionForTests } from '../src/lib/accountSession'
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

 it('explains the one save list with My Moments on (VITE_ACCOUNT_MOMENTS=1)', async () => {
  vi.stubEnv('VITE_ACCOUNT_MOMENTS', '1')
  try {
   vi.mocked(accountRequest).mockImplementation(async path => path === '/me' ? { accountId: 'account-a' } : { devices: [] })
   render(<MemoryRouter><AccountSettings /></MemoryRouter>)
   expect(await screen.findByText(/Your saves and notes are kept in your account/)).toBeTruthy()
   expect(screen.queryByText(/Website saves stay in this browser/)).toBeNull()
  } finally { vi.unstubAllEnvs() }
 })

 it('offers no Sign out everywhere while Sign in with Twitch is off', async () => {
  vi.mocked(accountRequest).mockImplementation(async path => path === '/me' ? { accountId: 'account-a' } : { devices: [] })
  render(<MemoryRouter><AccountSettings /></MemoryRouter>)
  expect(await screen.findByText('You’re signed in to StreamPulse.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Sign out everywhere' })).toBeNull()
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
      fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
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

describe('signing out everywhere', () => {
  // Ships with Sign in with Twitch (VITE_TWITCH_SIGNIN=1).
  beforeEach(() => { vi.stubEnv('VITE_TWITCH_SIGNIN', '1') })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); sessionStorage.clear(); resetAccountSessionForTests() })
  const signedIn = (extra: (path: string) => unknown = () => ({})) => vi.mocked(accountRequest).mockReset().mockImplementation(async path => {
    if (path === '/me') return { accountId: 'account-a' }
    if (path === '/devices') return { devices: [] }
    const result = extra(path)
    if (result instanceof Error) throw result
    return result as Record<string, unknown>
  })
  const confirmGroup = () => screen.getByRole('group', { name: 'Confirm signing out everywhere' })

  it('asks first, then ends every session and leaves for sign-in', async () => {
    signedIn()
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }))
    expect(accountRequest).not.toHaveBeenCalledWith('/sessions/revoke-all', expect.anything())
    expect(confirmGroup().textContent).toContain('This signs out every browser and extension on your account, this one included. Your saves stay in your account.')
    fireEvent.click(within(confirmGroup()).getByRole('button', { name: 'Sign out everywhere' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/account/sign-in'))
    const paths = vi.mocked(accountRequest).mock.calls.map(([path]) => path)
    expect(paths.slice(-2)).toEqual(['/sessions/revoke-all', '/auth/logout'])
  })

  it('does nothing on Cancel', async () => {
    signedIn()
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }))
    fireEvent.click(within(confirmGroup()).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('group', { name: 'Confirm signing out everywhere' })).toBeNull()
    expect(accountRequest).not.toHaveBeenCalledWith('/sessions/revoke-all', expect.anything())
  })

  it('asks for a recent sign-in when the server refuses for an old one', async () => {
    signedIn(path => path === '/sessions/revoke-all' ? new AccountError(403, 'recent_auth_required') : {})
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }))
    fireEvent.click(within(confirmGroup()).getByRole('button', { name: 'Sign out everywhere' }))
    const notice = await screen.findByTestId('recent-sign-in')
    expect(notice.textContent).toContain('For your security, signing out everywhere needs a sign-in from the last 10 minutes. Nothing was signed out.')
    expect(within(notice).getByRole('button', { name: 'Sign in again' })).toBeTruthy()
    expect(accountRequest).not.toHaveBeenCalledWith('/auth/logout', expect.anything())
    expect(screen.getByText('You’re signed in to StreamPulse.')).toBeTruthy()
  })

  it('says so when the server does not offer it yet', async () => {
    signedIn(path => path === '/sessions/revoke-all' ? new AccountError(404) : {})
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }))
    fireEvent.click(within(confirmGroup()).getByRole('button', { name: 'Sign out everywhere' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Sign out everywhere isn’t available yet. Nothing was signed out.')
  })

  it('reopens the confirm step, without running it, after signing in again', async () => {
    signedIn()
    rememberStepUp('sign-out-everywhere', '/account/settings')
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    expect(await screen.findByRole('group', { name: 'Confirm signing out everywhere' })).toBeTruthy()
    expect(accountRequest).not.toHaveBeenCalledWith('/sessions/revoke-all', expect.anything())
  })

  it('hides the account at once when another tab or device ends the session', async () => {
    const CSRF = `__Host-pulse_csrf=${'c'.repeat(64)}`
    let cookie = CSRF
    vi.spyOn(document, 'cookie', 'get').mockImplementation(() => cookie)
    signedIn()
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    expect(await screen.findByText('You’re signed in to StreamPulse.')).toBeTruthy()
    await act(async () => { await refreshAccountSession() })
    cookie = ''
    await act(async () => { await refreshAccountSession() })
    expect(screen.queryByText('You’re signed in to StreamPulse.')).toBeNull()
    expect(await screen.findByTestId('account-settings-signed-out')).toBeTruthy()
  })
})
