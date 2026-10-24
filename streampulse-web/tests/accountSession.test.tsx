import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountError, accountRequest } from '../src/lib/accountApi'
import {
  ACCOUNT_SESSION_REFRESH_MS,
  refreshAccountSession,
  resetAccountSessionForTests,
  signOutAccount,
  useAccountSession,
} from '../src/lib/accountSession'

vi.mock('../src/lib/accountApi', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/accountApi')>(), accountRequest: vi.fn() }))

const CSRF = `__Host-pulse_csrf=${'c'.repeat(64)}`
let cookie = ''

function Probe({ id = 'session' }: { id?: string }) {
  return <output data-testid={id}>{useAccountSession().status}</output>
}

const flush = () => act(async () => { await Promise.resolve() })

beforeEach(() => {
  resetAccountSessionForTests()
  cookie = ''
  vi.spyOn(document, 'cookie', 'get').mockImplementation(() => cookie)
  vi.mocked(accountRequest).mockReset().mockResolvedValue({ accountId: 'account-a', expiresAt: '2027-01-01T00:00:00Z' })
})

describe('account session hint', () => {
  it('treats a visitor without the CSRF cookie as signed out without any request, even on focus', async () => {
    cookie = 'other=1; __Host-pulse_csrf=not-a-token'
    render(<Probe />)
    expect(screen.getByTestId('session').textContent).toBe('signed_out')
    act(() => { window.dispatchEvent(new Event('focus')) })
    await flush()
    expect(accountRequest).not.toHaveBeenCalled()
  })

  it('checks /me once per page for a cookie holder and shares the answer', async () => {
    cookie = `theme=dark; ${CSRF}`
    const view = render(<><Probe id="a" /><Probe id="b" /></>)
    expect(screen.getByTestId('a').textContent).toBe('checking')
    await flush()
    expect(screen.getByTestId('a').textContent).toBe('signed_in')
    expect(screen.getByTestId('b').textContent).toBe('signed_in')
    view.unmount()
    render(<Probe id="later" />)
    expect(screen.getByTestId('later').textContent).toBe('signed_in')
    expect(accountRequest).toHaveBeenCalledTimes(1)
    expect(accountRequest).toHaveBeenCalledWith('/me')
  })

  it.each([
    ['an expired session', new AccountError(401, 'sign_in_required')],
    ['an outage', new AccountError(503)],
    ['a network failure', new TypeError('Failed to fetch')],
  ])('reads %s as signed out without logging', async (_, failure) => {
    cookie = CSRF
    const consoleError = vi.spyOn(console, 'error')
    const consoleWarn = vi.spyOn(console, 'warn')
    vi.mocked(accountRequest).mockRejectedValue(failure)
    render(<Probe />)
    await flush()
    expect(screen.getByTestId('session').textContent).toBe('signed_out')
    expect(consoleError).not.toHaveBeenCalled()
    expect(consoleWarn).not.toHaveBeenCalled()
  })

  it('marks a linked Twitch identity from /me without any name or picture', async () => {
    cookie = CSRF
    vi.mocked(accountRequest).mockResolvedValue({ accountId: 'account-a', expiresAt: '2027-01-01T00:00:00Z', signInMethods: ['email', 'twitch'] })
    function Linked() {
      const session = useAccountSession()
      return <output data-testid="linked">{session.status === 'signed_in' ? String(Boolean(session.profile.twitchLinked)) : session.status}</output>
    }
    render(<Linked />)
    await flush()
    await flush()
    expect(screen.getByTestId('linked').textContent).toBe('true')
  })

  it('does not accept a response without an account as a session', async () => {
    cookie = CSRF
    vi.mocked(accountRequest).mockResolvedValue({})
    render(<Probe />)
    await flush()
    expect(screen.getByTestId('session').textContent).toBe('signed_out')
  })

  it('re-checks on focus at most once a minute', async () => {
    cookie = CSRF
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    render(<Probe />)
    await flush()
    act(() => { window.dispatchEvent(new Event('focus')) })
    now.mockReturnValue(1_000_000 + ACCOUNT_SESSION_REFRESH_MS - 1)
    act(() => { window.dispatchEvent(new Event('focus')) })
    await flush()
    expect(accountRequest).toHaveBeenCalledTimes(1)
    vi.mocked(accountRequest).mockRejectedValueOnce(new AccountError(401))
    now.mockReturnValue(1_000_000 + ACCOUNT_SESSION_REFRESH_MS)
    act(() => { window.dispatchEvent(new Event('focus')) })
    await flush()
    expect(accountRequest).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('session').textContent).toBe('signed_out')
  })

  it('notices on focus, without a request, that another tab cleared the cookies', async () => {
    cookie = CSRF
    render(<Probe />)
    await flush()
    cookie = ''
    act(() => { window.dispatchEvent(new Event('focus')) })
    expect(screen.getByTestId('session').textContent).toBe('signed_out')
    expect(accountRequest).toHaveBeenCalledTimes(1)
  })

  it('lets a forced refresh supersede an answer still in flight', async () => {
    cookie = CSRF
    let rejectFirst: (reason: unknown) => void = () => {}
    vi.mocked(accountRequest).mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject }))
    render(<Probe />)
    await act(async () => { await refreshAccountSession() })
    expect(screen.getByTestId('session').textContent).toBe('signed_in')
    await act(async () => { rejectFirst(new AccountError(401)) })
    expect(screen.getByTestId('session').textContent).toBe('signed_in')
  })
})

describe('signing out', () => {
  it('ends the session through the logout API and treats an unknown session as already ended', async () => {
    cookie = CSRF
    render(<Probe />)
    await flush()
    vi.mocked(accountRequest).mockRejectedValueOnce(new AccountError(401))
    await act(async () => { await signOutAccount() })
    expect(accountRequest).toHaveBeenLastCalledWith('/auth/logout', {})
    expect(screen.getByTestId('session').textContent).toBe('signed_out')
  })

  it('keeps the session when the logout request fails', async () => {
    cookie = CSRF
    render(<Probe />)
    await flush()
    vi.mocked(accountRequest).mockRejectedValueOnce(new AccountError(503))
    await act(async () => { await expect(signOutAccount()).rejects.toMatchObject({ status: 503 }) })
    expect(screen.getByTestId('session').textContent).toBe('signed_in')
  })
})
