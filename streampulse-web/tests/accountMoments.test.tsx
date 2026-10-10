import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AccountMoments from '../src/routes/account/AccountMoments'
import { AccountError, accountRequest } from '../src/lib/accountApi'
import { listHistory, listSaves, momentAnalyticsHref, replayHref } from '../src/lib/accountMoments'
import { resetAccountSessionForTests } from '../src/lib/accountSession'
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
})

const page = () => render(<MemoryRouter><AccountMoments /></MemoryRouter>)
describe('My Moments page', () => {
  it('asks a signed-out visitor to sign in and makes no account request', async () => {
    Object.defineProperty(document, 'cookie', { configurable: true, get: () => '' })
    page()
    expect(await screen.findByRole('link', { name: 'Tester sign-in' })).toBeTruthy()
    expect(accountRequest).not.toHaveBeenCalled()
  })

  it('lists saved moments with their notes and links, then history', async () => {
    vi.mocked(accountRequest).mockImplementation(async path => path === '/me' ? { accountId: 'a' }
      : path === '/saves/list' ? { saves: [save] } : { settings: on, entries: [watched] })
    page()
    const row = (await screen.findByText('Chat erupts')).closest('li')!
    expect(within(row).getByText('the clutch')).toBeTruthy()
    expect(within(row).getByRole('link', { name: 'Replay on Twitch' }).getAttribute('href')).toBe('https://www.twitch.tv/videos/1234567890?t=754s')
    expect(within(row).getByRole('link', { name: 'Open in Pulse' }).getAttribute('href')).toBe('/analytics/xqc/123456#t=754')
    fireEvent.click(screen.getByRole('tab', { name: 'History' }))
    expect(await screen.findByText('Opening')).toBeTruthy()
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
    expect(await screen.findByText('Earlier')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Forget all history…' }))
    expect(accountRequest).not.toHaveBeenCalledWith('/history/forget', expect.anything())
    fireEvent.click(screen.getByRole('button', { name: 'Forget history' }))
    await waitFor(() => expect(accountRequest).toHaveBeenCalledWith('/history/forget', {}))
    expect(await screen.findByText(/History forgotten/)).toBeTruthy()
    expect(await screen.findByText(/No history yet/)).toBeTruthy()
  })
})
