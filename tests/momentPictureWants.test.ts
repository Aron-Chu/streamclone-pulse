import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleMomentPicture, jpegFromDataUrl, resetPictureWants, wantPicture, type PictureDeps } from '../src/background/momentPictures.ts'
import { MomentPictureStore, type PictureBackend, type SavedPicture } from '../src/shared/momentPictureStore.ts'
import { parseBackgroundRequest } from '../src/shared/parseBackgroundRequest.ts'
import { isSenderAuthorizedForMessage } from '../src/background/pulseBroadcastTargets.ts'

/**
 * The worker asks only the tab a moment was saved or watched in for its frame,
 * only while Moment pictures is on, and keeps one answer that fits.
 */
const map = new Map<string, SavedPicture>()
const backend: PictureBackend = {
  all: async () => [...map.values()],
  get: async key => map.get(key),
  put: async picture => { map.set(picture.key, picture) },
  remove: async keys => { for (const key of keys) map.delete(key) },
}
const JPEG = `data:image/jpeg;base64,${btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4))}`
const TOKEN = '00000000-0000-4000-8000-000000000001'
const scope = 'https://api.example|local'
const moment = { channel: 'xqc', vodId: '1234567890', streamId: '123456', offsetSeconds: 125 }
const sender = (url = 'https://www.twitch.tv/xqc', tab = 7, frameId = 0) => ({ tab: { id: tab, url, incognito: false } as chrome.tabs.Tab, frameId })
let deps: PictureDeps & { sent: unknown[]; on: boolean }
beforeEach(() => {
  map.clear()
  resetPictureWants()
  let n = 0
  const sent: unknown[] = []
  deps = {
    sent, on: true,
    enabled: async () => deps.on,
    send: async (tabId, message, frameId) => { sent.push({ tabId, frameId, message }) },
    store: new MomentPictureStore(backend),
    now: () => 1000,
    token: () => `00000000-0000-4000-8000-00000000000${++n}`,
  }
})
const frame = (offset = 121, token = TOKEN, image = JPEG) => ({ type: 'MOMENT_PICTURE' as const, action: 'frame' as const, token, image, offset })
const want = (owned = true, from = sender()) => wantPicture(from, moment, scope, 'xqc:123456:125', { owned, waitMs: 20_000 }, deps)

describe('asking a tab for a moment’s picture', () => {
  it('asks that tab and frame for the moment’s span', async () => {
    await want(true, sender('https://www.twitch.tv/xqc', 7, 3))
    expect(deps.sent).toEqual([{ tabId: 7, frameId: 3, message: { type: 'MOMENT_PICTURE_WANTS',
      wants: [{ token: TOKEN, stream: '123456', from: 105, to: 155, peak: 122, until: 21_000 }] } }])
  })

  it('asks nothing while Moment pictures is off, from a private window, or when the moment has a picture', async () => {
    deps.on = false
    await want()
    deps.on = true
    await wantPicture({ tab: { id: 7, url: 'https://www.twitch.tv/xqc', incognito: true } as chrome.tabs.Tab }, moment, scope, 'k', { owned: true, waitMs: 1 }, deps)
    await wantPicture({}, moment, scope, 'k', { owned: true, waitMs: 1 }, deps)
    await deps.store.attach(scope, 'xqc:123456:125', new Blob([new Uint8Array(4)]), 120, 1)
    await want()
    expect(deps.sent).toEqual([])
  })

  it('keeps one answer from the asking tab, inside the span, on the moment’s page', async () => {
    await want()
    expect(await handleMomentPicture(frame(), sender('https://www.twitch.tv/xqc', 8), async () => true, deps)).toEqual({ type: 'MOMENT_PICTURE', ok: false })
    expect(await handleMomentPicture(frame(), sender(), async () => true, deps)).toEqual({ type: 'MOMENT_PICTURE', ok: true })
    expect(map.size).toBe(1)
    expect([...map.values()][0]).toMatchObject({ scope, identity: 'xqc:123456:125', offset: 121, savedAt: 1000 })
    // Answered once.
    expect(await handleMomentPicture(frame(), sender(), async () => true, deps)).toEqual({ type: 'MOMENT_PICTURE', ok: false })
  })

  it('refuses a frame outside the span, from another page, after the setting went off, or not a JPEG', async () => {
    for (const [answer, from, on] of [[frame(160), sender(), true], [frame(), sender('https://www.twitch.tv/other'), true],
      [frame(), sender(), false], [frame(121, TOKEN, 'data:image/png;base64,AAAA'), sender(), true]] as const) {
      map.clear(); resetPictureWants(); deps.on = true
      let n = 0
      deps.token = () => (++n, TOKEN)
      await want()
      deps.on = on
      expect(await handleMomentPicture(answer, from, async () => true, deps)).toEqual({ type: 'MOMENT_PICTURE', ok: false })
      expect(map.size).toBe(0)
    }
  })

  it('accepts the VOD page of the moment', async () => {
    await want()
    expect((await handleMomentPicture(frame(), sender('https://www.twitch.tv/videos/1234567890'), async () => true, deps)).ok).toBe(true)
  })

  it('keeps a watched moment’s picture only while it is saved or in History', async () => {
    await want(false)
    expect((await handleMomentPicture(frame(), sender(), async () => false, deps)).ok).toBe(false)
    await want(false)
    expect((await handleMomentPicture(frame(121, '00000000-0000-4000-8000-000000000002'), sender(), async () => true, deps)).ok).toBe(true)
  })

  it('lets a frames script that loaded late read what its tab was asked for', async () => {
    await want()
    expect(await handleMomentPicture({ type: 'MOMENT_PICTURE', action: 'wants' }, sender(), async () => true, deps))
      .toEqual({ type: 'MOMENT_PICTURE', wants: [expect.objectContaining({ token: TOKEN })] })
    expect(await handleMomentPicture({ type: 'MOMENT_PICTURE', action: 'wants' }, sender('https://www.twitch.tv/xqc', 9), async () => true, deps))
      .toEqual({ type: 'MOMENT_PICTURE', wants: [] })
  })

  it('forgets a request once it expires', async () => {
    await want()
    deps.now = () => 30_000
    expect((await handleMomentPicture(frame(), sender(), async () => true, deps)).ok).toBe(false)
  })
})

