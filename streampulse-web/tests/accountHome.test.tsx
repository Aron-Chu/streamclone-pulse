import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountHome from '../src/routes/account/AccountHome'
import { AccountError, accountRequest, billingRequest } from '../src/lib/accountApi'
import { refreshAccountSession, resetAccountSessionForTests } from '../src/lib/accountSession'
import { rememberStepUp } from '../src/lib/accountStepUp'

vi.mock('../src/lib/accountApi', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/accountApi')>(), accountRequest: vi.fn(), billingRequest: vi.fn() }))
vi.mock('../src/ui/components/PublicLayout', () => ({ PublicLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

const CSRF = `__Host-pulse_csrf=${'c'.repeat(64)}`

function serve(answers: Record<string, unknown> = {}) {
  vi.mocked(accountRequest).mockImplementation(async path => {
    const answer = path in answers ? answers[path] : path === '/me' ? { accountId: 'account-a' }
      : path === '/devices' ? { devices: [] }
        : path.startsWith('/history') ? { syncEnabled: false, retentionDays: 90, entries: [] }
          : {}
    if (answer instanceof Error) throw answer
    return answer as Record<string, unknown>
  })
}

async function open() {
  await refreshAccountSession()
  render(<MemoryRouter><AccountHome /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Your data' })
}

beforeEach(() => {
  resetAccountSessionForTests()
  sessionStorage.clear()
  vi.spyOn(document, 'cookie', 'get').mockImplementation(() => CSRF)
  vi.mocked(accountRequest).mockReset()
  vi.mocked(billingRequest).mockReset().mockRejectedValue(new AccountError(404))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); resetAccountSessionForTests() })

describe('actions that need a recent sign-in', () => {
  it('offers Sign in again when export is refused for an old sign-in', async () => {
    serve({ '/export': new AccountError(403, 'recent_auth_required') })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Export my data' }))
    const notice = await screen.findByTestId('recent-sign-in')
    expect(notice.textContent).toContain('For your security, exporting your data needs a sign-in from the last 10 minutes. Nothing was changed.')
    expect(within(notice).getByRole('button', { name: 'Sign in again' })).toBeTruthy()
    expect(document.querySelector('.account-home__error')).toBeNull()
  })

  it('offers Sign in again when deleting is refused, and keeps the confirm step', async () => {
    serve({ '/delete': new AccountError(403, 'recent_auth_required') })
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'delete my account' } })
    fireEvent.click(within(screen.getByRole('group', { name: 'Confirm deleting your account' })).getByRole('button', { name: 'Delete account' }))
    expect((await screen.findByTestId('recent-sign-in')).textContent).toContain('deleting your account needs a sign-in from the last 10 minutes')
    expect(screen.getByRole('group', { name: 'Confirm deleting your account' })).toBeTruthy()
  })

  it('reopens the delete confirm step after signing in again, and deletes nothing by itself', async () => {
    serve()
    await refreshAccountSession()
    rememberStepUp('delete', '/account')
    render(<MemoryRouter><AccountHome /></MemoryRouter>)
    expect(await screen.findByRole('group', { name: 'Confirm deleting your account' })).toBeTruthy()
    expect(accountRequest).not.toHaveBeenCalledWith('/delete', expect.anything())
  })

  it('says to try again after signing in again for export', async () => {
    serve()
    await refreshAccountSession()
    rememberStepUp('export', '/account')
    render(<MemoryRouter><AccountHome /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('You signed in again. You can try that again now.')).toBeTruthy())
    expect(accountRequest).not.toHaveBeenCalledWith('/export')
  })
})

describe('during an outage', () => {
  it('says the browsers list could not load instead of showing none', async () => {
    serve({ '/devices': new AccountError(503, 'request_unavailable') })
    await open()
    expect(await screen.findByText('Your browsers couldn’t load right now. Reload the page to try again.')).toBeTruthy()
  })

  it('does not say Supporter is "Not open yet" when billing is down', async () => {
    serve()
    vi.mocked(billingRequest).mockRejectedValue(new AccountError(503, 'request_unavailable'))
    await open()
    expect(await screen.findByText('Your Supporter status couldn’t load right now.')).toBeTruthy()
    expect(screen.queryByText('Not open yet')).toBeNull()
  })

  it('still says "Not open yet" when billing is not offered', async () => {
    serve()
    await open()
    expect(await screen.findByText('Not open yet')).toBeTruthy()
  })
})
