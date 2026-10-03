import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AccountPage from '../src/routes/account/AccountPage'
import { accountRequest, AccountError } from '../src/lib/accountApi'
import { clearAccountConfirmation, getAccountConfirmation } from '../src/lib/accountConfirmation'
import { captureAccountDeviceCode, clearAccountDeviceCode, getAccountDeviceCode } from '../src/lib/accountDeviceCode'
import { accountBillingSignInHref, readAccountBillingReturn, rememberAccountBillingReturn } from '../src/lib/accountBillingReturn'

vi.mock('../src/lib/accountApi', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/accountApi')>(), accountRequest: vi.fn() }))
vi.mock('../src/lib/accountConfirmation', () => ({ getAccountConfirmation: vi.fn(), clearAccountConfirmation: vi.fn() }))
vi.mock('../src/ui/components/PublicLayout', () => ({ PublicLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
// Cross-tab sign-in hints, driven by the tests below.
const sessionListeners = new Set<(signal: 'signed-in' | 'signed-out') => void>()
vi.mock('../src/lib/accountSessionSignal', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/accountSessionSignal')>(),
  onAccountSessionSignal: (listener: (signal: 'signed-in' | 'signed-out') => void) => { sessionListeners.add(listener); return () => sessionListeners.delete(listener) },
}))
const signedInElsewhere = async () => { await act(async () => { for (const listener of sessionListeners) listener('signed-in') }) }
const deviceReply = () => ({ label: 'My extension', expiresAt: new Date(Date.now() + 600000).toISOString() })

const returnPath = '/account/billing/return?attempt=12345678-1234-4234-8234-123456789abc'

beforeEach(() => {
  clearAccountDeviceCode()
  localStorage.clear()
  sessionListeners.clear()
  vi.mocked(accountRequest).mockReset().mockResolvedValue({})
  vi.mocked(getAccountConfirmation).mockReturnValue('a'.repeat(64))
  vi.mocked(clearAccountConfirmation).mockClear()
})

describe('prepared extension code', () => {
  it('reviews a prepared code by itself but approves only on an explicit decision', async () => {
    window.history.replaceState(null, '', '/account/link-device#code=ABCDE12345')
    captureAccountDeviceCode()
    vi.mocked(accountRequest).mockImplementation(async path => {
      if (path === '/me') return { accountId: 'account-a' }
      if (path === '/device-links/inspect') return deviceReply()
      return {}
    })
    render(<MemoryRouter initialEntries={['/account/link-device']}><AccountPage /></MemoryRouter>)
    // One consent screen, no separate "Review extension" step for a prepared code.
    expect(await screen.findByRole('heading', { name: 'Allow this extension?' })).toBeTruthy()
    expect(getAccountDeviceCode()).toBe('')
    expect(vi.mocked(accountRequest).mock.calls.filter(([path]) => path === '/device-links/inspect')).toHaveLength(1)
    expect(accountRequest).not.toHaveBeenCalledWith('/device-links/approve', expect.anything())
    expect(screen.getByText('ABCDE-12345')).toBeTruthy()
    expect(screen.getByText(/Check that this code matches the code currently shown in your extension/)).toBeTruthy()
    expect(accountRequest).toHaveBeenCalledWith('/device-links/inspect', { code: 'ABCDE12345' })
    expect(accountRequest).not.toHaveBeenCalledWith('/device-links/approve', expect.anything())
    fireEvent.click(screen.getByRole('button', { name: 'Approve extension' }))
    expect(await screen.findByRole('heading', { name: 'Extension connected' })).toBeTruthy()
    expect(accountRequest).toHaveBeenCalledWith('/device-links/approve', { code: 'ABCDE12345', approve: true })
    window.history.replaceState(null, '', '/')
  })

  it('keeps a blank manual fallback when no code was handed off', async () => {
    render(<MemoryRouter initialEntries={['/account/link-device']}><AccountPage /></MemoryRouter>)
    expect((await screen.findByLabelText('Extension code') as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: 'Review extension' })).toBeTruthy()
  })

  it('signs in on the same tab without persisting or forwarding the prepared code, then continues by itself', async () => {
    window.history.replaceState(null, '', '/account/link-device#code=ABCDE12345')
    captureAccountDeviceCode()
    let signedIn = false
    vi.mocked(accountRequest).mockImplementation(async path => {
      if (path === '/me') { if (!signedIn) throw new AccountError(401, 'sign_in_required'); return { accountId: 'account-a' } }
      if (path === '/device-links/inspect') return deviceReply()
      return {}
    })
    render(<MemoryRouter initialEntries={['/account/link-device']}><AccountPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Sign in to connect your extension' })).toBeTruthy()
    // A first visit is not an error, and the tab never navigates away.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByLabelText('Extension code')).toBeNull()
    expect(getAccountDeviceCode()).toBe('')
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'fixture@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send sign-in link' }))
    expect(await screen.findByTestId('sign-in-waiting')).toBeTruthy()
    // Only the fixed continuation is remembered for the email tab, never the code.
    expect(readAccountBillingReturn()).toBe('/account/link-device')
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('ABCDE12345')
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('fixture@example.com')
    expect(accountRequest).not.toHaveBeenCalledWith('/device-links/inspect', expect.anything())
    signedIn = true
    await signedInElsewhere()
    expect(await screen.findByRole('heading', { name: 'Allow this extension?' })).toBeTruthy()
    expect(accountRequest).toHaveBeenCalledWith('/device-links/inspect', { code: 'ABCDE12345' })
    expect(accountRequest).not.toHaveBeenCalledWith('/device-links/approve', expect.anything())
    window.history.replaceState(null, '', '/')
  })

  it('continues to billing after approval when the extension started a purchase', async () => {
    window.history.replaceState(null, '', '/account/link-device#code=ABCDE12345&then=billing')
    captureAccountDeviceCode()
    vi.mocked(accountRequest).mockImplementation(async path => path === '/device-links/inspect' ? deviceReply() : {})
    function Billing() { return <p>billing:{JSON.stringify(useLocation().state)}</p> }
    render(<MemoryRouter initialEntries={['/account/link-device']}><Routes><Route path="/account/link-device" element={<AccountPage />} /><Route path="/account/billing" element={<Billing />} /></Routes></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Allow this extension?' })).toBeTruthy()
    expect(screen.getByRole('list', { name: 'Progress' }).textContent).toMatch(/Supporter/)
    fireEvent.click(screen.getByRole('button', { name: 'Approve and continue' }))
    expect(await screen.findByText('billing:{"connected":true}')).toBeTruthy()
    expect(accountRequest).toHaveBeenCalledWith('/device-links/approve', { code: 'ABCDE12345', approve: true })
    window.history.replaceState(null, '', '/')
  })

  it('declining never continues to billing', async () => {
    window.history.replaceState(null, '', '/account/link-device#code=ABCDE12345&then=billing')
    captureAccountDeviceCode()
    vi.mocked(accountRequest).mockImplementation(async path => path === '/device-links/inspect' ? deviceReply() : {})
    render(<MemoryRouter initialEntries={['/account/link-device']}><Routes><Route path="/account/link-device" element={<AccountPage />} /><Route path="/account/billing" element={<p>billing</p>} /></Routes></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Decline' }))
    expect(await screen.findByRole('heading', { name: 'Request declined' })).toBeTruthy()
    expect(screen.queryByText('billing')).toBeNull()
    window.history.replaceState(null, '', '/')
  })

  it('asks for a fresh sign-in when the server rejects a request and no recent sign-in is known', async () => {
    window.history.replaceState(null, '', '/account/link-device#code=ABCDE12345')
    captureAccountDeviceCode()
    let fresh = false
    vi.mocked(accountRequest).mockImplementation(async path => {
      if (path === '/device-links/inspect') { if (!fresh) throw new AccountError(401, 'link_invalid_or_expired'); return deviceReply() }
      return {}
    })
    render(<MemoryRouter initialEntries={['/account/link-device']}><AccountPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Confirm it’s you' })).toBeTruthy()
    expect(screen.getByText(/needs a sign-in from the last 10 minutes/)).toBeTruthy()
    // Focus alone never spends the small inspection allowance again.
    await act(async () => { window.dispatchEvent(new Event('focus')) })
    expect(vi.mocked(accountRequest).mock.calls.filter(([path]) => path === '/device-links/inspect')).toHaveLength(1)
    fresh = true
    await signedInElsewhere()
    expect(await screen.findByRole('heading', { name: 'Allow this extension?' })).toBeTruthy()
    expect(vi.mocked(accountRequest).mock.calls.filter(([path]) => path === '/device-links/inspect')).toHaveLength(2)
    window.history.replaceState(null, '', '/')
  })

  it('treats a rejected request after a recent sign-in as an expired code with a manual fallback', async () => {
    localStorage.setItem('pulse.account.signedInAt.v1', String(Date.now() - 60_000))
    window.history.replaceState(null, '', '/account/link-device#code=ABCDE12345')
    captureAccountDeviceCode()
    vi.mocked(accountRequest).mockImplementation(async path => {
      if (path === '/device-links/inspect') throw new AccountError(401, 'link_invalid_or_expired')
      return {}
    })
    render(<MemoryRouter initialEntries={['/account/link-device']}><AccountPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'This request is no longer valid' })).toBeTruthy()
    // The failed prepared code is not offered for resubmission.
    expect((screen.getByLabelText('Extension code') as HTMLInputElement).value).toBe('')
    expect(screen.queryByRole('heading', { name: 'Confirm it’s you' })).toBeNull()
    window.history.replaceState(null, '', '/')
  })
})

