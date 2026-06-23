import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearBetaKey,
  getBetaKey,
  hash16,
  maskBetaKey,
  refreshPrincipal,
  setBetaKey,
} from '../src/lib/auth'
import { AppRoutes } from '../src/routes/index'

describe('auth', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    clearBetaKey()
  })

  it('hash16 is deterministic for the same key', async () => {
    const first = await hash16('PULSE-test-key')
    const second = await hash16('PULSE-test-key')
    expect(first).toBe(second)
    expect(first).toHaveLength(16)
  })

  it('stores and clears beta key in localStorage', async () => {
    await setBetaKey('PULSE-AAAA-BBBB-CCCC')
    expect(getBetaKey()).toBe('PULSE-AAAA-BBBB-CCCC')
    clearBetaKey()
    expect(getBetaKey()).toBe('')
  })

  it('derives stable principal id after setBetaKey', async () => {
    await setBetaKey('secret-key')
    const principal = await refreshPrincipal()
    expect(principal).toEqual({ id: await hash16('secret-key'), kind: 'beta' })
  })

  it('masks beta keys for display', () => {
    expect(maskBetaKey('PULSE-1234-5678-9012')).toBe('PULSE-••••-••••-9012')
  })

  it('redirects unauthenticated dashboard access to login', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: /connect streampulse/i })).toBeTruthy()
  })
})