describe('picture messages', () => {
  it('reads only a JPEG of sane size', () => {
    expect(jpegFromDataUrl(JPEG)?.size).toBe(8)
    expect(jpegFromDataUrl(`data:image/jpeg;base64,${btoa('GIF89a')}`)).toBeNull()
    expect(jpegFromDataUrl('data:image/jpeg;base64,***')).toBeNull()
    expect(jpegFromDataUrl(`data:image/jpeg;base64,${btoa(String.fromCharCode(0xff, 0xd8, 0xff) + 'x'.repeat(130_000))}`)).toBeNull()
  })

  it('parses exact shapes from Twitch pages only', () => {
    expect(parseBackgroundRequest({ type: 'MOMENT_PICTURE', action: 'wants' })).toEqual({ type: 'MOMENT_PICTURE', action: 'wants' })
    expect(parseBackgroundRequest(frame())).toEqual(frame())
    expect(parseBackgroundRequest({ ...frame(), extra: 1 })).toBeNull()
    expect(parseBackgroundRequest(frame(-1))).toBeNull()
    expect(parseBackgroundRequest(frame(121, 'not-a-token'))).toBeNull()
    expect(parseBackgroundRequest(frame(121, TOKEN, 'x'.repeat(200_000)))).toBeNull()
    const twitch = { id: 'ext', url: 'https://www.twitch.tv/xqc', frameId: 0, tab: { id: 1, url: 'https://www.twitch.tv/xqc' } }
    expect(isSenderAuthorizedForMessage('MOMENT_PICTURE', undefined, twitch, 'ext')).toBe(true)
    expect(isSenderAuthorizedForMessage('MOMENT_PICTURE', undefined, { ...twitch, url: 'https://example.com/', tab: { id: 1, url: 'https://example.com/' } }, 'ext')).toBe(false)
  })

  it('lets a jump’s status name its moment', () => {
    const reference = { id: 'm', channel: 'xqc', title: 'Moment', vodId: '1234567890', offsetSeconds: 125, availability: 'unresolved' as const }
    expect(parseBackgroundRequest({ type: 'MOMENT_CAPTURE', action: 'status', reference })).toEqual({ type: 'MOMENT_CAPTURE', action: 'status', reference })
    expect(parseBackgroundRequest({ type: 'MOMENT_CAPTURE', action: 'status', reference: { ...reference, vodId: 'javascript:x' } })).toBeNull()
    expect(parseBackgroundRequest({ type: 'MOMENT_CAPTURE', action: 'status', reference, extra: 1 })).toBeNull()
  })
})
