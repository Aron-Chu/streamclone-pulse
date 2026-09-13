import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import AccountSettings from '../src/routes/account/AccountSettings'
import { accountRequest } from '../src/lib/accountApi'
vi.mock('../src/lib/accountApi', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/accountApi')>(), accountRequest: vi.fn() }))
vi.mock('../src/ui/components/PublicLayout', () => ({ PublicLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

describe('account settings', () => {
 it('shows identity, requires revoke confirmation, and retains retry on failure', async () => {
  vi.mocked(accountRequest).mockImplementation(async (path) => {
   if (path === '/me') return { accountId: 'account-a' }
   if (path === '/devices/revoke') throw new Error('offline')
   return { devices: [{ id: 'device-a', label: 'My extension', expiresAt: '2027-01-01T00:00:00Z' }] }
  })
  render(<MemoryRouter><AccountSettings /></MemoryRouter>)
  expect(await screen.findByText('account-a')).toBeTruthy()
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke My extension' }))
  expect(accountRequest).not.toHaveBeenCalledWith('/devices/revoke', expect.anything())
  fireEvent.click(screen.getByRole('button', { name: 'Confirm revocation' }))
  await waitFor(() => expect(accountRequest).toHaveBeenCalledWith('/devices/revoke', { deviceId: 'device-a' }))
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Confirm revocation' }) as HTMLButtonElement).disabled).toBe(false)
  expect(screen.getByText(/Website saves stay in this browser/)).toBeTruthy()
 })
})
