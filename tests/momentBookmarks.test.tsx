// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveHeatPoint } from '@streampulse/pulse-core'
import { ChartMinuteInspectCard } from '../src/ui/ChartMinuteInspectCard.tsx'
import { MomentBookmarkToast, MomentBookmarksProvider, MyMomentsLink, matchBookmark } from '../src/ui/momentBookmarks.tsx'
import { PulseMomentRow } from '../src/ui/PulseMomentRow.tsx'
import { SelectedMomentCard } from '../src/ui/SelectedMomentCard.tsx'
import { sendBackgroundMessage } from '../src/content/bridge.ts'
import type { PulseBookmark } from '../src/shared/messages.ts'
vi.mock('../src/content/bridge.ts', () => ({ sendBackgroundMessage: vi.fn() }))
// Sign in with Twitch is a compile-time switch; each test picks the build it describes.
const signIn = vi.hoisted(() => ({ on: true }))
vi.mock('../src/shared/twitchSignIn.ts', () => ({ get TWITCH_SIGNIN_ENABLED() { return signIn.on } }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const point = { offsetSeconds: 120, reason: 'chat_spike', reasonLabel: 'Chat spike', topEmotes: [] } as unknown as LiveHeatPoint
const item = { id: 'one', login: 'xqc', streamId: '123456', offsetSeconds: 120, label: 'Chat spike', notes: '', source: 'extension' as const, createdAt: '', updatedAt: '' }
const API = 'https://api.streampulse.stream'
let root: Root, host: HTMLDivElement
// A card's picture asks the worker for its frames script once per page. Ask
// here, so that request never takes a bookmark answer queued below.
beforeAll(async () => {
  const warm = createRoot(document.createElement('div'))
  await act(async () => warm.render(<SelectedMomentCard point={point} backendUrl={API} onJump={() => undefined} onAnalytics={() => undefined} />))
  await act(async () => warm.unmount())
})
beforeEach(() => { vi.resetAllMocks(); signIn.on = true; host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers() })

type Context = { login?: string; streamId?: string; vodId?: string; resolveVodId?: () => Promise<string | null>; momentOffsets?: number[] }
async function panel(children: ReactNode, context: Context = {}) {
  const { login = 'xqc', vodId, resolveVodId, momentOffsets } = context
  const streamId = 'streamId' in context ? context.streamId : '123456'
  await act(async () => root.render(
    <MomentBookmarksProvider login={login} streamId={streamId} vodId={vodId} resolveVodId={resolveVodId} momentOffsets={momentOffsets}>
      {children}
      <MomentBookmarkToast />
    </MomentBookmarksProvider>,
  ))
}
const card = (context?: Context) => panel(<SelectedMomentCard point={point} backendUrl={API} onJump={() => undefined} onAnalytics={() => undefined} />, context)
const bookmark = () => host.querySelector<HTMLButtonElement>('[data-moment-action="bookmark"]')
const toast = () => host.querySelector<HTMLElement>('.pulse-bookmark-toast')
async function press(target: HTMLElement | null) {
  if (!target) throw new Error('Missing control')
  await act(async () => target.click())
}
const calls = (type: string) => vi.mocked(sendBackgroundMessage).mock.calls.map(([request]) => request).filter(request => request.type === type)
/** Bookmark traffic only: a card's picture also loads its frames script through the bridge. */
const bookmarkCalls = () => vi.mocked(sendBackgroundMessage).mock.calls.map(([request]) => request).filter(request => request.type !== 'MOMENT_FRAMES_SCRIPT')
/** The extension runtime, with storage events and the local store the sync hint reads. */
function runtime(extra: object = {}) {
  let changed!: (changes: Record<string, unknown>) => void
  const local = new Map<string, unknown>()
  vi.stubGlobal('chrome', {
    runtime: { id: 'extension-id' },
    storage: {
      onChanged: { addListener: (listener: typeof changed) => { changed = listener }, removeListener: vi.fn() },
      local: { get: async (key: string) => (local.has(key) ? { [key]: local.get(key) } : {}), set: async (values: Record<string, unknown>) => { for (const [key, value] of Object.entries(values)) local.set(key, value) } },
    },
    ...extra,
  })
  return { change: (changes: Record<string, unknown>) => act(async () => changed(changes)), local }
}

describe('matchBookmark', () => {
  const at = (id: string, offsetSeconds: number) => ({ ...item, id, offsetSeconds }) as PulseBookmark
  it('keeps a moment its save within 90 s, nearest first', () => {
    expect(matchBookmark([at('far', 211), at('near', 150), at('nearer', 100)], { kind: 'moment', offsetSeconds: 120 })?.id).toBe('nearer')
    expect(matchBookmark([at('far', 211)], { kind: 'moment', offsetSeconds: 120 })).toBeUndefined()
    expect(matchBookmark([at('edge', 210)], { kind: 'moment', offsetSeconds: 120 })?.id).toBe('edge')
  })
  it('leaves a save to the listed moment it is nearer to', () => {
    expect(matchBookmark([at('b', 170)], { kind: 'moment', offsetSeconds: 120 }, [120, 180])).toBeUndefined()
    expect(matchBookmark([at('b', 170)], { kind: 'moment', offsetSeconds: 180 }, [120, 180])?.id).toBe('b')
    // A tie stays with both: neither moment is nearer.
    expect(matchBookmark([at('b', 150)], { kind: 'moment', offsetSeconds: 120 }, [120, 180])?.id).toBe('b')
  })
  it('gives a minute only the saves inside it', () => {
    expect(matchBookmark([at('in', 359)], { kind: 'minute', offsetSeconds: 300 })?.id).toBe('in')
    expect(matchBookmark([at('next', 360), at('before', 299)], { kind: 'minute', offsetSeconds: 300 })).toBeUndefined()
  })
})

it('saves the stream offset after a dedupe preflight, then shows it saved on the card', async () => {
  vi.mocked(sendBackgroundMessage)
    .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [] })
    .mockResolvedValueOnce({ type: 'BOOKMARK', item })
  await card()
  expect(bookmark()?.getAttribute('aria-label')).toBe('Bookmark moment at 00:02')
  expect(bookmark()?.getAttribute('aria-pressed')).toBe('false')
  expect(host.textContent).not.toContain('Free to use')
  // Outside the extension runtime nothing is read until a save.
  expect(bookmarkCalls()).toEqual([])
  await press(bookmark())
  expect(bookmarkCalls()).toEqual([
    expect.objectContaining({ type: 'LIST_BOOKMARKS', login: 'xqc', streamId: '123456', limit: 100 }),
    expect.objectContaining({ type: 'SAVE_BOOKMARK', bookmark: expect.objectContaining({ login: 'xqc', streamId: '123456', offsetSeconds: 120, label: 'Chat spike' }) }),
  ])
  expect(toast()?.getAttribute('role')).toBe('status')
  expect(toast()?.textContent).toContain('Saved to your account at 00:02:00.')
  expect(bookmark()?.getAttribute('data-moment-save-state')).toBe('saved')
  expect(bookmark()?.getAttribute('aria-pressed')).toBe('true')
  expect(bookmark()?.getAttribute('aria-label')).toBe('Remove bookmark at 00:02')
})

