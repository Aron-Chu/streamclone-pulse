import { afterEach, describe, expect, it, vi } from 'vitest'
import { MomentPictureStore, overLimit, pictureKey, type PictureBackend, type SavedPicture } from '../src/shared/momentPictureStore.ts'
import { savedPictureView } from '../src/shared/momentFramesContract.ts'
import { safePresentationUrl } from '../src/ui/library/MomentMedia.tsx'

/**
 * Pictures kept with saved moments stay on this device, one per moment and
 * scope, oldest first past the cap, and go with their moment.
 */
function memory(): PictureBackend & { map: Map<string, SavedPicture> } {
  const map = new Map<string, SavedPicture>()
  return {
    map,
    all: async () => [...map.values()],
    get: async key => map.get(key),
    put: async picture => { map.set(picture.key, picture) },
    remove: async keys => { for (const key of keys) map.delete(key) },
  }
}
const jpeg = (bytes = 4) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' })
const local = 'https://api.example|local'
const account = 'https://api.example|account:one'

describe('moment picture store', () => {
  it('keeps the first picture of a moment', async () => {
    const backend = memory()
    const store = new MomentPictureStore(backend)
    expect(await store.attach(local, 'xqc:1:120', jpeg(), 118, 1)).toBe(true)
    expect(await store.attach(local, 'xqc:1:120', jpeg(), 121, 2)).toBe(false)
    expect(backend.map.get(pictureKey(local, 'xqc:1:120'))).toMatchObject({ offset: 118, savedAt: 1, bytes: 4 })
    expect(await store.has(local, 'xqc:1:120')).toBe(true)
    expect(await store.has(account, 'xqc:1:120')).toBe(false)
  })

  it('drops the oldest past the count cap', async () => {
    const store = new MomentPictureStore(memory(), { count: 3, bytes: 1e9 })
    for (let i = 0; i < 5; i++) await store.attach(local, `m:${i}`, jpeg(), i, i)
    expect(await store.count()).toBe(3)
    expect([await store.has(local, 'm:0'), await store.has(local, 'm:1'), await store.has(local, 'm:4')]).toEqual([false, false, true])
  })

  it('drops the oldest past the size cap', async () => {
    const store = new MomentPictureStore(memory(), { count: 100, bytes: 10 })
    await store.attach(local, 'a', jpeg(4), 0, 1)
    await store.attach(local, 'b', jpeg(4), 0, 2)
    await store.attach(local, 'c', jpeg(4), 0, 3)
    expect([await store.has(local, 'a'), await store.has(local, 'b'), await store.has(local, 'c')]).toEqual([false, true, true])
    expect(overLimit([{ key: 'x', savedAt: 1, bytes: 11 }], { count: 5, bytes: 10 })).toEqual(['x'])
  })

  it('removes a scope’s pictures whose moment is no longer saved or in History, and no other scope’s', async () => {
    const store = new MomentPictureStore(memory())
    await store.attach(local, 'kept', jpeg(), 0, 1)
    await store.attach(local, 'gone', jpeg(), 0, 2)
    await store.attach(account, 'gone', jpeg(), 0, 3)
    await store.reconcile(local, new Set(['kept']))
    expect([await store.has(local, 'kept'), await store.has(local, 'gone'), await store.has(account, 'gone')]).toEqual([true, false, true])
    await store.drop(local, 'kept')
    expect(await store.has(local, 'kept')).toBe(false)
  })

  it('sign-out drops the account’s pictures; Remove pictures drops all', async () => {
    const store = new MomentPictureStore(memory())
    await store.attach(local, 'a', jpeg(), 0, 1)
    await store.attach(account, 'b', jpeg(), 0, 2)
    await store.dropScope(account)
    expect(await store.count()).toBe(1)
    await store.clear()
    expect(await store.count()).toBe(0)
  })

  it('moves a save’s picture into the account it joins, keeping one already there', async () => {
    const store = new MomentPictureStore(memory())
    await store.attach(local, 'a', jpeg(), 10, 1)
    await store.move(local, account, 'a')
    expect([await store.has(local, 'a'), await store.has(account, 'a')]).toEqual([false, true])
    await store.attach(local, 'b', jpeg(), 10, 2)
    await store.attach(account, 'b', jpeg(), 20, 3)
    await store.move(local, account, 'b')
    expect((await store.forMoments(['b'])).get('b')?.offset).toBe(20)
    expect(await store.has(local, 'b')).toBe(false)
  })

  it('finds the newest picture of each moment asked for, from any scope', async () => {
    const store = new MomentPictureStore(memory())
    await store.attach(local, 'a', jpeg(), 10, 1)
    await store.attach(account, 'a', jpeg(), 12, 5)
    await store.attach(local, 'b', jpeg(), 30, 2)
    const found = await store.forMoments(['a', 'c'])
    expect([...found.keys()]).toEqual(['a'])
    expect(found.get('a')?.offset).toBe(12)
  })
})

describe('saved picture span', () => {
  it('covers a minute card’s minute and a moment’s onset', () => {
    expect(savedPictureView(120)).toEqual({ from: 110, to: 180, peak: 150 })
    expect(savedPictureView(125.8)).toEqual({ from: 105, to: 155, peak: 122 })
  })
})

describe('picture URLs My Moments shows', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('allows this page’s own object URLs and no other blob', () => {
    vi.stubGlobal('location', { origin: 'chrome-extension://abc' })
    expect(safePresentationUrl('blob:chrome-extension://abc/0f8e')).toBe('blob:chrome-extension://abc/0f8e')
    expect(safePresentationUrl('blob:chrome-extension://other/0f8e')).toBeUndefined()
    expect(safePresentationUrl('blob:https://www.twitch.tv/0f8e')).toBeUndefined()
    expect(safePresentationUrl('https://example.com/frame.jpg')).toBe('https://example.com/frame.jpg')
  })
})