describe('private pilot sign-in copy', () => {
  const note = 'During the private pilot, sign-in emails are sent only to invited testers. If you’re not on the list, you won’t receive an email.'

  it('shows the same neutral pilot note for every address, before and after sending', async () => {
    const seen: string[] = []
    for (const email of ['listed@example.com', 'unlisted@example.org']) {
      const view = render(<MemoryRouter initialEntries={['/account/sign-in']}><AccountPage /></MemoryRouter>)
      seen.push(screen.getByTestId('pilot-sign-in-note').textContent ?? '')
      fireEvent.change(screen.getByLabelText('Email address'), { target: { value: email } })
      fireEvent.click(screen.getByRole('button', { name: 'Send sign-in link' }))
      expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeTruthy()
      seen.push(screen.getByTestId('pilot-sign-in-note').textContent ?? '')
      // The confirmation never echoes the address, so it cannot differ per address.
      expect(document.body.textContent).not.toContain(email)
      view.unmount()
    }
    expect(new Set(seen)).toEqual(new Set([note]))
  })
})

describe('billing sign-in continuation', () => {
  it('remembers billing only after a sign-in email is accepted', async () => {
    render(<MemoryRouter initialEntries={[accountBillingSignInHref(returnPath)]}><AccountPage /></MemoryRouter>)
    expect(readAccountBillingReturn()).toBeNull()
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'fixture@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send sign-in link' }))
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeTruthy()
    expect(accountRequest).toHaveBeenCalledWith('/auth/start', { email: 'fixture@example.com' })
    expect(readAccountBillingReturn()).toBe(returnPath)
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('fixture@example.com')
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain('a'.repeat(64))
  })

  it('does not save billing context when email delivery fails', async () => {
    vi.mocked(accountRequest).mockRejectedValue(new AccountError(503, 'delivery_unavailable'))
    render(<MemoryRouter initialEntries={[accountBillingSignInHref(returnPath)]}><AccountPage /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'fixture@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send sign-in link' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(readAccountBillingReturn()).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Check your email' })).toBeNull()
  })

  it.each(['/account/sign-in', '/account/sign-in?returnTo=https%3A%2F%2Fevil.test'])('clears stale billing context for %s', async path => {
    rememberAccountBillingReturn(returnPath)
    render(<MemoryRouter initialEntries={[path]}><AccountPage /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'fixture@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send sign-in link' }))
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeTruthy()
    expect(readAccountBillingReturn()).toBeNull()
  })

  it('requires explicit confirmation, then offers the saved billing attempt instead of device linking', async () => {
    rememberAccountBillingReturn(returnPath)
    render(<MemoryRouter initialEntries={['/account/confirm']}><AccountPage /></MemoryRouter>)
    expect(accountRequest).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Request another sign-in link' }).getAttribute('href')).toBe(accountBillingSignInHref(returnPath))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm sign-in' }))
    expect(await screen.findByRole('heading', { name: 'You’re signed in' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Continue to billing' }).getAttribute('href')).toBe(returnPath)
    expect(screen.queryByRole('link', { name: 'Link extension' })).toBeNull()
    expect(accountRequest).toHaveBeenCalledWith('/auth/complete', { secret: 'a'.repeat(64), confirmed: true })
    expect(clearAccountConfirmation).toHaveBeenCalledOnce()
    expect(readAccountBillingReturn()).toBeNull()
  })

  it('retains the destination for a failed confirmation and retry', async () => {
    rememberAccountBillingReturn(returnPath)
    vi.mocked(accountRequest).mockRejectedValueOnce(new AccountError(503)).mockResolvedValueOnce({})
    render(<MemoryRouter initialEntries={['/account/confirm']}><AccountPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm sign-in' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(readAccountBillingReturn()).toBe(returnPath)
    expect(clearAccountConfirmation).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm sign-in' }))
    expect(await screen.findByRole('link', { name: 'Continue to billing' })).toBeTruthy()
    expect(readAccountBillingReturn()).toBeNull()
  })

  it('offers recovery when the backend rejects an expired sign-in link with 401', async () => {
    vi.mocked(accountRequest).mockRejectedValue(new AccountError(401, 'link_invalid_or_expired'))
    render(<MemoryRouter initialEntries={['/account/confirm']}><AccountPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm sign-in' }))
    expect((await screen.findByRole('alert')).textContent).toBe('This link has expired or is no longer valid. Request a new sign-in link.')
    expect(screen.getByRole('link', { name: 'Request another sign-in link' })).toBeTruthy()
    expect(clearAccountConfirmation).not.toHaveBeenCalled()
  })

  it('rechecks hint expiry at confirmation rather than trusting mount-time state', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    rememberAccountBillingReturn(returnPath)
    render(<MemoryRouter initialEntries={['/account/confirm']}><AccountPage /></MemoryRouter>)
    now.mockReturnValue(1_900_000)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm sign-in' }))
    await waitFor(() => expect(screen.getByRole('link', { name: 'Link extension' })).toBeTruthy())
    expect(screen.queryByRole('link', { name: 'Continue to billing' })).toBeNull()
  })

  it('announces sign-in and sends a link-device continuation back to the waiting tab', async () => {
    rememberAccountBillingReturn('/account/link-device')
    render(<MemoryRouter initialEntries={['/account/confirm']}><AccountPage /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm sign-in' }))
    expect(await screen.findByRole('heading', { name: 'You’re signed in' })).toBeTruthy()
    expect(screen.getByText(/Go back to the StreamPulse tab where you started/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'enter the extension code here' }).getAttribute('href')).toBe('/account/link-device')
    // A timestamp only: no identity, address or secret.
    expect(Number(localStorage.getItem('pulse.account.signedInAt.v1'))).toBeGreaterThan(0)
    expect(JSON.stringify({ ...localStorage })).not.toContain('a'.repeat(64))
    expect(readAccountBillingReturn()).toBeNull()
  })

  it('preserves retry context for a missing email token without completing sign-in', () => {
    vi.mocked(getAccountConfirmation).mockReturnValue(null)
    rememberAccountBillingReturn(returnPath)
    render(<MemoryRouter initialEntries={['/account/confirm']}><AccountPage /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'Confirm sign-in' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Request another sign-in link' }).getAttribute('href')).toBe(accountBillingSignInHref(returnPath))
    expect(accountRequest).not.toHaveBeenCalled()
  })
})

describe('approval names its account and recognises old requests', () => {
  it('shows which account the extension will join', async () => {
    window.history.replaceState(null, '', '/account/link-device#code=ABCDE12345')
    captureAccountDeviceCode()
    vi.mocked(accountRequest).mockImplementation(async path => path === '/me' ? { accountId: '11111111-1111-4111-8111-1111111a1b2c' } : path === '/device-links/inspect' ? deviceReply() : {})
    render(<MemoryRouter initialEntries={['/account/link-device']}><AccountPage /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Allow this extension?' })).toBeTruthy()
    expect(screen.getByTestId('link-account').textContent).toContain('··1a1b2c')
    window.history.replaceState(null, '', '/')
  })

  it('calls a request from a tab left open past ten minutes invalid instead of asking for a sign-in', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(5_000_000)
    window.history.replaceState(null, '', '/account/link-device#code=ABCDE12345')
    captureAccountDeviceCode()
    let signedIn = false
    vi.mocked(accountRequest).mockImplementation(async path => {
      if (path === '/me') { if (!signedIn) throw new AccountError(401, 'sign_in_required'); return { accountId: 'account-a' } }
      if (path === '/device-links/inspect') throw new AccountError(401, 'link_invalid_or_expired')
      return {}
    })
    try {
      render(<MemoryRouter initialEntries={['/account/link-device']}><AccountPage /></MemoryRouter>)
      expect(await screen.findByRole('heading', { name: 'Sign in to connect your extension' })).toBeTruthy()
      now.mockReturnValue(5_000_000 + 11 * 60_000)
      signedIn = true
      await signedInElsewhere()
      expect(await screen.findByRole('heading', { name: 'This request is no longer valid' })).toBeTruthy()
      expect(screen.queryByRole('heading', { name: 'Confirm it’s you' })).toBeNull()
      // A code typed afterwards is the user's own and is kept for correction
      // (the real sign-in in the email tab recorded its time).
      localStorage.setItem('pulse.account.signedInAt.v1', String(Date.now()))
      fireEvent.change(screen.getByLabelText('Extension code'), { target: { value: 'FFFFF-00000' } })
      fireEvent.click(screen.getByRole('button', { name: 'Review extension' }))
      await waitFor(() => expect(accountRequest).toHaveBeenCalledWith('/device-links/inspect', { code: 'FFFFF00000' }))
      expect((screen.getByLabelText('Extension code') as HTMLInputElement).value).toBe('FFFFF-00000')
    } finally {
      now.mockRestore()
      window.history.replaceState(null, '', '/')
    }
  })
})