it('offers no bookmark outside the panel, as on demo cards', async () => {
  await act(async () => root.render(<><SelectedMomentCard point={point} backendUrl={API} onJump={() => undefined} onAnalytics={() => undefined} /><MyMomentsLink /></>))
  expect(bookmark()).toBeNull()
  expect(host.querySelector('[data-moment-action="open-library"]')).toBeNull()
})

it('offers no bookmark without a stream or VOD to save against', async () => {
  await card({ streamId: '' })
  expect(bookmark()).toBeNull()
})

it('hydrates the saved state inside the extension runtime, on the card and the row', async () => {
  runtime()
  vi.mocked(sendBackgroundMessage).mockResolvedValueOnce({ type: 'BOOKMARKS', items: [item] })
  await panel(<>
    <SelectedMomentCard point={point} backendUrl={API} onJump={() => undefined} onAnalytics={() => undefined} />
    <PulseMomentRow point={point} backendUrl={API} selected={false} onSelect={() => undefined} onHighlight={() => undefined} />
  </>)
  expect(sendBackgroundMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'LIST_BOOKMARKS', login: 'xqc', streamId: '123456' }))
  expect(bookmark()?.getAttribute('data-moment-save-state')).toBe('saved')
  expect(host.querySelector('[data-moment-row-saved="true"]')).not.toBeNull()
  expect(host.querySelector('[aria-label$=", bookmarked"]')).not.toBeNull()
})

