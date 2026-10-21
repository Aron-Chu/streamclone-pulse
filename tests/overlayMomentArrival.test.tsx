// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Overlay } from '../src/ui/Overlay.tsx'
import { sendBackgroundMessage } from '../src/content/bridge.ts'
import type { TwitchPageContext } from '../src/content/twitch.ts'
import type { ExtensionVodPulseResponse } from '../src/types/vodPulseTypes.ts'
import { vodPulseToChannelPayload } from '../src/vod/vodPulseToChannelPayload.ts'
import { MOMENT_ARRIVAL_STORAGE_KEY, resetMomentArrivalPage } from '../src/shared/momentArrival.ts'
import liveReady from './e2e/fixtures/api/pulse-live-ready.json'

vi.mock('../src/content/bridge.ts', () => ({
  sendBackgroundMessage: vi.fn(async () => ({ ok: false })),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const VOD_ID = '2903671992'
const VOD: TwitchPageContext = { kind: 'vod', login: null, vodId: VOD_ID }

// A finished VOD with its minutes from 0:50 to 2:08:50.
function finishedVod(): ExtensionVodPulseResponse {
  const points = []
  for (let offset = 50; offset <= 7_730; offset += 60) points.push({ offsetSeconds: offset, chatPerMin: 40, emotesPerMin: 9, viewers: 9_000 })
  return {
    mode: 'vod',
    vodId: VOD_ID,
    provisional: false,
    channelLogin: 'jerma985',
    streamId: 'stream-jerma',
    coverageStatus: 'ready',
    startedAt: '2026-10-17T22:00:00.000Z',
    durationSeconds: 7_800,
    timeline: { bucketSeconds: 60, points },
  } as ExtensionVodPulseResponse
}

// The VOD of a stream that is still live: the backend answers with the live chart.
function liveReplay(): ExtensionVodPulseResponse {
  return { ...liveReady, mode: 'live_dvr', vodId: VOD_ID, channelLogin: 'jerma985', login: 'jerma985', provisional: false,
    resolutionState: 'live_archive_validated', retryable: false } as unknown as ExtensionVodPulseResponse
}

function storageWith(items: Map<string, unknown>) {
  const read = (keys: unknown) => {
    if (keys == null) return Object.fromEntries(items)
    const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys as object)
    return Object.fromEntries(list.filter(key => items.has(key)).map(key => [key, items.get(key)]))
  }
  return {
    get: vi.fn(async (keys?: unknown) => read(keys)),
    set: vi.fn(async (values: Record<string, unknown>) => { for (const [key, value] of Object.entries(values)) items.set(key, value) }),
    remove: vi.fn(async (keys: string | string[]) => { for (const key of [keys].flat()) items.delete(key) }),
  }
}

async function settle(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) await act(async () => { await Promise.resolve() })
}

describe('board E: a Watch link lands on its moment', () => {
  let node: HTMLDivElement
  let root: Root
  let local: Map<string, unknown>

  const props = {
    login: 'jerma985',
    context: VOD,
    effectivePlacement: 'right' as const,
    overlayMode: 'expanded' as const,
    sidebarPart: 'full' as const,
    sessionOpenedAtMs: 1,
  }

  beforeEach(() => {
    resetMomentArrivalPage(null)
    local = new Map()
    const empty = storageWith(new Map())
    vi.stubGlobal('chrome', {
      runtime: { id: 'test', getManifest: () => ({ version: '0.2.2' }), getURL: (path: string) => path },
      storage: { sync: empty, local: storageWith(local), session: empty, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    })
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.mocked(sendBackgroundMessage).mockImplementation(async () => ({ ok: false }))
    node = document.createElement('div')
    document.body.append(node)
    root = createRoot(node)
  })

  afterEach(() => {
    act(() => root.unmount())
    node.remove()
    vi.mocked(sendBackgroundMessage).mockImplementation(async () => ({ ok: false }))
    vi.unstubAllGlobals()
  })

  async function open(vodPulse = finishedVod()): Promise<void> {
    const payload = vodPulseToChannelPayload(vodPulse, 'jerma985')
    await act(async () => { root.render(<Overlay {...props} payload={payload} vodPulse={vodPulse} vodPulseLoading={false} />) })
    await settle()
  }

  const chip = () => node.querySelector<HTMLElement>('.pulse-arrival')
  const card = () => node.querySelector<HTMLElement>('[aria-label^="Selected moment at"]')

  it('locks the noted minute with its card open and says where it came from', async () => {
    local.set(MOMENT_ARRIVAL_STORAGE_KEY, { vodId: VOD_ID, offsetSeconds: 4_000, clock: 'stream', source: 'library', savedAtMs: Date.now() })
    await open()

    expect(chip()?.dataset.momentArrival).toBe('library')
    expect(chip()?.textContent).toContain('From My Moments · 01:06:40')
    expect(card()?.getAttribute('aria-label')).toMatch(/^Selected moment at 01:06\b/)
    // Read once: a reload of this tab does not land here again.
    expect(local.has(MOMENT_ARRIVAL_STORAGE_KEY)).toBe(false)
  })

  it('unlocks with ×', async () => {
    local.set(MOMENT_ARRIVAL_STORAGE_KEY, { vodId: VOD_ID, offsetSeconds: 4_000, clock: 'stream', source: 'popup', savedAtMs: Date.now() })
    await open()
    expect(chip()?.textContent).toContain('From My Moments')

    await act(async () => { node.querySelector<HTMLButtonElement>('[aria-label="Unlock this moment"]')!.click() })
    await settle()

    expect(chip()).toBeNull()
    const held = card()
    expect(held === null || held.closest('[data-chart-inspector-exiting="true"]') !== null).toBe(true)
  })

  it('lands a timestamped link on its VOD second and leaves History alone', async () => {
    resetMomentArrivalPage(`https://www.twitch.tv/videos/${VOD_ID}?t=1h6m40s`)
    await open()

    expect(chip()?.dataset.momentArrival).toBe('link')
    expect(chip()?.textContent).toContain('From link')
    expect(card()).not.toBeNull()
    await settle()
    expect(vi.mocked(sendBackgroundMessage).mock.calls.some(([request]) => (request as { type: string }).type === 'MOMENT_CAPTURE')).toBe(false)
  })

  it('selects the chart minute the landed second shows under, though buckets start mid-minute', async () => {
    // This VOD's buckets start at :50, and the chart files each under its
    // floored minute. 1:06:40 sits in the bucket from 1:05:50, which the chart
    // shows as 1:05; the minute the viewer sees for 1:06:40 is 1:06.
    resetMomentArrivalPage(`https://www.twitch.tv/videos/${VOD_ID}?t=1h6m40s`)
    await open()

    expect(chip()?.textContent).toContain('From link · 01:06:40')
    expect(card()?.getAttribute('aria-label')).toMatch(/^Selected moment at 01:06\b/)
    const readout = node.querySelector<HTMLElement>('[data-chart-readout-state="selected"]')
    expect(readout?.textContent).toContain('01:06:00')
  })

  it('takes the nearest minute when the note falls in a gap', async () => {
    local.set(MOMENT_ARRIVAL_STORAGE_KEY, { vodId: VOD_ID, offsetSeconds: 10, clock: 'stream', source: 'panel', savedAtMs: Date.now() })
    await open()

    // Data starts at 0:50; 0:10 is 40 s before it.
    expect(chip()?.textContent).toContain('From Pulse · 00:00:10')
    expect(card()).not.toBeNull()
  })

  it('locks the minute on the live chart of a replay that is still live', async () => {
    local.set(MOMENT_ARRIVAL_STORAGE_KEY, { vodId: VOD_ID, offsetSeconds: 1_230, clock: 'stream', source: 'library', savedAtMs: Date.now() })
    await open(liveReplay())

    expect(chip()?.textContent).toContain('From My Moments · 00:20:30')
    // The live chart's own minute card, right after the chip.
    expect(chip()?.nextElementSibling?.getAttribute('data-chart-inspector-kind')).toBe('minute')
    expect(node.querySelector('[aria-label^="Selected minute at"]')).not.toBeNull()
    expect(local.has(MOMENT_ARRIVAL_STORAGE_KEY)).toBe(false)
  })

  it('ignores a note for another VOD', async () => {
    local.set(MOMENT_ARRIVAL_STORAGE_KEY, { vodId: '111', offsetSeconds: 4_000, clock: 'stream', source: 'library', savedAtMs: Date.now() })
    await open()

    expect(chip()).toBeNull()
    expect(card()).toBeNull()
    expect(local.has(MOMENT_ARRIVAL_STORAGE_KEY)).toBe(true)
  })
})
