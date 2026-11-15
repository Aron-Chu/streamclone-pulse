import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountMoments from '../src/routes/account/AccountMoments'
import { AccountError, accountRequest } from '../src/lib/accountApi'
import { listHistory, listSaves, momentAnalyticsHref, momentTimestamp, replayHref } from '../src/lib/accountMoments'
import { resetAccountSessionForTests } from '../src/lib/accountSession'
import { rememberStepUp } from '../src/lib/accountStepUp'
import { formatSavedAt } from '@streampulse/pulse-core'
vi.mock('../src/lib/accountApi', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/accountApi')>(), accountRequest: vi.fn() }))
vi.mock('../src/ui/components/PublicLayout', () => ({ PublicLayout: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

const CSRF = '__Host-pulse_csrf=' + 'a'.repeat(64)
const save = { id: 'b1', login: 'xqc', streamId: '123456', vodId: '1234567890', offsetSeconds: 754, label: 'Chat erupts', notes: 'the clutch', createdAt: '2026-10-02T18:00:00Z' }
const watched = { key: 'xqc:123456:90', login: 'xqc', streamId: '123456', offsetSeconds: 90, title: 'Opening', jumpedAt: '2026-10-03T10:00:00Z', expiresAt: '2026-11-02T10:00:00Z' }
const on = { syncEnabled: true, retentionDays: 30 }

beforeEach(() => {
  resetAccountSessionForTests()
  Object.defineProperty(document, 'cookie', { configurable: true, get: () => CSRF })
})
afterEach(() => { vi.mocked(accountRequest).mockReset(); Reflect.deleteProperty(document, 'cookie') })

describe('account moments API', () => {
  it('keeps well-formed rows and their page cursors, and skips malformed ones', async () => {
    vi.mocked(accountRequest).mockImplementation(async path => path === '/saves/list'
      ? { saves: [save, { ...save, id: 'b2', login: 'Bad Login' }, { ...save, id: 'b3', streamId: undefined, vodId: undefined }], next: 'c1' }
      : { settings: on, entries: [watched, { ...watched, offsetSeconds: -1 }] })
    expect(await listSaves()).toEqual({ saves: [{ key: 'b1', login: 'xqc', streamId: '123456', vodId: '1234567890', offsetSeconds: 754, title: 'Chat erupts', notes: 'the clutch', at: Date.parse(save.createdAt) }], next: 'c1' })
    expect((await listHistory('p2')).entries.map(e => e.key)).toEqual(['xqc:123456:90'])
    expect(accountRequest).toHaveBeenLastCalledWith('/history/list', { before: 'p2' })
  })
  it('refuses a reply without valid settings', async () => {
    vi.mocked(accountRequest).mockResolvedValue({ settings: { syncEnabled: true, retentionDays: 14 }, entries: [] })
    await expect(listHistory()).rejects.toMatchObject({ status: 503 })
  })
  it('links a VOD to its second and a stream to Pulse', () => {
    expect(replayHref({ vodId: '1234567890', offsetSeconds: 754.9 })).toBe('https://www.twitch.tv/videos/1234567890?t=754s')
    expect(replayHref({ offsetSeconds: 1 })).toBeNull()
    expect(momentAnalyticsHref({ login: 'xqc', streamId: '123456', offsetSeconds: 754 })).toBe('/analytics/xqc/123456#t=754')
  })
  it('says about for a save made on the site, which knows only its minute (K1)', async () => {
    vi.mocked(accountRequest).mockResolvedValue({ saves: [{ ...save, offsetSeconds: 720, source: 'web' }, { ...save, id: 'b2', source: 'extension' }, { ...save, id: 'b3', source: 'other' }] })
    const saves = (await listSaves()).saves
    expect(saves.map(s => s.source)).toEqual(['web', 'extension', undefined])
    expect(saves.map(momentTimestamp)).toEqual(['about 0:12:00', '0:12:34', '0:12:34'])
  })
})

const page = () => render(<MemoryRouter><AccountMoments /></MemoryRouter>)
describe('My Moments page', () => {
  it('asks a signed-out visitor to sign in and makes no account request', async () => {
    Object.defineProperty(document, 'cookie', { configurable: true, get: () => '' })
    page()
    expect(await screen.findByRole('link', { name: 'Sign in to Pulse' })).toBeTruthy()
    expect(accountRequest).not.toHaveBeenCalled()
  })

  it('lists saved moments with their notes and links, then history', async () => {
    vi.mocked(accountRequest).mockImplementation(async path => path === '/me' ? { accountId: 'a' }
      : path === '/saves/list' ? { saves: [save] } : { settings: on, entries: [watched] })
    page()
    const row = (await screen.findByText('xqc Chat erupts')).closest('li')!
    expect(within(row).getByText('the clutch')).toBeTruthy()
    // each link names its moment, and the Twitch one says it opens a new tab (MY-MOMENTS-8); 'Analytics' as elsewhere (Z07)
    expect(within(row).getByRole('link', { name: 'Replay on Twitch: xqc Chat erupts (opens in a new tab)' }).getAttribute('href')).toBe('https://www.twitch.tv/videos/1234567890?t=754s')
    expect(within(row).getByRole('link', { name: 'Analytics: xqc Chat erupts' }).getAttribute('href')).toBe('/analytics/xqc/123456#t=754')
    expect(within(row).getByText('Analytics')).toBeTruthy()
    // h:mm:ss through pulse-core (K1), the saved date without seconds (Z08)
    expect(within(row).getByText(/^0:12:34 · Saved /).textContent).toBe(`0:12:34 · Saved ${formatSavedAt(Date.parse(save.createdAt))}`)
    expect(screen.getByText('Notes, removing and search live in the extension’s My Moments.')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'History' }))
    expect(await screen.findByText('xqc Opening')).toBeTruthy()
    expect(screen.getByText(/Kept for 30 days/)).toBeTruthy()
  })

  it('explains where to turn history sync on', async () => {
    vi.mocked(accountRequest).mockImplementation(async path => path === '/me' ? { accountId: 'a' } : path === '/saves/list' ? { saves: [] } : { settings: { syncEnabled: false, retentionDays: 30 }, entries: [] })
    page()
    fireEvent.click(await screen.findByRole('tab', { name: 'History' }))
    expect(await screen.findByText('History sync is off.')).toBeTruthy()
    expect(screen.getByText(/Sync watched history to your account/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Forget/ })).toBeNull()
  })

  it('says when the server does not offer it yet', async () => {
    vi.mocked(accountRequest).mockImplementation(async path => { if (path === '/me') return { accountId: 'a' }; throw new AccountError(404, 'not_found') })
    page()
    expect(await screen.findByText(/not available yet/)).toBeTruthy()
  })

  it('forgets history only after confirming, and pages with the server cursor', async () => {
    let entries = [watched]
    vi.mocked(accountRequest).mockImplementation(async (path, body) => {
      if (path === '/me') return { accountId: 'a' }
      if (path === '/saves/list') return { saves: [] }
      if (path === '/history/forget') { entries = []; return {} }
      return body?.before === 'n1' ? { settings: on, entries: [{ ...watched, key: 'xqc:123456:10', offsetSeconds: 10, title: 'Earlier' }] } : { settings: on, entries, ...(entries.length ? { next: 'n1' } : {}) }
    })
    page()
    fireEvent.click(await screen.findByRole('tab', { name: 'History' }))
    fireEvent.click(await screen.findByRole('button', { name: 'More history' }))
    expect(await screen.findByText('xqc Earlier')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Forget all history…' }))
    expect(accountRequest).not.toHaveBeenCalledWith('/history/forget', expect.anything())
    fireEvent.click(screen.getByRole('button', { name: 'Forget history' }))
    await waitFor(() => expect(accountRequest).toHaveBeenCalledWith('/history/forget', {}))
    expect(await screen.findByText(/History forgotten/)).toBeTruthy()
    expect(await screen.findByText(/No history yet/)).toBeTruthy()
  })

  const historyServer = (forget: () => unknown) => vi.mocked(accountRequest).mockImplementation(async path => {
    if (path === '/me') return { accountId: 'a' }
    if (path === '/saves/list') return { saves: [] }
    if (path === '/history/forget') { const result = forget(); if (result instanceof Error) throw result; return {} }
    return { settings: on, entries: [watched] }
  })

  it('asks for a recent sign-in when forgetting is refused for an old one', async () => {
    historyServer(() => new AccountError(403, 'recent_auth_required'))
    page()
    fireEvent.click(await screen.findByRole('tab', { name: 'History' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Forget all history…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Forget history' }))
    const notice = await screen.findByTestId('recent-sign-in')
    expect(notice.textContent).toContain('For your security, forgetting watched history needs a sign-in from the last 10 minutes. Nothing was changed.')
    expect(within(notice).getByRole('button', { name: 'Sign in again' })).toBeTruthy()
  })

  it('opens History with the confirm step after signing in again, and forgets nothing by itself', async () => {
    historyServer(() => ({}))
    sessionStorage.clear()
    rememberStepUp('history-forget', '/account/moments')
    page()
    expect(await screen.findByRole('group', { name: 'Confirm forgetting history' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe('true')
    expect(accountRequest).not.toHaveBeenCalledWith('/history/forget', expect.anything())
  })
})

describe('My Moments page: keeping your place (11-13)', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => ({ ...save, id: `b${i}`, label: `Moment ${i}`, offsetSeconds: 60 * i }))

  it('keeps the rows when More saves fails, says so by the button, and keeps focus there (MY-MOMENTS-2)', async () => {
    vi.mocked(accountRequest).mockImplementation(async (path, body) => {
      if (path === '/me') return { accountId: 'a' }
      if (path === '/saves/list' && body?.before === 'n1') throw new AccountError(503)
      return path === '/saves/list' ? { saves: twenty, next: 'n1' } : { settings: on, entries: [] }
    })
    page()
    const more = await screen.findByRole('button', { name: 'More saves' })
    more.focus()
    fireEvent.click(more)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getAllByText(/^xqc Moment \d+$/)).toHaveLength(20)
    expect(screen.getByRole('button', { name: 'More saves' })).toBe(document.activeElement)
  })

  it('moves focus to the first new row when the last page arrives, and says how many (J1)', async () => {
    vi.mocked(accountRequest).mockImplementation(async (path, body) => {
      if (path === '/me') return { accountId: 'a' }
      if (path === '/saves/list') return body?.before === 'n1' ? { saves: [{ ...save, id: 'b99', label: 'Last one' }] } : { saves: twenty, next: 'n1' }
      return { settings: on, entries: [] }
    })
    page()
    const more = await screen.findByRole('button', { name: 'More saves' })
    more.focus()
    fireEvent.click(more)
    expect(await screen.findByText('1 more save loaded.')).toBeTruthy()
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Replay on Twitch: xqc Last one (opens in a new tab)'))
  })

  it('offers Sign in again with Retry when the session expired, and focuses it (MY-MOMENTS-3)', async () => {
    vi.mocked(accountRequest).mockImplementation(async path => { if (path === '/me') return { accountId: 'a' }; throw new AccountError(401) })
    page()
    const link = await screen.findByRole('link', { name: 'Sign in again' })
    expect(link.getAttribute('href')).toBe('/account/sign-in')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(link))
  })

  it('keeps each tab’s list when switching back, rather than loading page one again (MY-MOMENTS-9)', async () => {
    vi.mocked(accountRequest).mockImplementation(async path => path === '/me' ? { accountId: 'a' }
      : path === '/saves/list' ? { saves: [save] } : { settings: on, entries: [watched] })
    page()
    await screen.findByText('xqc Chat erupts')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Saved' }), { key: 'ArrowRight' })
    expect(await screen.findByText('xqc Opening')).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'History' }), { key: 'ArrowLeft' })
    expect(screen.getByText('xqc Chat erupts')).toBeTruthy()
    expect(screen.queryByText('Loading your saves…')).toBeNull()
    expect(vi.mocked(accountRequest).mock.calls.filter(([path]) => path === '/saves/list')).toHaveLength(1)
    // the other panel stays mounted and hidden
    const panels = [...document.querySelectorAll<HTMLElement>('[role="tabpanel"]')]
    expect(panels).toHaveLength(2)
    expect(panels.map(panel => panel.hidden)).toEqual([false, true])
  })
})
