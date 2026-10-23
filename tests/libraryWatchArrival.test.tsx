// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { LibraryWorkspace } from '../src/ui/library/LibraryWorkspace.tsx'
import type { LibraryRepository } from '../src/ui/library/model.ts'
import type { MyMomentsSnapshot } from '../src/shared/myMoments.ts'
import { MOMENT_ARRIVAL_STORAGE_KEY } from '../src/shared/momentArrival.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

function snapshot(captureHistory: boolean): MyMomentsSnapshot {
  return {
    scope: 'test|device', production: true, bookmarksState: 'not_linked', bookmarksAvailable: false, localNotes: {}, deviceBookmarks: [],
    moments: [{ id: 'm1', channel: 'jerma985', title: 'Big laugh', vodId: '2903671992', streamId: '42', offsetSeconds: 3_879, availability: 'available', savedAt: 1, note: '' }],
    collections: [], preferences: { captureHistory, retentionDays: 30 }, membership: 'free',
    storage: { usedBytes: 0, limitBytes: 25 * 1048576, persistence: 'unknown' }, sync: { kind: 'local' },
  }
}

async function openWatchLink(captureHistory: boolean) {
  const set = vi.fn(async () => {})
  vi.stubGlobal('chrome', { storage: { local: { set } } })
  const repository: LibraryRepository = { load: async () => snapshot(captureHistory), execute: async () => snapshot(captureHistory), export: async () => '{}' }
  const host = document.createElement('div')
  document.body.append(host)
  // jsdom does not open tabs.
  host.addEventListener('click', event => event.preventDefault())
  const root = createRoot(host)
  await act(async () => root.render(createElement(LibraryWorkspace, { repository, onExport: () => {} })))
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  const link = host.querySelector<HTMLAnchorElement>('a[aria-label^="Watch moment: Big laugh"]')
  expect(link?.href).toBe('https://www.twitch.tv/videos/2903671992?t=3879s')
  await act(async () => { link!.click() })
  const text = host.textContent ?? ''
  act(() => root.unmount())
  return { set, text }
}

it('a Watch link in My Moments leaves the note the new tab lands on', async () => {
  const { set, text } = await openWatchLink(true)
  expect(set).toHaveBeenCalledWith({
    [MOMENT_ARRIVAL_STORAGE_KEY]: expect.objectContaining({ vodId: '2903671992', offsetSeconds: 3_879, clock: 'stream', source: 'library', login: 'jerma985', streamId: '42', title: 'Big laugh' }),
  })
  expect(text).toContain('Opened on Twitch. 10 s of playback there adds it to History.')
})

it('does not promise History while it is paused', async () => {
  const { text } = await openWatchLink(false)
  expect(text).toContain('Opened on Twitch.')
  expect(text).not.toContain('adds it to History')
})
