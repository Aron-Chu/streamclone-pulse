import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountPage from '../src/routes/account/AccountPage'
import AccountSettings from '../src/routes/account/AccountSettings'
import AccountTwitchCallback from '../src/routes/account/AccountTwitchCallback'
import { AccountEntry } from '../src/ui/components/AccountEntry'
import { AppRoutes } from '../src/routes/index'
import { AccountError, accountRequest } from '../src/lib/accountApi'
import { rememberTwitchIdentity, resetAccountSessionForTests } from '../src/lib/accountSession'
import { beginTwitchFlow, completeTwitchCallback } from '../src/lib/twitchSignIn'

vi.mock('../src/lib/accountApi', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/accountApi')>(), accountRequest: vi.fn() }))
vi.mock('../src/lib/twitchSignIn', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/twitchSignIn')>(),
  beginTwitchFlow: vi.fn(),
  completeTwitchCallback: vi.fn(),
}))
vi.mock('../src/ui/components/PublicLayout', () => ({ PublicLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

const billingReturn = '/account/billing/return?attempt=12345678-1234-4234-8234-123456789abc'
const avatar = 'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-70x70.png'
let cookie = ''

function signedIn(value = 'd') { cookie = `__Host-pulse_csrf=${value.repeat(64)}` }

function LocationProbe() {
  const { pathname, search, state } = useLocation()
  return <output data-testid="location" data-state={JSON.stringify(state)}>{pathname}{search}</output>
}

beforeEach(() => {
  resetAccountSessionForTests()
  cookie = ''
  vi.spyOn(document, 'cookie', 'get').mockImplementation(() => cookie)
  vi.mocked(accountRequest).mockReset().mockImplementation(async path => {
    if (path === '/me') throw new AccountError(401, 'sign_in_required')
    return {}
  })
  vi.mocked(beginTwitchFlow).mockReset().mockResolvedValue(undefined)
  vi.mocked(completeTwitchCallback).mockReset()
})

afterEach(() => { vi.unstubAllEnvs() })

describe('with VITE_TWITCH_SIGNIN off (default)', () => {
  beforeEach(() => { vi.stubEnv('VITE_TWITCH_SIGNIN', '') })

  it('keeps the sign-in page as the tester email form, with Twitch coming soon', () => {
    render(<MemoryRouter initialEntries={['/account/sign-in']}><AccountPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Tester sign-in' })).toBeTruthy()
    expect(screen.getByTestId('twitch-coming-soon').textContent).toBe('Twitch sign-in is coming soon. Free tools work without an account.')
    expect(screen.getByTestId('pilot-sign-in-note')).toBeTruthy()
    expect(screen.getByLabelText('Email address')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send sign-in link' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Twitch/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Tester email sign-in' })).toBeNull()
    expect(screen.queryByTestId('twitch-sign-in')).toBeNull()
    // Nothing on the page starts a Twitch flow.
    expect(beginTwitchFlow).not.toHaveBeenCalled()
  })

  it('shows no Twitch row in account settings', async () => {
    signedIn()
    vi.mocked(accountRequest).mockImplementation(async path => path === '/me' ? { accountId: 'account-a' } : { devices: [] })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    expect(await screen.findByText('You’re signed in to StreamPulse.')).toBeTruthy()
    expect(screen.queryByTestId('twitch-account-row')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Link Twitch' })).toBeNull()
  })

  it('serves the callback path as the ordinary not-found page and never completes a flow', async () => {
    render(<MemoryRouter initialEntries={['/account/twitch/callback']}><AppRoutes /></MemoryRouter>)
    expect(await screen.findByTestId('not-found')).toBeTruthy()
    expect(completeTwitchCallback).not.toHaveBeenCalled()
  })
})

describe('with VITE_TWITCH_SIGNIN=1', () => {
  beforeEach(() => { vi.stubEnv('VITE_TWITCH_SIGNIN', '1') })

  it('puts Continue with Twitch above the email form, which waits under “Tester email sign-in”', () => {
    render(<MemoryRouter initialEntries={['/account/sign-in']}><AccountPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'Tester sign-in' })).toBeTruthy()
    expect(screen.getByText('Twitch sign-in is open to invited testers right now. Free tools work without an account.')).toBeTruthy()
    expect(screen.getByTestId('twitch-pilot-note')).toBeTruthy()
    const twitch = screen.getByRole('button', { name: 'Continue with Twitch' })
    expect(twitch.className).toContain('pulse-account-twitch-button')
    expect(twitch.querySelector('svg[aria-hidden="true"]')).toBeTruthy()
    expect(screen.queryByLabelText('Email address')).toBeNull()
    const toggle = screen.getByRole('button', { name: 'Tester email sign-in' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const input = screen.getByLabelText('Email address')
    expect(document.activeElement).toBe(input)
    expect(twitch.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('pilot-sign-in-note')).toBeTruthy()
  })

  it('opens the email form directly for ?method=email', () => {
    render(<MemoryRouter initialEntries={['/account/sign-in?method=email']}><AccountPage /></MemoryRouter>)
    expect(screen.getByLabelText('Email address')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue with Twitch' })).toBeTruthy()
  })

  it('starts a sign-in carrying only an allowlisted billing return', async () => {
    render(<MemoryRouter initialEntries={[`/account/sign-in?returnTo=${encodeURIComponent(billingReturn)}`]}><AccountPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Twitch' }))
    await waitFor(() => expect(beginTwitchFlow).toHaveBeenCalledWith({ purpose: 'signin', returnTo: billingReturn }))
    expect((screen.getByRole('button', { name: 'Opening Twitch…' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('ignores a returnTo that is not allowlisted', async () => {
    render(<MemoryRouter initialEntries={[`/account/sign-in?returnTo=${encodeURIComponent('https://evil.example/')}`]}><AccountPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Twitch' }))
    await waitFor(() => expect(beginTwitchFlow).toHaveBeenCalledWith({ purpose: 'signin', returnTo: null }))
  })

  it('explains a failed start and offers email in place', async () => {
    vi.mocked(beginTwitchFlow).mockRejectedValueOnce(new AccountError(404, 'not_found'))
    render(<MemoryRouter initialEntries={['/account/sign-in']}><AccountPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Twitch' }))
    expect(await screen.findByRole('heading', { name: 'Twitch sign-in is unavailable' })).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Tester email sign-in' })[0]!)
    expect(screen.getByLabelText('Email address')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Continue with Twitch' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('finishes the callback by navigating to the return path with the outcome', async () => {
    vi.mocked(completeTwitchCallback).mockResolvedValue({ status: 'signed_in', purpose: 'signin', returnTo: billingReturn, profile: {} })
    render(<MemoryRouter initialEntries={['/account/twitch/callback']}>
      <LocationProbe />
      <Routes><Route path="/account/twitch/callback" element={<AccountTwitchCallback />} /><Route path="*" element={null} /></Routes>
    </MemoryRouter>)
    expect(screen.getByText('Checking your Twitch sign-in with StreamPulse.').getAttribute('role')).toBe('status')
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(billingReturn))
    expect(screen.getByTestId('location').getAttribute('data-state')).toBe('{"twitch":"signed_in"}')
  })

  it.each([
    ['pilot_only', 'Twitch sign-in is invite-only for now', 'link', 'Tester email sign-in'],
    ['link_required', 'Link Twitch to your account first', 'link', 'Tester email sign-in'],
    ['signup_unavailable', 'New accounts are paused', 'link', 'Back to sign-in'],
    ['revoked', 'Confirm your sign-in on Twitch', 'button', 'Continue with Twitch'],
    ['unavailable', 'Twitch sign-in is unavailable', 'link', 'Tester email sign-in'],
  ] as const)('explains %s on the callback page with a next step', async (code, title, role, action) => {
    vi.mocked(completeTwitchCallback).mockResolvedValue({ status: 'error', purpose: 'signin', code })
    render(<MemoryRouter initialEntries={['/account/twitch/callback']}><AccountTwitchCallback /></MemoryRouter>)
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeTruthy()
    expect(screen.getByRole('alert').textContent!.length).toBeGreaterThan(20)
    expect(screen.getByRole(role, { name: action })).toBeTruthy()
  })

  it('never combines accounts when the identity belongs to another account, and offers another Twitch account', async () => {
    vi.mocked(completeTwitchCallback).mockResolvedValue({ status: 'error', purpose: 'link', code: 'identity_in_use' })
    render(<MemoryRouter initialEntries={['/account/twitch/callback']}><AccountTwitchCallback /></MemoryRouter>)
    expect((await screen.findByRole('alert')).textContent).toBe('That Twitch account already has its own StreamPulse account. We never combine accounts. Contact us if one of them has a membership.')
    fireEvent.click(await screen.findByRole('button', { name: 'Use a different Twitch account' }))
    await waitFor(() => expect(beginTwitchFlow).toHaveBeenCalledWith({ purpose: 'link', returnTo: undefined, forceVerify: true }))
  })

  it('offers Link Twitch in settings and starts a link flow', async () => {
    signedIn()
    vi.mocked(accountRequest).mockImplementation(async path => path === '/me' ? { accountId: 'account-a' } : { devices: [] })
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    const row = await screen.findByTestId('twitch-account-row')
    expect(row.querySelector('h2')?.textContent).toBe('Twitch')
    fireEvent.click(screen.getByRole('button', { name: 'Link Twitch' }))
    await waitFor(() => expect(beginTwitchFlow).toHaveBeenCalledWith({ purpose: 'link' }))
  })

  it('asks for a fresh sign-in when linking needs recent authentication', async () => {
    signedIn()
    vi.mocked(accountRequest).mockImplementation(async path => path === '/me' ? { accountId: 'account-a' } : { devices: [] })
    vi.mocked(beginTwitchFlow).mockRejectedValueOnce(new AccountError(403, 'recent_auth_required'))
    render(<MemoryRouter><AccountSettings /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Link Twitch' }))
    expect(await screen.findByRole('heading', { name: 'Sign in again to link Twitch' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign out and sign in again' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Back to Account & devices' })).toBeNull()
  })

  it('shows the linked Twitch identity after a link, and keeps only connection codes under the tester heading', async () => {
    signedIn()
    rememberTwitchIdentity({ displayName: 'PulseTester', avatarUrl: avatar, via: 'link' })
    vi.mocked(accountRequest).mockImplementation(async path => path === '/me' ? { accountId: 'account-a' } : { devices: [] })
    render(<MemoryRouter initialEntries={[{ pathname: '/account/settings', state: { twitch: 'linked' } }]}><AccountSettings /></MemoryRouter>)
    const row = await screen.findByTestId('twitch-account-row')
    expect(row.textContent).toContain('Twitch linked: PulseTester')
    expect(row.textContent).not.toContain('Signed in with Twitch')
    expect(screen.getByRole('heading', { level: 2, name: 'Linked extensions' })).toBeTruthy()
    const testers = screen.getByTestId('other-ways-to-connect')
    expect(testers.querySelector('h2')?.textContent).toBe('Other ways to connect (testers)')
    expect(testers.querySelector('a')?.getAttribute('href')).toBe('/account/link-device')
    expect(row.querySelector('img')?.getAttribute('src')).toBe(avatar)
    expect(screen.queryByRole('button', { name: 'Link Twitch' })).toBeNull()
    expect(screen.getByText(/Twitch is now linked/)).toBeTruthy()
  })

  it('shows the Twitch name and avatar in the header, and drops them for another session', async () => {
    signedIn()
    vi.mocked(accountRequest).mockResolvedValue({ accountId: 'account-a' })
    rememberTwitchIdentity({ displayName: 'PulseTester', avatarUrl: avatar })
    const view = render(<MemoryRouter><AccountEntry variant="public" /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })
    const trigger = await screen.findByRole('button', { name: 'Account: PulseTester' })
    expect(trigger.querySelector('img')?.getAttribute('src')).toBe(avatar)
    view.unmount()

    resetAccountSessionForTests()
    signedIn('e') // a different session in this browser
    render(<MemoryRouter><AccountEntry variant="public" /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })
    expect(await screen.findByRole('button', { name: 'Account' })).toBeTruthy()
    expect(screen.queryByText('PulseTester')).toBeNull()
  })
})