it('marks no row for a save that belongs to another moment', async () => {
  runtime()
  vi.mocked(sendBackgroundMessage).mockResolvedValueOnce({ type: 'BOOKMARKS', items: [{ ...item, offsetSeconds: 170 }] })
  await panel(<PulseMomentRow point={point} backendUrl={API} selected={false} onSelect={() => undefined} onHighlight={() => undefined} />, { momentOffsets: [120, 180] })
  expect(host.querySelector('[data-moment-row-saved="true"]')).toBeNull()
})

it('finds live bookmarks on the same stream replay and removes one with its stream identity', async () => {
  runtime()
  vi.mocked(sendBackgroundMessage).mockImplementation(async request => {
    if (request.type === 'LIST_BOOKMARKS') return { type: 'BOOKMARKS', items: request.vodId ? [] : [item] }
    if (request.type === 'REMOVE_BOOKMARK') return { type: 'REMOVE_BOOKMARK', ok: true }
    throw new Error(`Unexpected ${request.type}`)
  })
  await card({ vodId: '987654321' })
  expect(sendBackgroundMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: 'LIST_BOOKMARKS', streamId: '123456', vodId: undefined, contextVodId: '987654321',
  }))
  expect(bookmark()?.getAttribute('data-moment-save-state')).toBe('saved')
  await press(bookmark())
  expect(calls('REMOVE_BOOKMARK')).toEqual([{ type: 'REMOVE_BOOKMARK', id: 'one', login: 'xqc', streamId: '123456', contextVodId: '987654321' }])
  expect(calls('SAVE_BOOKMARK')).toEqual([])
  expect(bookmark()?.getAttribute('data-moment-save-state')).toBe('ready')
  expect(toast()?.textContent).toContain('Removed bookmark at 00:02:00.')
})

it('puts a removed bookmark back with Undo', async () => {
  runtime()
  vi.mocked(sendBackgroundMessage)
    .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [item] })
    .mockResolvedValueOnce({ type: 'REMOVE_BOOKMARK', ok: true })
    .mockResolvedValueOnce({ type: 'BOOKMARK', item: { ...item, id: 'two' } })
  await card()
  await press(bookmark())
  await press(host.querySelector('[data-bookmark-toast-action="undo"]'))
  // The removed id lets the worker put back the note it kept on this device.
  expect(calls('SAVE_BOOKMARK')).toEqual([{ type: 'SAVE_BOOKMARK', restoreOf: 'one', bookmark: {
    login: 'xqc', streamId: '123456', offsetSeconds: 120, label: 'Chat spike', source: 'extension',
  } }])
  expect(bookmark()?.getAttribute('data-moment-save-state')).toBe('saved')
  expect(toast()).toBeNull()
})

it('puts an account note back with Undo', async () => {
  runtime()
  vi.mocked(sendBackgroundMessage)
    .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [{ ...item, notes: 'clutch round' }] })
    .mockResolvedValueOnce({ type: 'REMOVE_BOOKMARK', ok: true })
    .mockResolvedValueOnce({ type: 'BOOKMARK', item: { ...item, id: 'two', notes: 'clutch round' } })
  await card()
  await press(bookmark())
  await press(host.querySelector('[data-bookmark-toast-action="undo"]'))
  expect(calls('SAVE_BOOKMARK')).toEqual([expect.objectContaining({ restoreOf: 'one', bookmark: expect.objectContaining({ notes: 'clutch round' }) })])
})

it('takes a save back with Undo', async () => {
  vi.mocked(sendBackgroundMessage)
    .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [] })
    .mockResolvedValueOnce({ type: 'BOOKMARK', item })
    .mockResolvedValueOnce({ type: 'REMOVE_BOOKMARK', ok: true })
  await card()
  await press(bookmark())
  await press(host.querySelector('[data-bookmark-toast-action="undo"]'))
  expect(calls('REMOVE_BOOKMARK')).toEqual([{ type: 'REMOVE_BOOKMARK', id: 'one', login: 'xqc', streamId: '123456' }])
  expect(bookmark()?.getAttribute('data-moment-save-state')).toBe('ready')
  expect(toast()).toBeNull()
})

it('says so when the bookmark was already removed elsewhere', async () => {
  runtime()
  vi.mocked(sendBackgroundMessage)
    .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [item] })
    .mockResolvedValueOnce({ type: 'PULSE_UPDATE', payload: null, error: 'bookmark_not_found' })
  await card()
  await press(bookmark())
  expect(toast()?.getAttribute('role')).toBe('alert')
  expect(toast()?.textContent).toContain('That bookmark was already removed.')
})

