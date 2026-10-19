/**
 * Performance marks for the analytics pages (`@streampulse/pulse-charts/perfMarks`).
 *
 * spMark / spMeasure always write User Timing entries, once per page load each.
 * Everything else runs only with `?debug=perf` (or `debug=wheel,perf`): a
 * long-animation-frame observer, React Profiler counts, wheel frame stats and
 * `window.__spPerf`. With the flag off those calls return at once.
 */

export interface SpPerfState {
  marks: Record<string, number>
  wheel: { frames: number; p50: number; p95: number; max: number; loaf: number }
  renders: Record<string, number>
  levelChanges: number
}

declare global {
  interface Window { __spPerf?: SpPerfState }
}

const seen = new Set<string>()
let enabled: boolean | undefined
let state: SpPerfState | null = null
let frames: number[] = []
let gesture = false

const first = (name: string) => !seen.has(name) && !!seen.add(name)

export function spPerfEnabled(): boolean {
  if (enabled === undefined) {
    try {
      enabled = (new URLSearchParams(location.search).get('debug') ?? '').split(',').includes('perf')
    } catch {
      enabled = false
    }
  }
  return enabled
}

/** The debug state, created on first use with the flag on; null otherwise. */
export function spPerf(): SpPerfState | null {
  if (spPerfEnabled() && !state) {
    state = window.__spPerf = { marks: {}, wheel: { frames: 0, p50: 0, p95: 0, max: 0, loaf: 0 }, renders: {}, levelChanges: 0 }
    try {
      new PerformanceObserver(list => {
        if (gesture && state) state.wheel.loaf += list.getEntries().length
      }).observe({ type: 'long-animation-frame' })
    } catch {
      /* no LoAF in this browser */
    }
  }
  return state
}

/** performance.mark(name), once per load. */
export function spMark(name: string): void {
  if (!first(name)) return
  try {
    performance.mark(name)
  } catch {
    /* no User Timing */
  }
  const s = spPerf()
  if (s) s.marks[name] = performance.now()
}

/** performance.measure(name, start, end?), once per load. */
export function spMeasure(name: string, startMark: string, endMark?: string): void {
  if (first(name)) {
    try {
      performance.measure(name, startMark, endMark)
    } catch {
      /* a mark is missing */
    }
  }
}

/** Gesture start/end from the viewport store; stats over all moving frames so far are computed at the end. */
export function spPerfGesture(active: boolean): void {
  const s = spPerf()
  if (!s) return
  gesture = active
  if (active || !frames.length) return
  const all = frames.slice().sort((a, b) => a - b)
  const q = (p: number) => all[Math.min(all.length - 1, Math.floor(p * all.length))]!
  s.wheel = { frames: all.length, p50: q(0.5), p95: q(0.95), max: all[all.length - 1]!, loaf: s.wheel.loaf }
}

/** One moving frame's interval (ms). */
export function spPerfFrame(ms: number): void {
  if (gesture && frames.length < 20_000) frames.push(ms)
}

export function spPerfLevelChange(): void {
  const s = spPerf()
  if (s) s.levelChanges += 1
}

/** React <Profiler onRender>: counts commits per id. Wrap only when spPerfEnabled(). */
export function spProfilerOnRender(id: string): void {
  const s = spPerf()
  if (s) s.renders[id] = (s.renders[id] ?? 0) + 1
}

/** Tests only: forget marks and the flag. */
export function resetSpPerfForTests(): void {
  seen.clear()
  enabled = undefined
  state = null
  frames = []
  gesture = false
}
