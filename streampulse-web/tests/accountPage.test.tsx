import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AccountPage from '../src/routes/account/AccountPage'
import { accountRequest, AccountError } from '../src/lib/accountApi'
import { clearAccountConfirmation, getAccountConfirmation } from '../src/lib/accountConfirmation'
import { accountBillingSignInHref, readAccountBillingReturn, rememberAccountBillingReturn } from '../src/lib/accountBillingReturn'

vi.mock('../src/lib/accountApi', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/accountApi')>(), accountRequest: vi.fn() }))
vi.mock('../src/lib/accountConfirmation', () => ({ getAccountConfirmation: vi.fn(), clearAccountConfirmation: vi.fn() }))
vi.mock('../src/ui/components/PublicLayout', () => ({ PublicLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

const returnPath = '/account/billing/return?attempt=12345678-1234-4234-8234-123456789abc'

beforeEach(() => {
  vi.mocked(accountRequest).mockReset().mockResolvedValue({})
  vi.mocked(getAccountConfirmation).mockReturnValue('a'.repeat(64))
  vi.mocked(clearAccountConfirmation).mockClear()
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

  it('preserves retry context for a missing email token without completing sign-in', () => {
    vi.mocked(getAccountConfirmation).mockReturnValue(null)
    rememberAccountBillingReturn(returnPath)
    render(<MemoryRouter initialEntries={['/account/confirm']}><AccountPage /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'Confirm sign-in' })).toBeNull()
    expect(screen.getByRole('link', { name: 'Request another sign-in link' }).getAttribute('href')).toBe(accountBillingSignInHref(returnPath))
    expect(accountRequest).not.toHaveBeenCalled()
  })
})