it('reloads saved state after account linking without a Twitch refresh', async () => {
  const chrome = runtime()
  vi.mocked(sendBackgroundMessage)
    .mockResolvedValueOnce({ error: 'account_authorization_required', ok: false })
    .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [item] })
  await card()
  expect(bookmark()?.getAttribute('data-moment-save-state')).toBe('ready')
  await chrome.change({ pulseAccountRevision: { newValue: 'linked' } })
  expect(bookmark()?.getAttribute('data-moment-save-state')).toBe('saved')
  expect(bookmarkCalls()).toHaveLength(2)
})

it('does not claim a failed save succeeded and permits retry', async () => {
  vi.mocked(sendBackgroundMessage)
    .mockResolvedValueOnce({ error: 'unavailable', ok: false })
    .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [] })
    .mockResolvedValueOnce({ type: 'BOOKMARK', item })
  await card()
  await press(bookmark())
  expect(toast()?.getAttribute('role')).toBe('alert')
  expect(toast()?.textContent).toContain('Could not update this bookmark. Try again.')
  expect(bookmark()?.getAttribute('data-moment-save-state')).toBe('ready')
  await press(bookmark())
  expect(toast()?.getAttribute('role')).toBe('status')
  expect(toast()?.textContent).toContain('Saved to your account at 00:02:00.')
})

it('checks every bookmark page and does not create a duplicate', async () => {
  vi.mocked(sendBackgroundMessage)
    .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [], nextCursor: 'cursor-next' })
    .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [item] })
  await card()
  await press(bookmark())
  expect(bookmarkCalls()).toEqual([expect.objectContaining({ type: 'LIST_BOOKMARKS' }), expect.objectContaining({ type: 'LIST_BOOKMARKS', cursor: 'cursor-next' })])
  expect(toast()?.textContent).toContain('Already bookmarked at 00:02:00.')
  expect(bookmark()?.getAttribute('data-moment-save-state')).toBe('saved')
})

it('treats a save that rescoring moved as the same moment', async () => {
  vi.mocked(sendBackgroundMessage).mockResolvedValueOnce({ type: 'BOOKMARKS', items: [{ ...item, offsetSeconds: 180 }] })
  await card()
  await press(bookmark())
  expect(calls('SAVE_BOOKMARK')).toEqual([])
  expect(toast()?.textContent).toContain('Already bookmarked at 00:03:00.')
})

it('ignores an obsolete channel response', async () => {
  let resolve!: (value: any) => void
  vi.mocked(sendBackgroundMessage).mockReturnValueOnce(new Promise(done => { resolve = done }))
  await card()
  await press(bookmark())
  await card({ login: 'other' })
  await act(async () => resolve({ type: 'BOOKMARKS', items: [item] }))
  expect(toast()).toBeNull()
  expect(bookmark()?.getAttribute('data-moment-save-state')).toBe('ready')
})

it('clears cached rows and ignores in-flight responses after account invalidation', async () => {
  const chrome = runtime()
  vi.mocked(sendBackgroundMessage).mockResolvedValueOnce({ type: 'BOOKMARKS', items: [item] })
  await card()
  expect(bookmark()?.getAttribute('data-moment-save-state')).toBe('saved')
  let finish!: (value: any) => void
  vi.mocked(sendBackgroundMessage).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  vi.mocked(sendBackgroundMessage).mockReturnValueOnce(new Promise(() => {}))
  await press(bookmark())
  await chrome.change({ pulseAccountRevision: { newValue: 'changed' } })
  await act(async () => finish({ type: 'REMOVE_BOOKMARK', ok: true }))
  expect(toast()).toBeNull()
  expect(bookmark()?.getAttribute('data-moment-save-state')).toBe('ready')
  expect(bookmark()?.disabled).toBe(false)
})

