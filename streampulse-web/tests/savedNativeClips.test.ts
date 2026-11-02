import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toNativeClip } from '../src/lib/nativeClips'
import { rawNativeClip } from './fixtures/nativeClips'

const KEY = 'streampulse.saved-clips.v1'
const clip = (id: string) => toNativeClip(rawNativeClip({ id, url: `https://clips.twitch.tv/${id}` }))!

// The store keeps module state; each test starts from a fresh copy.
async function freshStore() {
  vi.resetModules()
  return import('../src/lib/savedNativeClips')
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('saved clips', () => {
  it('saves a clip id with a label, newest first, and removes it again', async () => {
    const store = await freshStore()
    expect(store.toggleSavedClip(clip('one'))).toBe('Saved in this browser.')
    expect(store.toggleSavedClip(clip('two'))).toBe('Saved in this browser.')
    const stored = JSON.parse(window.localStorage.getItem(KEY)!)
    expect(stored.version).toBe(1)
    expect(stored.items.map((item: { id: string }) => item.id)).toEqual(['two', 'one'])
    expect(Object.keys(stored.items[0]).sort()).toEqual(['channel', 'id', 'savedAt', 'title'])
    expect(stored.items[0]).toMatchObject({ title: 'Chat loses it', channel: 'xQc' })
    expect(store.toggleSavedClip(clip('two'))).toBe('Removed from saved clips.')
    store.removeSavedClip('one')
    expect(JSON.parse(window.localStorage.getItem(KEY)!).items).toEqual([])
  })

  it('stops at the limit without dropping an older save', async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ version: 1, items: Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, savedAt: i + 1, title: '', channel: '' })) }))
    const store = await freshStore()
    expect(store.toggleSavedClip(clip('extra'))).toMatch(/^100 saved clips reached/)
    expect(JSON.parse(window.localStorage.getItem(KEY)!).items).toHaveLength(100)
  })

  it('never overwrites stored data it cannot read', async () => {
    window.localStorage.setItem(KEY, '{"version":9}')
    const store = await freshStore()
    expect(store.toggleSavedClip(clip('one'))).toBe('Saved for this visit only.')
    expect(window.localStorage.getItem(KEY)).toBe('{"version":9}')
  })

  it('refuses bad ids, a wrong version or oversized data, and drops repeats', async () => {
    const { parseSavedClips } = await freshStore()
    expect(() => parseSavedClips(JSON.stringify({ version: 1, items: [{ id: 'bad id', savedAt: 1 }] }))).toThrow()
    expect(() => parseSavedClips(JSON.stringify({ version: 2, items: [] }))).toThrow()
    expect(() => parseSavedClips('x'.repeat(100_001))).toThrow()
    const items = parseSavedClips(JSON.stringify({ version: 1, items: [{ id: 'a', savedAt: 2, title: `T${String.fromCharCode(0)}itle` }, { id: 'a', savedAt: 1 }] }))
    expect(items).toEqual([{ id: 'a', savedAt: 2, title: 'Title', channel: '' }])
  })
})
