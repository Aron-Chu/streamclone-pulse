// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { MyMomentsPage } from '../src/options/MyMomentsPage.tsx'
import { momentContextFromMinutes } from '../src/shared/momentMinute.ts'
import type { LibraryMoment } from '../src/ui/library/model.ts'
import type { MyMomentsSnapshot } from '../src/shared/myMoments.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// jsdom has no modal dialogs; browser runs cover focus and Escape.
Object.defineProperties(HTMLDialogElement.prototype, {
  showModal: { configurable: true, value() { this.setAttribute('open', '') } },
  close: { configurable: true, value() { this.removeAttribute('open') } },
})

/**
 * PV-1 (2026-10-18): My Moments never gave Preview any data, so every
 * bookmark's Preview said its stats were unavailable. The page now reads each
 * listed moment's minute from the public minutes API by stream id and offset.
 */
const saved = Date.UTC(2026, 9, 18, 23, 50)
const live: LibraryMoment = { id: 'live', channel: 'xqc', title: 'Chat spike', vodId: null, streamId: '321911879770', offsetSeconds: 3884, availability: 'unresolved', note: '', savedAt: saved }
const vodOnly: LibraryMoment = { id: 'vod', channel: 'xqc', title: 'Old replay', vodId: '2806037629', offsetSeconds: 100, availability: 'available', note: '', savedAt: saved - 60_000 }
const snapshot: MyMomentsSnapshot = {
  scope: 'test|account:one', production: true, bookmarksState: 'ready', bookmarksAvailable: true, localNotes: {}, deviceBookmarks: [],
  moments: [live, vodOnly], collections: [], preferences: { captureHistory: true, retentionDays: 30 }, membership: 'free',
  storage: { usedBytes: 0, limitBytes: 25 * 1048576, persistence: 'unknown' }, sync: { kind: 'local' },
}
/** What the worker answers: `/minutes` rows as the server sends them, emotes unsorted. */
const minutes = {
  streamId: '321911879770', channel: 'xqc', startedAt: '2026-10-18T21:45:37Z', updatedAt: 1,
  minutes: [-1, 0, 1].map(relative => ({
    offsetSeconds: 3863 + relative * 60, chatCount: relative ? 300 : 817,
    ...(relative ? {} : { totalEmoteCount: 604, viewerAvg: 29412, viewerSamples: 3,
      topEmotes: [{ name: 'forsenCD', provider: '7tv', count: 47 }, { name: 'LOL', provider: 'twitch', count: 224 }, { name: 'LO', provider: 'ffz', count: 113 }, { name: 'Sadge', provider: '7tv', count: 12 }] }),
  })),
}

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren() })

async function mountPage() {
  const sendMessage = vi.fn(async (message: { type: string; streamId?: string; offsetSeconds?: number }) => {
    if (message.type === 'MY_MOMENTS') return { type: 'MY_MOMENTS', snapshot: structuredClone(snapshot) }
    if (message.type === 'MOMENT_MINUTE') return { type: 'MOMENT_MINUTE', context: momentContextFromMinutes(minutes, { streamId: message.streamId!, offsetSeconds: message.offsetSeconds! }, { capturedAt: saved }) }
    return undefined
  })
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension', onMessage: { addListener: vi.fn(), removeListener: vi.fn() }, sendMessage },
    storage: {
      sync: { get: vi.fn(async () => ({ backendUrl: 'https://api.streampulse.stream' })), set: vi.fn(async () => undefined) },
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
      onChanged: { addListener: () => undefined, removeListener: () => undefined },
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }) }
  await act(async () => root.render(createElement(MyMomentsPage)))
  await settle()
  return {
    host, sendMessage,
    preview: async (title: string) => {
      const button = host.querySelector<HTMLButtonElement>(`button[aria-label="Preview: ${title}"]`)!
      await act(async () => { button.click() })
      await settle()
      return host.querySelector<HTMLDialogElement>('dialog[open]')!
    },
    close: async () => { await act(async () => { host.querySelector<HTMLButtonElement>('dialog[open] button[aria-label^="Close"]')!.click() }) },
    cleanup: () => act(() => root.unmount()),
  }
}