it('explains the free account requirement and offers to connect', async () => {
  vi.mocked(sendBackgroundMessage).mockResolvedValueOnce({ error: 'account_authorization_required', ok: false })
  await card()
  await press(bookmark())
  expect(toast()?.getAttribute('role')).toBe('alert')
  expect(toast()?.textContent).toContain('Connect your free Pulse account to bookmark.')
  vi.mocked(sendBackgroundMessage).mockResolvedValueOnce({ type: 'OPEN_SETTINGS_HOST', ok: true })
  await press(host.querySelector('[data-moment-action="connect-account"]'))
  expect(host.querySelector('[data-moment-action="connect-account"]')?.textContent).toBe('Connect')
  expect(sendBackgroundMessage).toHaveBeenLastCalledWith({ type: 'OPEN_SETTINGS_HOST', section: 'supporter' })
})

it('preserves a valid VOD reference when no live stream id is available', async () => {
  vi.mocked(sendBackgroundMessage)
    .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [] })
    .mockResolvedValueOnce({ type: 'BOOKMARK', item: { ...item, streamId: undefined, vodId: '987654321' } })
  await card({ streamId: undefined, vodId: '987654321' })
  await press(bookmark())
  expect(sendBackgroundMessage).toHaveBeenLastCalledWith(expect.objectContaining({
    type: 'SAVE_BOOKMARK', bookmark: expect.objectContaining({ login: 'xqc', vodId: '987654321', offsetSeconds: 120 }),
  }))
  expect(bookmark()?.getAttribute('data-moment-save-state')).toBe('saved')
})

describe('the chart minute card', () => {
  const minute = (interactionState: 'preview' | 'selected') => panel(
    <ChartMinuteInspectCard rollup={{ offsetSeconds: 300.4, chatCount: 12, totalEmoteCount: 3, topEmotes: [] }} backendUrl={API} interactionState={interactionState} />,
  )
  it('bookmarks the raw minute it shows', async () => {
    vi.mocked(sendBackgroundMessage)
      .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [] })
      .mockResolvedValueOnce({ type: 'BOOKMARK', item: { ...item, offsetSeconds: 300, label: 'Minute activity' } })
    await minute('selected')
    expect(bookmark()?.getAttribute('aria-label')).toBe('Bookmark minute at 00:05:00')
    await press(bookmark())
    expect(sendBackgroundMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'SAVE_BOOKMARK', bookmark: expect.objectContaining({ offsetSeconds: 300, label: 'Minute activity', streamId: '123456' }),
    }))
  })
  it('offers no bookmark on a hover preview', async () => {
    await minute('preview')
    expect(bookmark()).toBeNull()
  })
})

it('links My Moments from a moments heading', async () => {
  vi.mocked(sendBackgroundMessage).mockResolvedValueOnce({ type: 'OPEN_SETTINGS_HOST', ok: true })
  await panel(<MyMomentsLink />)
  await press(host.querySelector('[data-moment-action="open-library"]'))
  expect(sendBackgroundMessage).toHaveBeenLastCalledWith({ type: 'OPEN_SETTINGS_HOST', section: 'moments' })
})

describe('the toast', () => {
  async function saved() {
    vi.mocked(sendBackgroundMessage)
      .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [] })
      .mockResolvedValueOnce({ type: 'BOOKMARK', item })
    await card()
    vi.useFakeTimers()
    await press(bookmark())
  }
  it('leaves after a few seconds', async () => {
    await saved()
    expect(toast()).not.toBeNull()
    await act(async () => vi.advanceTimersByTime(4100))
    expect(toast()).not.toBeNull()
    await act(async () => vi.advanceTimersByTime(200))
    expect(toast()).toBeNull()
  })
  it('waits while the pointer is on it', async () => {
    await saved()
    await act(async () => toast()?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    await act(async () => vi.advanceTimersByTime(10_000))
    expect(toast()).not.toBeNull()
    await act(async () => toast()?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
    await act(async () => vi.advanceTimersByTime(4300))
    expect(toast()).toBeNull()
  })
  it('opens My Moments', async () => {
    await saved()
    vi.mocked(sendBackgroundMessage).mockResolvedValueOnce({ type: 'OPEN_SETTINGS_HOST', ok: true })
    await press(host.querySelector('[data-bookmark-toast-action="library"]'))
    expect(sendBackgroundMessage).toHaveBeenLastCalledWith({ type: 'OPEN_SETTINGS_HOST', section: 'moments' })
  })
})

