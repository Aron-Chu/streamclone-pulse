import { describe, expect, it } from 'vitest'
import { bezier, createSpViewportStore, SP_EASE } from '../src/sp/viewportStore.ts'
import { createSpHoverStore } from '../src/sp/hoverStore.ts'
import type { SpHit, SpRange, SpViewportStoreOptions } from '../src/sp/types.ts'

/** A fake clock and rAF queue: frame() runs the queued callbacks at now + dt. */
function harness(o: Partial<SpViewportStoreOptions> & { count: number }) {
  let t = 1000, nextId = 1
  const queue = new Map<number, (now: number) => void>()
  const cancelled: number[] = []
  const store = createSpViewportStore({
    reducedMotion: () => false,
    ...o,
    now: () => t,
    raf: cb => {
      const id = nextId++
      queue.set(id, cb)
      return id
    },
    cancelRaf: id => {
      cancelled.push(id)
      queue.delete(id)
    },
  })
  const log = { frames: 0, settles: [] as SpRange[], gestures: [] as boolean[], targets: 0 }
  store.subscribeFrame(() => void (log.frames += 1))
  store.subscribeSettle(r => void log.settles.push(r))
  store.subscribeGesture(on => void log.gestures.push(on))
  store.subscribeTarget(() => void (log.targets += 1))
  const frame = (dt = 16) => {
    t += dt
    const cbs = [...queue.values()]
    queue.clear()
    cbs.forEach(cb => cb(t))
  }
  const run = (max = 500) => {
    let i = 0
    while (queue.size && i++ < max) frame()
    return i
  }
  return { store, log, frame, run, pending: () => queue.size, cancelled, advance: (dt: number) => void (t += dt) }
}

describe('SP_EASE', () => {
  it('is cubic-bezier(.16,1,.3,1): fixed ends, monotone, fast start', () => {
    expect(SP_EASE(0)).toBe(0)
    expect(SP_EASE(1)).toBe(1)
    expect(SP_EASE(-1)).toBe(0)
    expect(SP_EASE(2)).toBe(1)
    let prev = 0
    for (let x = 0.01; x < 1; x += 0.01) {
      const y = SP_EASE(x)
      expect(y).toBeGreaterThanOrEqual(prev)
      prev = y
    }
    expect(SP_EASE(0.5)).toBeGreaterThan(0.85)
    expect(SP_EASE(0.5)).toBeLessThan(1)
    const linear = bezier(0, 0, 1, 1)
    for (const x of [0.1, 0.25, 0.5, 0.9]) expect(linear(x)).toBeCloseTo(x, 5)
  })
})

