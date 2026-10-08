import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AccountPage from '../src/routes/account/AccountPage'
import { accountRequest, AccountError } from '../src/lib/accountApi'
import { clearAccountDeviceCode } from '../src/lib/accountDeviceCode'

// OP1-RES-005 / CX-RES-006 guard: /account/link-device never dead-ends. A failed
// account check offers a retry, and a 401 while reviewing offers sign-in.

vi.mock('../src/lib/accountApi', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/accountApi')>(), accountRequest: vi.fn() }))
vi.mock('../src/lib/accountConfirmation', () => ({ getAccountConfirmation: vi.fn(), clearAccountConfirmation: vi.fn() }))
vi.mock('../src/ui/components/PublicLayout', () => ({ PublicLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

const deviceReply = () => ({ label: 'My extension', expiresAt: new Date(Date.now() + 600000).toISOString() })
const renderLinkDevice = () => render(<MemoryRouter initialEntries={['/account/link-device']}><AccountPage /></MemoryRouter>)

beforeEach(() => {
  clearAccountDeviceCode()
  localStorage.clear()
  vi.mocked(accountRequest).mockReset().mockResolvedValue({})
})

describe('link-device recovery', () => {
  it.each([
    ['500', new AccountError(500, 'internal_error')],
    ['429', new AccountError(429, 'rate_limited')],
  ])('offers Try again after a failed account check (%s) and recovers the code form', async (_status, failure) => {
    let up = false
    vi.mocked(accountRequest).mockImplementation(async path => {
      if (path === '/me') { if (!up) throw failure; return { accountId: 'account-a' } }
      return {}
    })
    renderLinkDevice()
    const retry = await screen.findByRole('button', { name: 'Try again' })
    expect(screen.queryByLabelText('Extension code')).toBeNull()
    up = true
    fireEvent.click(retry)
    expect(await screen.findByLabelText('Extension code')).toBeTruthy()
  })

  it.each(['/device-links/inspect', '/device-links/approve'])('offers sign-in when %s answers 401', async failingPath => {
    vi.mocked(accountRequest).mockImplementation(async path => {
      if (path === '/me') return { accountId: 'account-a' }
      if (path === failingPath) throw new AccountError(401, 'sign_in_required')
      if (path === '/device-links/inspect') return deviceReply()
      return {}
    })
    renderLinkDevice()
    fireEvent.change(await screen.findByLabelText('Extension code'), { target: { value: 'ABCDE-12345' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review extension' }))
    if (failingPath === '/device-links/approve') {
      fireEvent.click(await screen.findByRole('button', { name: 'Approve extension' }))
    }
    expect(await screen.findByRole('heading', { name: 'Sign in to link your extension' })).toBeTruthy()
    expect(screen.getByLabelText('Email address')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Send sign-in link' })).toBeTruthy()
  })
})