it('says once that a save on this device syncs after sign-in', async () => {
  const chrome = runtime()
  vi.mocked(sendBackgroundMessage).mockImplementation(async request => {
    if (request.type === 'LIST_BOOKMARKS') return { type: 'BOOKMARKS', items: [], device: true }
    if (request.type === 'REMOVE_BOOKMARK') return { type: 'REMOVE_BOOKMARK', ok: true, device: true }
    if (request.type === 'SAVE_BOOKMARK') return { type: 'BOOKMARK', item: { ...item, id: 'local:one' }, device: true }
    throw new Error(`Unexpected ${request.type}`)
  })
  await card()
  await press(bookmark())
  expect(toast()?.textContent).toContain('Saved on this device · Sign in to sync')
  expect(chrome.local.get('pulseBookmarkSyncHintShown')).toBe(true)
  await press(host.querySelector('[data-bookmark-toast-action="undo"]'))
  await press(bookmark())
  expect(toast()?.textContent).toContain('Saved on this device at 00:02:00.')
  expect(host.querySelector('[role="alert"]')).toBeNull()
})

describe('with Sign in with Twitch compiled off (every store build today)', () => {
  beforeEach(() => { signIn.on = false })

  it('never mentions sign-in for a save on this device', async () => {
    runtime({ extension: { inIncognitoContext: false } })
    vi.mocked(sendBackgroundMessage)
      .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [], device: true })
      .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [], device: true })
      .mockResolvedValueOnce({ type: 'BOOKMARK', item: { ...item, id: 'local:one' }, device: true })
    await card()
    await press(bookmark())
    expect(toast()?.textContent).toContain('Saved on this device at 00:02:00.')
    expect(host.textContent).not.toMatch(/Sign in|Pulse account|Connect/)
  })

  it('tells a private-window viewer that nothing is kept there, with no button', async () => {
    runtime({ extension: { inIncognitoContext: true } })
    vi.mocked(sendBackgroundMessage).mockResolvedValue({ error: 'account_authorization_required' })
    await card()
    await press(bookmark())
    expect(toast()?.getAttribute('role')).toBe('alert')
    expect(host.querySelector('.pulse-bookmark-toast-text')?.textContent).toBe('Private windows keep no bookmarks.')
    expect(host.querySelector('[data-moment-action="connect-account"]')).toBeNull()
    expect(host.textContent).not.toMatch(/Pulse account|Connect/)
  })

  it('sends an invited tester whose link lapsed to settings to reconnect', async () => {
    runtime({ extension: { inIncognitoContext: false } })
    vi.mocked(sendBackgroundMessage).mockResolvedValue({ error: 'account_authorization_required' })
    await card()
    await press(bookmark())
    expect(toast()?.textContent).toContain('Reconnect your account in settings to bookmark.')
    expect(host.textContent).not.toMatch(/free Pulse account/)
    vi.mocked(sendBackgroundMessage).mockResolvedValueOnce({ type: 'OPEN_SETTINGS_HOST', ok: true })
    const settings = host.querySelector('[data-moment-action="connect-account"]')
    expect(settings?.textContent).toBe('Settings')
    await press(settings as HTMLElement)
    expect(sendBackgroundMessage).toHaveBeenLastCalledWith({ type: 'OPEN_SETTINGS_HOST', section: 'supporter' })
  })
})

it('PAGE-1: a live save stores the live archive id so My Moments can link the replay', async () => {
  vi.mocked(sendBackgroundMessage)
    .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [] })
    .mockResolvedValueOnce({ type: 'BOOKMARK', item: { ...item, vodId: '2903671992' } })
  const resolveVodId = vi.fn(async () => '2903671992')
  await card({ resolveVodId })
  await press(bookmark())
  expect(resolveVodId).toHaveBeenCalledTimes(1)
  expect(calls('SAVE_BOOKMARK')).toEqual([expect.objectContaining({
    bookmark: expect.objectContaining({ login: 'xqc', streamId: '123456', vodId: '2903671992', offsetSeconds: 120 }),
  })])
})

it('PAGE-1: a live save without a findable archive still saves, stream-only', async () => {
  vi.mocked(sendBackgroundMessage)
    .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [] })
    .mockResolvedValueOnce({ type: 'BOOKMARK', item })
  await card({ resolveVodId: async () => { throw new Error('gql down') } })
  await press(bookmark())
  const save = calls('SAVE_BOOKMARK')[0] as { bookmark: Record<string, unknown> }
  expect(save.bookmark).not.toHaveProperty('vodId')
  expect(toast()?.textContent).toContain('Saved to your account at 00:02:00.')
})
