// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LibraryMoment } from '../src/ui/library/model.ts'
import type { MyMomentsSnapshot } from '../src/shared/myMoments.ts'
import type { SavedPicture } from '../src/shared/momentPictureStore.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, value() { this.setAttribute('open', '') } },
  close: { configurable: true, value() { this.removeAttribute('open') } },
})

const rows = vi.hoisted(() => new Map<string, SavedPicture>())
vi.mock('../src/shared/momentPictureStore.ts', async importOriginal => {
  const real = await importOriginal<typeof import('../src/shared/momentPictureStore.ts')>()
  return { ...real, momentPictures: new real.MomentPictureStore({
    all: async () => [...rows.values()],
    get: async key => rows.get(key),
    put: async picture => { rows.set(picture.key, picture) },
    remove: async keys => { for (const key of keys) rows.delete(key) },
  }) }
})
const { MyMomentsPage } = await import('../src/options/MyMomentsPage.tsx')

/**
 * Removing a bookmark in Preview takes its picture with it (the worker drops
 * pictures whose moment is gone). Undo saves the moment again, under a new id
 * with an account; the page puts back the picture it was showing.
 */
const scope = 'test|account:one'
const identity = 'xqc:2806037629:100'
const key = `${scope}\n${identity}`
const moment: LibraryMoment = { id: 'first', channel: 'xqc', title: 'Old replay', vodId: '2806037629', offsetSeconds: 100, availability: 'available', note: '', savedAt: Date.UTC(2026, 9, 18) }
const picture: SavedPicture = { key, scope, identity, image: new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' }), offset: 102, savedAt: 1_000, bytes: 3 }
const base: MyMomentsSnapshot = {
  scope, production: true, bookmarksState: 'ready', bookmarksAvailable: true, localNotes: {}, deviceBookmarks: [],
  moments: [moment], collections: [], preferences: { captureHistory: true, retentionDays: 30 }, membership: 'free',
  storage: { usedBytes: 0, limitBytes: 25 * 1048576, persistence: 'unknown' }, sync: { kind: 'local' },
}

beforeEach(() => {
  rows.clear()
  rows.set(key, picture)
  let n = 0
  // jsdom has no object URLs.
  Object.assign(URL, { createObjectURL: () => `blob:${location.origin}/${++n}`, revokeObjectURL: () => undefined })
})
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren() })

async function removeThenUndo(enabled: boolean) {
  let moments = [moment]
  const sendMessage = vi.fn(async (message: { type: string; action?: string; command?: { kind: string } }) => {
    if (message.type !== 'MY_MOMENTS') return undefined
    if (message.command?.kind === 'unsave') { moments = []; rows.delete(key) }
    if (message.command?.kind === 'save') moments = [{ ...moment, id: 'again' }]
    return { type: 'MY_MOMENTS', snapshot: { ...structuredClone(base), moments: structuredClone(moments) } }
  })
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension', sendMessage },
    storage: {
      sync: { get: vi.fn(async () => ({ backendUrl: 'https://api.streampulse.stream', momentPicturesEnabled: enabled })), set: vi.fn(async () => undefined) },
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }) }
  const click = async (selector: string) => { await act(async () => { host.querySelector<HTMLButtonElement>(selector)!.click() }); await settle() }
  await act(async () => root.render(createElement(MyMomentsPage)))
  await settle()
  expect(host.querySelector('.pl-moment img[src^="blob:"]')).not.toBeNull()
  await click('button[aria-label="Preview: Old replay"]')
  expect(host.querySelector('dialog[open] .pl-around-frame img')).not.toBeNull()
  await click('dialog[open] button[aria-label="Remove bookmark: Old replay"]')
  expect(rows.has(key)).toBe(false)
  await click('dialog[open] .pl-around-undo button')
  expect(host.querySelector('dialog[open] button[aria-label="Remove bookmark: Old replay"]')).not.toBeNull()
  return { host, cleanup: () => act(() => root.unmount()) }
}

it('Undo in Preview brings the moment’s picture back with it', async () => {
  const page = await removeThenUndo(true)
  try {
    expect(rows.get(key)).toMatchObject({ scope, identity, offset: 102, savedAt: 1_000 })
    expect(page.host.querySelector('dialog[open] .pl-around-frame img')).not.toBeNull()
  } finally { page.cleanup() }
})

it('with Moment pictures off, Undo keeps nothing new', async () => {
  const page = await removeThenUndo(false)
  try {
    expect(rows.has(key)).toBe(false)
  } finally { page.cleanup() }
})