it('shows the minute’s viewers, chat and emotes in Preview, most used emotes first', async () => {
  const page = await mountPage()
  try {
    // One read when the list opens, for the moment that has a stream; none for a VOD-only save.
    const reads = page.sendMessage.mock.calls.map(([message]) => message).filter(message => message.type === 'MOMENT_MINUTE')
    expect(reads).toEqual([{ type: 'MOMENT_MINUTE', streamId: '321911879770', offsetSeconds: 3884 }])
    // The list rows are unchanged: the stats live in Preview.
    expect(page.host.querySelector('.pl-glance')).toBeNull()

    const dialog = await page.preview('Chat spike')
    const stats = [...dialog.querySelectorAll('.pl-moment-stats > div')].map(item => [item.querySelector('dt')?.textContent, item.querySelector('dd')?.textContent])
    expect(stats).toEqual([['Viewers', (29412).toLocaleString()], ['Chat / min', '817'], ['Emotes / min', '604']])
    expect([...dialog.querySelectorAll('.pl-emote-name strong')].map(name => name.textContent)).toEqual(['LOL', 'LO', 'forsenCD'])
    // One bar per emote (uses per minute · share of the minute's emote uses); the measuring notes have left Preview.
    expect([...dialog.querySelectorAll('.pl-emote-usage')].map(usage => usage.textContent)).toEqual([`${(224).toLocaleString()}/min · 37%`, '113/min · 19%', '47/min · 8%'])
    for (const text of ['Emote density', 'How these rates are measured', 'About emote usage']) expect(dialog.textContent).not.toContain(text)
    expect(dialog.textContent).not.toContain('Moment stats are unavailable')
    // No hedge lines: no snapshot label, coverage note, missing-comparison line, header tag or History footnote.
    for (const text of ['Saved analysis snapshot', 'Selected minute', 'Stream comparison unavailable', 'No current live thumbnail', 'Previewing does not add to History']) {
      expect(dialog.textContent).not.toContain(text)
    }
    expect(dialog.querySelector('.pl-around-head .pl-tag')).toBeNull()
    // Opening Preview reads nothing more.
    expect(page.sendMessage.mock.calls.filter(([message]) => message.type === 'MOMENT_MINUTE')).toHaveLength(1)
    // One screen: no tabs. The chart draws the three measured minutes, the moment's own highlighted.
    expect(dialog.querySelectorAll('[role="tab"]')).toHaveLength(0)
    expect([...dialog.querySelectorAll('.pl-around-chart rect[data-minute]')].map(bar => bar.getAttribute('data-minute'))).toEqual(['-1', '0', '1'])
    expect(dialog.querySelector('.pl-around-chart rect[data-minute="0"]')?.getAttribute('fill')).toMatch(/^url\(#/)
    // Analysis opens the session page at this minute; no VOD id, so no Clip.
    expect(dialog.querySelector<HTMLAnchorElement>('.pl-around-actions a[href*="/analytics/"]')?.href).toMatch(/\/analytics\/xqc\/321911879770#t=3884$/)
    expect([...dialog.querySelectorAll('button')].some(button => button.textContent?.includes('Clip'))).toBe(false)

    await page.close()
    const other = await page.preview('Old replay')
    expect(other.textContent).toContain('Moment stats are unavailable; missing values are not zero.')
    expect(other.querySelector('.pl-around-chart')).toBeNull()
    // A VOD and no stream: Watch and Clip, but no session page to open.
    expect([...other.querySelectorAll('.pl-around-actions > *')].map(item => item.textContent?.replace(/[^\x20-\x7e]/g, '').trim())).toEqual(['Watch', 'Clip'])
  } finally { page.cleanup() }
})
