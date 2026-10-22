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
    ['an expired session', new AccountError(401, 'sign_in_required'), 'signed_out'],
    ['a refused session', new AccountError(403), 'signed_out'],
    ['an outage', new AccountError(503), 'checking'],
    ['a network failure', new TypeError('Failed to fetch'), 'checking'],
  ])('reads %s on the first check as %s without logging', async (_, failure, status) => {
    cookie = CSRF
    const consoleError = vi.spyOn(console, 'error')
    const consoleWarn = vi.spyOn(console, 'warn')
    vi.mocked(accountRequest).mockRejectedValue(failure)
    render(<Probe />)
    await flush()
    expect(screen.getByTestId('session').textContent).toBe(status)
    expect(consoleError).not.toHaveBeenCalled()
    expect(consoleWarn).not.toHaveBeenCalled()
  })

  it('says the account cannot be reached when the first check fails, and checks again on Try again', async () => {
    cookie = CSRF
    const seen: unknown[] = []
    function Snapshot() { const session = useAccountSession(); seen.push(session); return null }
    vi.mocked(accountRequest).mockRejectedValueOnce(new AccountError(500))
    render(<Snapshot />)
    await flush()
    expect(seen.at(-1)).toEqual({ status: 'checking', unreachable: true })
    let retry: Promise<void> | undefined
    act(() => { retry = refreshAccountSession() })
    expect(seen.at(-1)).toEqual({ status: 'checking' })
    await act(async () => { await retry })
    expect(seen.at(-1)).toMatchObject({ status: 'signed_in' })
  })

  it('keeps a signed-in session through an outage and asks again on the next focus', async () => {
    cookie = CSRF
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    render(<Probe />)
    await flush()
    expect(screen.getByTestId('session').textContent).toBe('signed_in')
    vi.mocked(accountRequest).mockRejectedValueOnce(new AccountError(500))
    now.mockReturnValue(1_000_000 + ACCOUNT_SESSION_REFRESH_MS)
    act(() => { window.dispatchEvent(new Event('focus')) })
    await flush()
    expect(screen.getByTestId('session').textContent).toBe('signed_in')
    act(() => { window.dispatchEvent(new Event('focus')) })
    await flush()
    expect(accountRequest).toHaveBeenCalledTimes(3)
    expect(screen.getByTestId('session').textContent).toBe('signed_in')
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

describe('signing out clears this browser’s copies', () => {
  it('takes the Viewed list with it (V1)', async () => {
    const { startAccountSaves } = await import('../src/lib/accountSaves')
    startAccountSaves()
    window.localStorage.setItem('sp-moments-viewed', '[]')
    cookie = CSRF
    render(<Probe />)
    await flush()
    await act(async () => { await signOutAccount() })
    expect(window.localStorage.getItem('sp-moments-viewed')).toBeNull()
  })
})

describe('saves made while /me cannot answer', () => {
  it('wait in the outbox for the account this copy belongs to, and reach it once /me answers', async () => {
    const { startAccountSaves, syncAccountSaves } = await import('../src/lib/accountSaves')
    const { savedMomentsNow, toggleSavedMoment } = await import('../src/lib/savedDiscoveryMoments')
    const { fromHubMoment } = await import('../src/lib/discoveryMoments')
    window.localStorage.clear()
    startAccountSaves()
    cookie = CSRF
    let meDown = false
    const sent: Array<Record<string, unknown>> = []
    vi.mocked(accountRequest).mockImplementation(async (path, body) => {
      if (path === '/me') { if (meDown) throw new AccountError(503); return { accountId: 'account-a' } }
      if (path === '/saves/list') return { saves: [] }
      if (path === '/saves/update') {
        const saves = (body as { saves: Array<Record<string, unknown>> }).saves
        sent.push(...saves)
        return { results: saves.map(() => ({ outcome: 'added', save: null })) }
      }
      return {}
    })
    // signed in once: this browser's list is the account's copy
    const first = render(<Probe />)
    await flush()
    await act(async () => { await syncAccountSaves({ force: true }) })
    expect(savedMomentsNow().account).toBe(true)
    first.unmount()
    // a new page while /me is down: the session stays unconfirmed, and a save waits
    resetAccountSessionForTests()
    meDown = true
    render(<Probe />)
    await flush()
    expect(screen.getByTestId('session').textContent).toBe('checking')
    act(() => { toggleSavedMoment(fromHubMoment({ login: 'somestreamer', streamId: '123456', offsetSeconds: 930, label: 'Big one' })!) })
    await flush()
    expect(JSON.parse(window.localStorage.getItem('streampulse.account-saves.v1')!).outbox).toHaveLength(1)
    expect(sent).toHaveLength(0)
    // /me answers on the next focus; the next sync sends it
    meDown = false
    act(() => { window.dispatchEvent(new Event('focus')) })
    await flush()
    expect(screen.getByTestId('session').textContent).toBe('signed_in')
    await act(async () => { await syncAccountSaves({ force: true }) })
    expect(sent).toMatchObject([{ login: 'somestreamer', streamId: '123456', offsetSeconds: 930 }])
  })
})
