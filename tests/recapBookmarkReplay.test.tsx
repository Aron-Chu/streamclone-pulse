// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackgroundRequest, ExtensionPeak, PulsePayload } from '../src/shared/messages.ts'
import { StreamRecapSection } from '../src/ui/StreamRecapSection.tsx'
import { MomentBookmarksProvider, endedStreamVodId } from '../src/ui/momentBookmarks.tsx'
import { sendBackgroundMessage } from '../src/content/bridge.ts'

vi.mock('../src/content/bridge.ts', () => ({ sendBackgroundMessage: vi.fn() }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

/**
 * PAGE-1 follow-up (b): a Bookmark in the offline recap, after the stream
 * ended, looks the stream's archive up in stream history (exact stream id)
 * so the save links the replay instead of staying "Replay not linked".
 * The recap is wrapped in the panel's bookmarks provider as Overlay does on
 * an ended stream's channel page.
 */
const peaks: ExtensionPeak[] = [120, 240].map((offsetSeconds, index) => ({
  offsetSeconds, score: 95 - index * 5, reasons: ['chat_spike'], reasonLabel: 'Chat spike', dominantSignal: 'chat', chatCount: 40, emoteCount: 3,
}))
function payload(overrides: Partial<PulsePayload>): PulsePayload {
  return {
    login: 'xqc', streamId: '123456', isLive: false, tracking: true, currentOffsetSeconds: 600,
    startedAt: '2026-10-17T12:00:00.000Z', endedAt: '2026-10-17T13:00:00.000Z',
    rollups: Array.from({ length: 10 }, (_, index) => ({ offsetSeconds: index * 60, chatCount: 20 + index, sevenTvEmoteCount: 4, totalEmoteCount: 8 })),
    lanes: { composite: [], chat: [], seventv: [] }, recap: null, peaks, ...overrides,
  }
}
const withRecap = (overrides: Partial<PulsePayload> = {}) => payload({ recap: { streamId: '123456', login: 'xqc', durationSeconds: 3600, totalMessages: 4000,
  peakChatPerMin: 90, topMoments: peaks.map(({ offsetSeconds, score, chatCount, emoteCount }) => ({ offsetSeconds, score, reasons: ['chat_spike'], chatCount, emoteCount })),
  topEmotes: [], clipCandidates: [] }, ...overrides })

let root: Root, host: HTMLDivElement
const requests = () => vi.mocked(sendBackgroundMessage).mock.calls.map(([request]) => request as BackgroundRequest)
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
  vi.mocked(sendBackgroundMessage).mockReset().mockImplementation(async request => {
    if (request.type === 'LIST_BOOKMARKS') return { type: 'BOOKMARKS', items: [] }
    // The channel's newest VOD is another stream's; only the exact stream id counts.
    if (request.type === 'LIST_PAST_VODS') return { type: 'PAST_VODS', items: [
      { streamId: '999999', videoId: '2904000000', title: 'Later', analyticsStatus: 'synced' },
      { streamId: '123456', videoId: '2903000000', title: 'This one', analyticsStatus: 'synced' },
    ] }
    if (request.type === 'SAVE_BOOKMARK') return { type: 'BOOKMARK', item: { id: 'one', login: 'xqc', offsetSeconds: request.bookmark.offsetSeconds,
      label: '', notes: '', source: 'extension', createdAt: '', updatedAt: '', streamId: request.bookmark.streamId, vodId: request.bookmark.vodId } }
    throw new Error(`unexpected ${request.type}`)
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

async function bookmarkFirstMoment(data: PulsePayload) {
  await act(async () => root.render(
    <MomentBookmarksProvider login={data.login} streamId={data.streamId} vodId={data.vodId ?? undefined}
      resolveVodId={() => (data.streamId ? endedStreamVodId(data.login, data.streamId) : Promise.resolve(null))}>
      <StreamRecapSection payload={data} backendUrl="https://api.example.test" uiState="ready" isLive={false}
        onJump={() => undefined} onAnalytics={() => undefined} onOpenAnalytics={() => undefined} />
    </MomentBookmarksProvider>))
  const row = host.querySelector<HTMLButtonElement>('button.pulse-moment-row-button')
  if (!row) throw new Error('No moment row')
  await act(async () => row.click())
  const bookmark = host.querySelector<HTMLButtonElement>('button[data-moment-action="bookmark"]')
  if (!bookmark) throw new Error('No Bookmark button')
  await act(async () => bookmark.click())
  return requests().find(request => request.type === 'SAVE_BOOKMARK')
}

describe('offline recap Bookmark', () => {
  it.each([['Stream Recap', withRecap()], ['Last Stream Recap (peaks only)', payload({})]])('%s: a save after the stream ended links its replay', async (_name, data) => {
    const save = await bookmarkFirstMoment(data)
    expect(requests()).toContainEqual({ type: 'LIST_PAST_VODS', login: 'xqc' })
    expect(save).toMatchObject({ type: 'SAVE_BOOKMARK', bookmark: { login: 'xqc', streamId: '123456', vodId: '2903000000' } })
  })

  it('saves stream-only when stream history has no archive for that stream', async () => {
    vi.mocked(sendBackgroundMessage).mockImplementation(async request => request.type === 'LIST_PAST_VODS'
      ? { type: 'PAST_VODS', items: [{ streamId: '999999', videoId: '2904000000', title: 'Later', analyticsStatus: 'synced' }] }
      : request.type === 'LIST_BOOKMARKS' ? { type: 'BOOKMARKS', items: [] }
        : { type: 'BOOKMARK', item: { id: 'one', login: 'xqc', offsetSeconds: 120, label: '', notes: '', source: 'extension', createdAt: '', updatedAt: '', streamId: '123456' } })
    const save = await bookmarkFirstMoment(withRecap()) as { bookmark: Record<string, unknown> }
    expect(save.bookmark).toMatchObject({ streamId: '123456' })
    expect(save.bookmark).not.toHaveProperty('vodId')
  })

  it('uses the payload\'s VOD id without a lookup', async () => {
    const save = await bookmarkFirstMoment(withRecap({ vodId: '2903000001' }))
    expect(requests().some(request => request.type === 'LIST_PAST_VODS')).toBe(false)
    expect(save).toMatchObject({ bookmark: { vodId: '2903000001' } })
  })
})
