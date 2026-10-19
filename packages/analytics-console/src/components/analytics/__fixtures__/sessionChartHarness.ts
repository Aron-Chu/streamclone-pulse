/**
 * Shared data and helpers for the SessionSpChart tests: a session detail with
 * measured minutes, a held animation-frame queue (the viewport store settles on
 * the next frame) and a stack-width override (jsdom has no layout).
 *
 * Kept free of test-runner imports: this folder is part of the package build.
 * Each install returns its own restore; the tests call it in afterEach.
 */
import type { AnalyticsMinuteRollup, AnalyticsStreamDetail } from '../../../api.ts'

export const HARNESS_STARTED_AT = '2026-07-31T00:00:00.000Z'

export function harnessRollup(index: number, startedAt = HARNESS_STARTED_AT): AnalyticsMinuteRollup {
  return {
    minuteTs: new Date(Date.parse(startedAt) + index * 60_000).toISOString(),
    viewerAvg: 100 + (index % 40),
    chatCount: 10 + (index % 12),
    totalEmoteCount: 2 + (index % 9),
    emotes: { Kappa: 4 + (index % 8) },
  } as unknown as AnalyticsMinuteRollup
}

export function harnessDetail(
  minuteCount: number,
  options: { skip?: readonly number[]; startedAt?: string } = {},
): AnalyticsStreamDetail {
  const skip = new Set(options.skip ?? [])
  const startedAt = options.startedAt ?? HARNESS_STARTED_AT
  return {
    stream: { streamId: 'session-chart-harness', startedAt, peakViewers: 200, avgViewers: 120 },
    rollups: Array.from({ length: minuteCount }, (_, index) => index)
      .filter(index => !skip.has(index))
      .map(index => harnessRollup(index, startedAt)),
    topEmotes: [{ key: 'Kappa', name: 'Kappa', count: 11, provider: '7tv' }],
    sources: [],
  } as unknown as AnalyticsStreamDetail
}

export interface HeldFrames {
  /** Run frames until none are pending (the store has settled). */
  flush(): void
  /** Run one round of pending frames, ms after the last. */
  step(ms?: number): void
  pending(): number
  restore(): void
}

/** Hold requestAnimationFrame callbacks; `act` wraps each round (from @testing-library/react). */
export function holdFrames(act: (callback: () => void) => void): HeldFrames {
  const frames = new Map<number, FrameRequestCallback>()
  let frameId = 0
  let clock = performance.now()
  const raf = globalThis.requestAnimationFrame
  const caf = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback)
    return frameId
  }
  globalThis.cancelAnimationFrame = (key: number) => { frames.delete(key) }
  const step = (ms = 16) => {
    clock += ms
    act(() => {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach(callback => callback(clock))
    })
  }
  return {
    step,
    flush() {
      for (let round = 0; round < 100 && frames.size; round += 1) step(1000)
    },
    pending: () => frames.size,
    restore() {
      globalThis.requestAnimationFrame = raf
      globalThis.cancelAnimationFrame = caf
    },
  }
}

/** Give the chart stack a measured width (the chart reads its clientWidth). Returns the restore. */
export function setStackWidth(px: number): () => void {
  const proto = Element.prototype
  const own = Object.getOwnPropertyDescriptor(proto, 'clientWidth')
  Object.defineProperty(proto, 'clientWidth', {
    configurable: true,
    get(this: Element) {
      return this.hasAttribute('data-session-chart-stack') ? px : (own?.get?.call(this) ?? 0)
    },
  })
  return () => {
    if (own) Object.defineProperty(proto, 'clientWidth', own)
  }
}

export const viewportOf = (container: HTMLElement): [number, number] => {
  const plot = container.querySelector('[data-chart-touch-action]')!
  return [Number(plot.getAttribute('data-chart-viewport-start')), Number(plot.getAttribute('data-chart-viewport-end'))]
}

export const barMinutes = (container: HTMLElement) =>
  container.querySelector('[data-bench-plot]')?.getAttribute('data-activity-bucket-minutes')

/**
 * Turn Show on chart markers on (they are all off on every load, d3-v2
 * session-original). Ticks the checkbox inside act, so the chart re-renders.
 */
export function showOnChart(
  act: (callback: () => void) => void,
  container: HTMLElement,
  ...markers: ('moments' | 'avg' | 'live')[]
): void {
  for (const marker of markers) {
    const box = container.querySelector<HTMLInputElement>(`[data-session-marker="${marker}"]`)
    if (!box) throw new Error(`Show on chart has no ${marker} marker`)
    if (!box.checked) act(() => box.click())
  }
}

/**
 * The session navigator's Scroll zoom toggle. It lives in the navigator's (i)
 * (d3-v2 session-original): hidden until the (i) opens, so it has no
 * accessible name to query by; reading or clicking it needs no opening.
 */
export function scrollZoomToggle(container: HTMLElement): HTMLButtonElement {
  const toggle = container.querySelector<HTMLButtonElement>('[data-chart-navigator-info-panel] .hx-chart-navigator__scroll-toggle')
  if (!toggle) throw new Error('the session navigator has no Scroll zoom toggle in its (i)')
  return toggle
}
