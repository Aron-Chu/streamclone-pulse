import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountError, accountRequest } from '../src/lib/accountApi'
import { refreshAccountSession, resetAccountSessionForTests } from '../src/lib/accountSession'
import { forgetStepUp, needsRecentSignIn, rememberStepUp, STEP_UP_RESUME_MS, takeStepUp } from '../src/lib/accountStepUp'
import { RecentSignInNotice } from '../src/routes/account/RecentSignIn'

vi.mock('../src/lib/accountApi', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/accountApi')>(), accountRequest: vi.fn() }))

const CSRF = `__Host-pulse_csrf=${'c'.repeat(64)}`
let cookie = ''

beforeEach(() => {
  resetAccountSessionForTests()
  sessionStorage.clear()
  cookie = ''
  vi.spyOn(document, 'cookie', 'get').mockImplementation(() => cookie)
  vi.mocked(accountRequest).mockReset()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('the step-up refusal', () => {
  it('is a 403 recent_auth_required from the account API, nothing else', () => {
    expect(needsRecentSignIn(new AccountError(403, 'recent_auth_required'))).toBe(true)
    expect(needsRecentSignIn(new AccountError(401, 'recent_auth_required'))).toBe(false)
    expect(needsRecentSignIn(new AccountError(403, 'csrf_failed'))).toBe(false)
    expect(needsRecentSignIn(new Error('recent_auth_required'))).toBe(false)
  })
})

describe('reopening the action after signing in again', () => {
  it('gives the action back once, on the same page only', () => {
    rememberStepUp('delete', '/account')
    expect(takeStepUp('/account/settings')).toBeNull()
    expect(takeStepUp('/account')).toBe('delete')
    expect(takeStepUp('/account')).toBeNull()
  })

  it('drops an old, malformed or unknown record', () => {
    vi.useFakeTimers()
    rememberStepUp('export', '/account')
    vi.advanceTimersByTime(STEP_UP_RESUME_MS)
    expect(takeStepUp('/account')).toBeNull()
    sessionStorage.setItem('pulse.account.stepUp.v1', '{nope')
    expect(takeStepUp('/account')).toBeNull()
    sessionStorage.setItem('pulse.account.stepUp.v1', JSON.stringify({ action: 'pay', path: '/account', account: null, at: Date.now() }))
    expect(takeStepUp('/account')).toBeNull()
    expect(sessionStorage.getItem('pulse.account.stepUp.v1')).toBeNull()
  })

  it('never reopens it for a different account', async () => {
    cookie = CSRF
    vi.mocked(accountRequest).mockResolvedValue({ accountId: 'account-a' })
    await refreshAccountSession()
    rememberStepUp('sign-out-everywhere', '/account/settings')
    vi.mocked(accountRequest).mockResolvedValue({ accountId: 'account-b' })
    await refreshAccountSession()
    expect(takeStepUp('/account/settings')).toBeNull()
  })

  it('stores no account ID', async () => {
    cookie = CSRF
    vi.mocked(accountRequest).mockResolvedValue({ accountId: 'account-a' })
    await refreshAccountSession()
    rememberStepUp('delete', '/account')
    expect(sessionStorage.getItem('pulse.account.stepUp.v1')).not.toContain('account-a')
    forgetStepUp()
    expect(sessionStorage.getItem('pulse.account.stepUp.v1')).toBeNull()
  })
})

describe('Sign in again', () => {
  it('starts a forced Twitch sign-in back to the same page for a Twitch account, and remembers the action', async () => {
    vi.stubEnv('VITE_TWITCH_SIGNIN', '1')
    vi.stubEnv('VITE_ACCOUNT_MOMENTS', '1')
    cookie = CSRF
    vi.mocked(accountRequest).mockImplementation(async path => {
      if (path === '/me') return { accountId: 'account-a', signInMethods: ['twitch'] }
      throw new AccountError(503, 'request_unavailable')
    })
    await refreshAccountSession()
    render(<MemoryRouter><RecentSignInNotice what="deleting your account" action="delete" returnTo="/account" /></MemoryRouter>)
    expect(screen.getByTestId('recent-sign-in').textContent).toContain('For your security, deleting your account needs a sign-in from the last 10 minutes. Nothing was changed.')
    fireEvent.click(screen.getByRole('button', { name: /Sign in again/ }))
    await waitFor(() => expect(accountRequest).toHaveBeenCalledWith('/auth/twitch/start', { purpose: 'signin', forceVerify: true }))
    // The start failed here, so nothing is left to reopen and the reason is shown.
    expect(await screen.findByText(/try again/i)).toBeTruthy()
    expect(sessionStorage.getItem('pulse.account.stepUp.v1')).toBeNull()
  })

  it('signs an email account out and opens email sign-in', async () => {
    cookie = CSRF
    vi.mocked(accountRequest).mockResolvedValue({ accountId: 'account-a' })
    await refreshAccountSession()
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    render(<MemoryRouter><RecentSignInNotice what="exporting your data" action="export" returnTo="/account" /></MemoryRouter>)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in again' })) })
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/account/sign-in?method=email'))
    expect(accountRequest).toHaveBeenCalledWith('/auth/logout', {})
    expect(JSON.parse(sessionStorage.getItem('pulse.account.stepUp.v1')!)).toMatchObject({ action: 'export', path: '/account' })
  })
})