describe('createSpViewportStore', () => {
  it('starts on the whole data, clamps targets and keeps whole samples', () => {
    const { store } = harness({ count: 100, minSpan: 4 })
    expect(store.getTarget()).toEqual({ startIndex: 0, endIndex: 99 })
    expect(store.getVisual()).toEqual({ startIndex: 0, endIndex: 99 })
    store.setTarget({ startIndex: -20, endIndex: 10.4 }, { animate: false })
    expect(store.getTarget()).toEqual({ startIndex: 0, endIndex: 30 })
    store.setTarget({ startIndex: 95, endIndex: 96 }, { animate: false })
    expect(store.getTarget()).toEqual({ startIndex: 95, endIndex: 99 })
    store.setTarget({ startIndex: -1e9, endIndex: 1e9 }, { animate: false })
    expect(store.getTarget()).toEqual({ startIndex: 0, endIndex: 99 })
  })

  it('an isolated jump tweens over 200 ms on SP_EASE, then settles once', () => {
    const { store, log, frame, run } = harness({ count: 1000 })
    const visual = store.getVisual()
    store.setTarget({ startIndex: 400, endIndex: 599 })
    expect(store.isMoving()).toBe(true)
    expect(log.gestures).toEqual([true])
    frame(100)
    // from 0..999 toward 400..599 at k = SP_EASE(0.5)
    const k = SP_EASE(0.5)
    expect(store.getVisual().startIndex).toBeCloseTo(400 * k, 6)
    expect(store.getVisual().endIndex).toBeCloseTo(999 + (599 - 999) * k, 6)
    expect(log.settles).toHaveLength(0)
    frame(100)
    expect(store.getVisual()).toEqual({ startIndex: 400, endIndex: 599 })
    expect(log.settles).toHaveLength(0)
    run()
    expect(log.settles).toEqual([{ startIndex: 400, endIndex: 599 }])
    expect(log.gestures).toEqual([true, false])
    expect(store.isMoving()).toBe(false)
    // one visual object, mutated in place
    expect(store.getVisual()).toBe(visual)
  })

  it('continuous input follows (tau 36 ms) and settles once per gesture', () => {
    const { store, log, frame, run, pending } = harness({ count: 5000 })
    let s = 1000
    store.setTarget({ startIndex: s, endIndex: s + 999 })
    for (let i = 0; i < 40; i += 1) {
      frame(16)
      s += 7
      store.setTarget({ startIndex: s, endIndex: s + 999 })
    }
    expect(log.settles).toHaveLength(0)
    expect(log.gestures).toEqual([true])
    // the follower lags the target while input continues
    expect(store.getVisual().startIndex).toBeLessThan(s)
    expect(store.getVisual().startIndex).toBeGreaterThan(s - 40)
    const frames = run()
    expect(frames).toBeLessThan(60)
    expect(pending()).toBe(0)
    expect(log.settles).toEqual([{ startIndex: s, endIndex: s + 999 }])
    expect(log.gestures).toEqual([true, false])
    expect(store.getVisual()).toEqual(store.getTarget())
    // a second gesture settles once more
    store.setTarget({ startIndex: 0, endIndex: 499 })
    run()
    expect(log.settles).toHaveLength(2)
    expect(log.gestures).toEqual([true, false, true, false])
  })

  it('animate:false and reduced motion jump at once and settle on the next frame', () => {
    for (const reduced of [false, true]) {
      const { store, log, frame, pending } = harness({ count: 1000, reducedMotion: () => reduced })
      store.setTarget({ startIndex: 10, endIndex: 109 }, reduced ? undefined : { animate: false })
      expect(store.getVisual()).toEqual({ startIndex: 10, endIndex: 109 })
      expect(log.frames).toBe(1)
      expect(log.settles).toHaveLength(0)
      frame()
      expect(log.settles).toEqual([{ startIndex: 10, endIndex: 109 }])
      expect(pending()).toBe(0)
      expect(log.gestures).toEqual([true, false])
    }
  })

  it('ignores a target equal to the current one', () => {
    const { store, log, pending } = harness({ count: 100 })
    store.setTarget({ startIndex: 0, endIndex: 99 })
    expect(log.targets).toBe(0)
    expect(pending()).toBe(0)
    expect(log.gestures).toEqual([])
  })

  it('setCount: a full view follows live growth; a zoomed view stays put', () => {
    const a = harness({ count: 100 })
    a.store.setCount(130)
    expect(a.store.getTarget()).toEqual({ startIndex: 0, endIndex: 129 })
    a.run()
    expect(a.store.getVisual()).toEqual({ startIndex: 0, endIndex: 129 })
    expect(a.log.settles).toHaveLength(1)

    const b = harness({ count: 100, initial: { startIndex: 20, endIndex: 59 } })
    b.store.setCount(130)
    expect(b.store.getCount()).toBe(130)
    expect(b.store.getTarget()).toEqual({ startIndex: 20, endIndex: 59 })
    expect(b.pending()).toBe(0)
  })

  it('destroy cancels the loop and drops subscribers', () => {
    const { store, log, cancelled, pending } = harness({ count: 1000 })
    store.setTarget({ startIndex: 100, endIndex: 199 })
    expect(pending()).toBe(1)
    store.destroy()
    expect(cancelled).toHaveLength(1)
    expect(pending()).toBe(0)
    store.setTarget({ startIndex: 300, endIndex: 399 }, { animate: false })
    expect(log.frames).toBe(0)
  })
})

describe('createSpHoverStore', () => {
  it('notifies only when the hit changes', () => {
    const hover = createSpHoverStore()
    let calls = 0
    const off = hover.subscribe(() => void (calls += 1))
    const hit = (index: number, source: SpHit['source'] = 'pointer', from = 0) =>
      ({ index, source, bar: { fromIndex: from } }) as unknown as SpHit
    hover.set(hit(3))
    hover.set(hit(3))
    expect(calls).toBe(1)
    hover.set(hit(3, 'keyboard'))
    hover.set(hit(4))
    hover.set(hit(4, 'pointer', 2))
    expect(calls).toBe(4)
    hover.set(null)
    hover.set(null)
    expect(calls).toBe(5)
    expect(hover.get()).toBeNull()
    off()
    hover.set(hit(1))
    expect(calls).toBe(5)
  })
})
