// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PulsePayload } from '../src/shared/messages.ts'
import { StreamRecapSection } from '../src/ui/StreamRecapSection.tsx'

vi.mock('../src/content/bridge.ts', () => ({ sendBackgroundMessage: vi.fn(async () => ({ type: 'BOOKMARKS', items: [] })) }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

/**
 * Audit 2026-11-26 finding 13: Overlay keeps the recap mounted and passes the
 * live flag, so a stream that ends (or comes back) while the panel is open
 * re-renders the same section with the other flag. Today's shape never threw
 * (a render with no hooks counts as a fresh mount), but a hook above the live
 * return plus one below it does ("Rendered more hooks than during the previous
 * render"). This keeps the section safe to flip.
 */
const payload = {
  login: 'xqc', streamId: '123456', isLive: false, tracking: true, currentOffsetSeconds: 600,
  startedAt: '2026-10-17T12:00:00.000Z', endedAt: '2026-10-17T13:00:00.000Z',
  rollups: Array.from({ length: 10 }, (_, index) => ({ offsetSeconds: index * 60, chatCount: 20 + index, sevenTvEmoteCount: 4, totalEmoteCount: 8 })),
  lanes: { composite: [], chat: [], seventv: [] }, recap: null, peaks: [],
} as PulsePayload

let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

function draw(isLive: boolean) {
  return act(async () => root.render(
    <StreamRecapSection payload={payload} backendUrl="https://api.example.test" uiState="ready" isLive={isLive}
      onJump={() => undefined} onAnalytics={() => undefined} onOpenAnalytics={() => undefined} />))
}

describe('the recap while its stream flips live and ended', () => {
  it('shows after the stream ends and hides when it comes back, without throwing', async () => {
    await draw(true)
    expect(host.textContent).toBe('')
    await draw(false)
    expect(host.textContent).toContain('Recap')
    await draw(true)
    expect(host.textContent).toBe('')
  })
})
