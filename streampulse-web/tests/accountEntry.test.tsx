import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountError, accountRequest } from '../src/lib/accountApi'
import { accountHeaderEnabled } from '../src/lib/accountHeaderFlag'
import { leaveAccountPagesAfterSignOut, resetAccountSessionForTests } from '../src/lib/accountSession'
import { AccountEntry, AccountMenuButton } from '../src/ui/components/AccountEntry'
import { AnalyticsTopNav } from '../src/ui/components/analytics/AnalyticsTopNav'
import { PublicLayout } from '../src/ui/components/PublicLayout'

vi.mock('../src/lib/accountApi', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/accountApi')>(), accountRequest: vi.fn() }))
vi.mock('../src/lib/accountSession', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/accountSession')>(), leaveAccountPagesAfterSignOut: vi.fn() }))

let cookie = ''

beforeEach(() => {
  resetAccountSessionForTests()
  cookie = ''
  vi.spyOn(document, 'cookie', 'get').mockImplementation(() => cookie)
  vi.mocked(accountRequest).mockReset().mockResolvedValue({ accountId: 'account-a', expiresAt: '2027-01-01T00:00:00Z' })
  vi.mocked(leaveAccountPagesAfterSignOut).mockReset()
})

function signedIn() { cookie = `__Host-pulse_csrf=${'d'.repeat(64)}` }

async function renderEntry(path = '/docs') {
  const view = render(<MemoryRouter initialEntries={[path]}><AccountEntry variant="public" /></MemoryRouter>)
  await act(async () => { await Promise.resolve() })
  return view
}

describe('header account entry', () => {
  it('offers a quiet sign-in link to anonymous visitors without any request', async () => {
    await renderEntry()
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/account/sign-in')
    expect(screen.queryByRole('button')).toBeNull()
    expect(accountRequest).not.toHaveBeenCalled()
  })

  it('holds space without an actionable control while a session check runs', () => {
    signedIn()
    vi.mocked(accountRequest).mockReturnValue(new Promise(() => {}))
    const { container } = render(<MemoryRouter><AccountEntry variant="analytics" /></MemoryRouter>)
    expect(container.querySelector('[data-account-entry="checking"]')?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('follows the menu button pattern for a signed-in visitor', async () => {
    signedIn()
    await renderEntry()
    const trigger = screen.getByRole('button', { name: 'Account' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(trigger)
    const menu = screen.getByRole('menu', { name: 'Account' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.getAttribute('aria-controls')).toBe(menu.id)
    const items = screen.getAllByRole('menuitem')
    expect(items.map(item => item.textContent)).toEqual(['Account & devices', 'Membership & billing', 'Sign out'])
    expect(items[0]!.getAttribute('href')).toBe('/account/settings')
    expect(items[1]!.getAttribute('href')).toBe('/account/billing')
    expect(items.every(item => item.tabIndex === -1)).toBe(true)
    expect(document.activeElement).toBe(items[0])

    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1]!, { key: 'End' })
    expect(document.activeElement).toBe(items[2])
    fireEvent.keyDown(items[2]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(items[0]!, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[2])
    fireEvent.keyDown(items[2]!, { key: 'Home' })
    expect(document.activeElement).toBe(items[0])

    fireEvent.keyDown(items[0]!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger)

    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Sign out' }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(trigger)
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0]!, { key: 'Tab', shiftKey: true })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('signs out in place and moves focus to the sign-in link', async () => {
    signedIn()
    await renderEntry('/analytics')
    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    vi.mocked(accountRequest).mockResolvedValueOnce({})
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    const signIn = await screen.findByRole('link', { name: 'Sign in' })
    expect(accountRequest).toHaveBeenLastCalledWith('/auth/logout', {})
    expect(document.activeElement).toBe(signIn)
    expect(leaveAccountPagesAfterSignOut).not.toHaveBeenCalled()
  })

  it('leaves account pages with a full navigation after signing out', async () => {
    signedIn()
    await renderEntry('/account/settings')
    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    vi.mocked(accountRequest).mockResolvedValueOnce({})
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    await waitFor(() => expect(leaveAccountPagesAfterSignOut).toHaveBeenCalledOnce())
  })

  it('keeps the menu and session when signing out fails', async () => {
    signedIn()
    await renderEntry()
    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    vi.mocked(accountRequest).mockRejectedValueOnce(new AccountError(503))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Account services are unavailable right now. Please try again later.')
    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Account' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
  })

  it('renders a provided display name and avatar in the same control', () => {
    render(<MemoryRouter><AccountMenuButton className="account-entry account-entry--public" profile={{ displayName: 'pulse_viewer', avatarUrl: 'https://static-cdn.jtvnw.net/avatar.png' }} /></MemoryRouter>)
    const trigger = screen.getByRole('button', { name: 'Account: pulse_viewer' })
    expect(trigger.querySelector('img')?.getAttribute('alt')).toBe('')
    expect(trigger.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('never renders the account ID', async () => {
    signedIn()
    const { container } = await renderEntry()
    fireEvent.click(screen.getByRole('button', { name: 'Account' }))
    expect(container.innerHTML).not.toContain('account-a')
  })
})

describe('header account entry flag (VITE_ACCOUNT_HEADER)', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('is off unless the build sets exactly "1"', () => {
    vi.stubEnv('VITE_ACCOUNT_HEADER', '')
    expect(accountHeaderEnabled()).toBe(false)
    vi.stubEnv('VITE_ACCOUNT_HEADER', 'true')
    expect(accountHeaderEnabled()).toBe(false)
    vi.stubEnv('VITE_ACCOUNT_HEADER', '1')
    expect(accountHeaderEnabled()).toBe(true)
  })

  it('leaves both headers as on master while off, even for a session cookie holder', async () => {
    vi.stubEnv('VITE_ACCOUNT_HEADER', '')
    signedIn()
    const items = [{ label: 'Home', to: '/analytics', end: true }]
    const publicView = render(<MemoryRouter initialEntries={['/docs']}><PublicLayout><h1>Docs</h1></PublicLayout></MemoryRouter>)
    await act(async () => { await Promise.resolve() })
    const publicHeader = screen.getByRole('banner')
    expect(publicHeader.className).toBe('app-nav')
    expect(publicHeader.querySelector('.account-entry')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Account' })).toBeNull()
    publicView.unmount()

    render(<MemoryRouter><AnalyticsTopNav items={items} /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })
    const analyticsHeader = screen.getByRole('banner')
    expect(analyticsHeader.className).toBe('analytics-topnav')
    expect(analyticsHeader.querySelector('.account-entry')).toBeNull()
    const menu = screen.getByRole('navigation', { name: 'Analytics navigation' })
    // Before the public Twitch stage the menu links no account page at all.
    expect(menu.querySelector('a[href^="/account"]')).toBeNull()
    expect(menu.querySelector('a[href="/account/settings"]')).toBeNull()
    expect(accountRequest).not.toHaveBeenCalled()
  })
})

describe('header placement (VITE_ACCOUNT_HEADER=1)', () => {
  beforeEach(() => { vi.stubEnv('VITE_ACCOUNT_HEADER', '1') })
  afterEach(() => { vi.unstubAllEnvs() })

  it('adds the entry to the public layout header', async () => {
    render(<MemoryRouter initialEntries={['/docs']}><PublicLayout><h1>Docs</h1></PublicLayout></MemoryRouter>)
    expect(screen.getByRole('banner').className).toBe('app-nav app-nav--account')
    expect(screen.getByRole('banner').querySelector('[data-account-entry="signed-out"]')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/account/sign-in')
  })

  it('sends the analytics menu account link where the current state needs it', async () => {
    const items = [{ label: 'Home', to: '/analytics', end: true }]
    const view = render(<MemoryRouter><AnalyticsTopNav items={items} /></MemoryRouter>)
    const menu = () => screen.getByRole('navigation', { name: 'Analytics navigation' })
    expect(menu().querySelector('a[href="/account/sign-in"]')?.textContent).toBe('Sign in')
    expect(menu().querySelector('a[href="/account/settings"]')).toBeNull()
    expect(menu().querySelector('a[href="/account/billing"]')).toBeNull()
    expect(menu().querySelector('a[href="/account/link-device"]')).toBeNull()
    expect(screen.getByRole('banner').className).toBe('analytics-topnav analytics-topnav--account')
    view.unmount()

    resetAccountSessionForTests()
    signedIn()
    render(<MemoryRouter><AnalyticsTopNav items={items} /></MemoryRouter>)
    await act(async () => { await Promise.resolve() })
    expect(menu().querySelector('a[href="/account/sign-in"]')).toBeNull()
    expect(menu().querySelector('a[href="/account/settings"]')?.textContent).toBe('Account & devices')
    expect(menu().querySelector('a[href="/account/billing"]')?.textContent).toBe('Manage subscription')
    expect(menu().querySelector('a[href="/account/link-device"]')).toBeNull()
    expect(screen.getByRole('banner').querySelector('[data-account-entry="signed-in"]')).toBeTruthy()
  })
})
