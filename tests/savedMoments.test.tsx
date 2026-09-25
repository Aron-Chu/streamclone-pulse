// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LiveHeatPoint } from '@streampulse/pulse-core'
import { SavedMoments } from '../src/ui/SavedMoments.tsx'
import { sendBackgroundMessage } from '../src/content/bridge.ts'
vi.mock('../src/content/bridge.ts', () => ({ sendBackgroundMessage: vi.fn() }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const point = { offsetSeconds: 120, reason: 'chat_spike', reasonLabel: 'Chat spike', topEmotes: [] } as unknown as LiveHeatPoint
const item = { id: 'one', login: 'xqc', streamId: '123456', offsetSeconds: 120, label: 'Chat spike', notes: '', source: 'extension' as const, createdAt: '', updatedAt: '' }
let root: Root, host: HTMLDivElement
beforeEach(() => { vi.clearAllMocks(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function render(login = 'xqc') {
  await act(async () => root.render(<SavedMoments login={login} streamId="123456" selected={point} />))
}
async function click(text: string) {
  const button = [...host.querySelectorAll('button')].find(button => button.textContent?.startsWith(text))
  if (!button) throw new Error(`Missing ${text}`)
  await act(async () => button.click())
}
it('saves the exact stream offset after a dedupe preflight', async () => {
  vi.mocked(sendBackgroundMessage)
    .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [] })
    .mockResolvedValueOnce({ type: 'BOOKMARK', item })
  await render()
  expect(host.textContent).toContain('Free to use.')
  expect(host.querySelector('button[aria-label^="Save moment at"]')).toBeTruthy()
  expect(host.querySelector('button[aria-label="Open My Moments"]')).toBeTruthy()
  expect(sendBackgroundMessage).not.toHaveBeenCalled()
  await click('Bookmark')
  expect(sendBackgroundMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
    type: 'LIST_BOOKMARKS',
    login: 'xqc',
    streamId: '123456',
    limit: 100,
  }))
  expect(sendBackgroundMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
    type: 'SAVE_BOOKMARK',
    bookmark: expect.objectContaining({ login: 'xqc', streamId: '123456', offsetSeconds: 120 }),
  }))
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Bookmarked at')
  expect(host.textContent).toContain('Bookmarked')
})
it('hydrates a saved state inside the extension runtime', async () => {
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id' } })
  vi.mocked(sendBackgroundMessage).mockResolvedValueOnce({ type: 'BOOKMARKS', items: [item] })
  await render()
  expect(sendBackgroundMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: 'LIST_BOOKMARKS',
    login: 'xqc',
    streamId: '123456',
  }))
  expect(host.querySelector('button[data-moment-save-state="saved"]')?.textContent).toContain('Bookmarked')
})
it('finds live bookmarks without a VOD id when viewing the same stream replay', async () => {
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id' } })
  vi.mocked(sendBackgroundMessage).mockImplementation(async request => {
    if (request.type !== 'LIST_BOOKMARKS') throw new Error('Unexpected bookmark write')
    return { type: 'BOOKMARKS', items: request.vodId ? [] : [item] }
  })
  await act(async () => root.render(
    <SavedMoments login="xqc" streamId="123456" vodId="987654321" selected={point} />,
  ))
  expect(sendBackgroundMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: 'LIST_BOOKMARKS', streamId: '123456', vodId: undefined, contextVodId: '987654321',
  }))
  expect(host.querySelector('[data-moment-save-state="saved"]')).not.toBeNull()
  await click('Bookmarked')
  expect(sendBackgroundMessage).toHaveBeenCalledTimes(1)
})
it('reloads saved state after account linking without a Twitch refresh', async () => {
  let changed!: (changes: Record<string, unknown>) => void
  vi.stubGlobal('chrome', { runtime: { id: 'extension-id' }, storage: { onChanged: {
    addListener: (listener: typeof changed) => { changed = listener }, removeListener: vi.fn(),
  } } })
  vi.mocked(sendBackgroundMessage)
    .mockResolvedValueOnce({ error: 'account_authorization_required', ok: false })
    .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [item] })
  await render()
  expect(host.querySelector('[data-moment-save-state="ready"]')).not.toBeNull()
  await act(async () => changed({ pulseAccountRevision: { newValue: 'linked' } }))
  expect(host.querySelector('[data-moment-save-state="saved"]')).not.toBeNull()
  expect(sendBackgroundMessage).toHaveBeenCalledTimes(2)
})
it('does not claim a failed save succeeded and permits retry', async () => {
  vi.mocked(sendBackgroundMessage)
    .mockResolvedValueOnce({ error: 'unavailable', ok: false })
    .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [] })
    .mockResolvedValueOnce({ type: 'BOOKMARK', item })
  await render(); await click('Bookmark')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not save')
  await click('Bookmark')
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(host.textContent).toContain('Bookmarked at 00:02:00')
  expect(host.textContent).toContain('Bookmarked')
})
it('checks every bookmark page and does not create a duplicate', async () => {
  vi.mocked(sendBackgroundMessage)
    .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [], nextCursor: 'cursor-next' })
    .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [item] })
  await render(); await click('Bookmark')
  expect(sendBackgroundMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
    type: 'LIST_BOOKMARKS',
    cursor: 'cursor-next',
  }))
  expect(sendBackgroundMessage).toHaveBeenCalledTimes(2)
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Already bookmarked at')
  expect(host.textContent).toContain('Bookmarked')
})
it('ignores an obsolete channel response', async () => {
  let resolve!: (value: any) => void
  vi.mocked(sendBackgroundMessage).mockReturnValueOnce(new Promise(done => { resolve = done }))
  await render(); await click('Bookmark'); await render('other')
  await act(async () => resolve({ type: 'BOOKMARKS', items: [item] }))
  expect(host.textContent).not.toContain('Chat spike')
  expect(host.textContent).not.toContain('Bookmarked at')
})
it('clears cached rows and ignores in-flight responses after account invalidation', async () => {
  let changed!: (changes: Record<string, unknown>) => void
  vi.stubGlobal('chrome', { storage: { onChanged: { addListener: (listener: typeof changed) => { changed = listener }, removeListener: vi.fn() } } })
  let finish!: (value: any) => void
  vi.mocked(sendBackgroundMessage).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  await render(); await click('Bookmark')
  await act(async () => changed({ pulseAccountRevision: { newValue: 'changed' } }))
  await act(async () => finish({ type: 'BOOKMARKS', items: [item] }))
  expect(host.textContent).not.toContain('Already bookmarked')
  expect(host.textContent).not.toContain('Bookmarked at')
})
it('explains the free account requirement and offers account recovery', async () => {
  vi.mocked(sendBackgroundMessage).mockResolvedValueOnce({ error: 'account_authorization_required', ok: false })
  await render()
  await click('Bookmark')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('free Pulse account')
  expect(host.textContent).toContain('Connect free account')

  vi.mocked(sendBackgroundMessage).mockResolvedValueOnce({ type: 'OPEN_SETTINGS_HOST', ok: true })
  await click('Connect free account')
  expect(sendBackgroundMessage).toHaveBeenLastCalledWith({ type: 'OPEN_SETTINGS_HOST', section: 'supporter' })
})
it('preserves a valid VOD reference when no live stream id is available', async () => {
  vi.mocked(sendBackgroundMessage)
    .mockResolvedValueOnce({ type: 'BOOKMARKS', items: [] })
    .mockResolvedValueOnce({ type: 'BOOKMARK', item: { ...item, streamId: undefined, vodId: '987654321' } })
  await act(async () => root.render(
    <SavedMoments login="xqc" vodId="987654321" selected={point} />,
  ))
  await click('Bookmark')
  expect(sendBackgroundMessage).toHaveBeenLastCalledWith(expect.objectContaining({
    type: 'SAVE_BOOKMARK',
    bookmark: expect.objectContaining({ login: 'xqc', vodId: '987654321', offsetSeconds: 120 }),
  }))
})
