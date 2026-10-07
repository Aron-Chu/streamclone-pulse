// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { MyMomentsPage } from '../src/options/MyMomentsPage.tsx'
import { MomentListItem } from '../src/ui/library/LibraryPrimitives.tsx'
import type { LibraryMoment } from '../src/ui/library/model.ts'
import type { MyMomentsSnapshot } from '../src/shared/myMoments.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const moment: LibraryMoment = { id: 'bk', channel: 'xqc', title: 'Chat spike', vodId: '1234567890', streamId: '123456', offsetSeconds: 754, availability: 'available', note: '', savedAt: Date.UTC(2026, 9, 1) }
const snapshot: MyMomentsSnapshot = {
  scope: 'test|account:one', production: true, bookmarksState: 'ready', bookmarksAvailable: true, localNotes: {}, deviceBookmarks: [],
  moments: [moment], collections: [], preferences: { captureHistory: true, retentionDays: 30 }, membership: 'free',
  storage: { usedBytes: 0, limitBytes: 25 * 1048576, persistence: 'unknown' }, sync: { kind: 'local' },
}

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren() })

async function mountPage(backendUrl: string) {
  const stored: Record<string, unknown> = { backendUrl, localBackendOptIn: true }
  const listeners = new Set<(changes: Record<string, chrome.storage.StorageChange>) => void>()
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension', sendMessage: vi.fn(async (message: { type: string }) => message.type === 'MY_MOMENTS' ? { type: 'MY_MOMENTS', snapshot: structuredClone(snapshot) } : undefined) },
    storage: {
      sync: { get: vi.fn(async () => ({ ...stored })), set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(stored, items) }) },
      local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) },
      onChanged: { addListener: (listener: never) => listeners.add(listener), removeListener: (listener: never) => listeners.delete(listener) },
    },
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) }) }
  await act(async () => root.render(createElement(MyMomentsPage)))
  await settle()
  return {
    analyticsHref: () => host.querySelector<HTMLAnchorElement>('a[aria-label^="Open analytics for"]')?.getAttribute('href'),
    switchBackend: async (next: string) => {
      stored.backendUrl = next
      await act(async () => { for (const listener of listeners) listener({ backendUrl: { newValue: next } }) })
      await settle()
    },
    cleanup: () => act(() => root.unmount()),
  }
}

it('points the My Moments Analytics link at the local portal when the extension uses the local backend', async () => {
  const page = await mountPage('http://localhost:8081')
  try {
    expect(page.analyticsHref()).toBe('http://localhost:5173/analytics/xqc/123456#t=754')
  } finally { page.cleanup() }
})

it('keeps production for the hosted backend and follows a backend switch without a reload', async () => {
  const page = await mountPage('https://api.streampulse.stream')
  try {
    expect(page.analyticsHref()).toBe('https://streampulse.stream/analytics/xqc/123456#t=754')
    await page.switchBackend('http://localhost:8081')
    expect(page.analyticsHref()).toBe('http://localhost:5173/analytics/xqc/123456#t=754')
  } finally { page.cleanup() }
})

it('uses the given origin on a list row and production when none is given', () => {
  const row = (analyticsOrigin?: string) => renderToStaticMarkup(createElement(MomentListItem, { moment, personalWorkspace: true, analyticsOrigin, recent: false, busy: false,
    onSave: () => undefined, onEdit: () => undefined, onRemove: () => undefined }))
  expect(row('http://localhost:5173')).toContain('href="http://localhost:5173/analytics/xqc/123456#t=754"')
  expect(row()).toContain('href="https://streampulse.stream/analytics/xqc/123456#t=754"')
})
