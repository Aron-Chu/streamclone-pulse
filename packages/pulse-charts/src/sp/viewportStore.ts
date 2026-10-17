/**
 * The viewport store: one rAF loop drives the visual range toward the target.
 * Continuous input (several targets in a row) uses the follower (tau 36 ms);
 * an isolated animated jump uses a 200 ms tween on cubic-bezier(.16,1,.3,1);
 * { animate: false } and reduced motion jump. Settle fires once, when the
 * visual range has reached the target and held it for one frame.
 * Frames mutate one visual object in place: no allocation per frame.
 */
import { spPerfFrame, spPerfGesture } from '../perfMarks.ts'
import type { SpRange, SpViewportStore, SpViewportStoreOptions } from './types.ts'

/** cubic-bezier(x1, y1, x2, y2) as y(x), solved by bisection. */
export function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const at = (a: number, b: number, t: number) => (((1 + 3 * a - 3 * b) * t + 3 * b - 6 * a) * t + 3 * a) * t
  return x => {
    if (x <= 0 || x >= 1) return x <= 0 ? 0 : 1
    let lo = 0, hi = 1, t = x
    for (let i = 0; i < 24; i += 1) {
      t = (lo + hi) / 2
      if (at(x1, x2, t) < x) lo = t
      else hi = t
    }
    return at(y1, y2, t)
  }
}

export const SP_EASE = bezier(0.16, 1, 0.3, 1)

type Sub = (value: any) => void // eslint-disable-line @typescript-eslint/no-explicit-any

export function createSpViewportStore(o: SpViewportStoreOptions): SpViewportStore {
  const raf = o.raf ?? ((cb: (t: number) => void) => requestAnimationFrame(cb))
  const now = o.now ?? (() => performance.now())
  const reduced = o.reducedMotion ?? (() => typeof matchMedia == 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  let count = Math.max(1, o.count)
  const clamp = (r: SpRange): SpRange => {
    const span = Math.min(count - 1, Math.max(1, o.minSpan ?? 1, Math.round(r.endIndex - r.startIndex)))
    const s = Math.max(0, Math.min(count - 1 - span, Math.round(r.startIndex)))
    return { startIndex: s, endIndex: s + span }
  }
  let target = clamp(o.initial ?? { startIndex: 0, endIndex: count - 1 })
  const visual = { ...target }
  const from = { ...target }
  // mode: 0 idle, 1 tween, 2 follow, 3 hold (settle on the next frame)
  let mode = 0, id = 0, last = 0, t0 = 0, moving = false
  // subscribers: target, frame, settle, gesture
  const subs = [0, 1, 2, 3].map(() => new Set<Sub>())
  const sub = (k: number) => (cb: Sub) => (subs[k]!.add(cb), () => void subs[k]!.delete(cb))
  const emit = (k: number, v?: unknown) => subs[k]!.forEach(cb => cb(v))
  const gesture = (on: boolean) => {
    if (moving === on) return
    moving = on
    spPerfGesture(on)
    emit(3, on)
  }
  const toward = (a: SpRange, k: number) => {
    visual.startIndex = a.startIndex + (target.startIndex - a.startIndex) * k
    visual.endIndex = a.endIndex + (target.endIndex - a.endIndex) * k
  }
  const tick = (t: number) => {
    id = 0
    if (moving) spPerfFrame(t - last)
    const dt = Math.min(64, Math.max(0, t - last))
    last = t
    if (mode === 3) {
      mode = 0
      gesture(false)
      emit(2, { ...target })
      return
    }
    if (mode === 1) {
      const k = SP_EASE((t - t0) / (o.tweenMs ?? 200))
      toward(from, k)
      if (k >= 1) mode = 3
    } else if (mode === 2) {
      toward(visual, 1 - Math.exp(-dt / (o.tauMs ?? 36)))
      if (Math.abs(target.startIndex - visual.startIndex) + Math.abs(target.endIndex - visual.endIndex) < 0.002) mode = 3
    }
    if (mode === 3) Object.assign(visual, target)
    emit(1, visual)
    id = raf(tick)
  }

  const store: SpViewportStore = {
    getTarget: () => target,
    getVisual: () => visual,
    getCount: () => count,
    isMoving: () => moving,
    setTarget(next, opts) {
      const c = clamp(next)
      if (c.startIndex === target.startIndex && c.endIndex === target.endIndex) return
      target = c
      emit(0)
      gesture(true)
      if (opts?.animate === false || reduced()) {
        Object.assign(visual, c)
        mode = 3
        emit(1, visual)
      } else if (mode) mode = 2
      else {
        Object.assign(from, visual)
        t0 = now()
        mode = 1
      }
      if (!id) {
        last = now()
        id = raf(tick)
      }
    },
    setCount(next) {
      next = Math.max(1, next)
      if (next === count) return
      const full = target.startIndex <= 0 && target.endIndex >= count - 1
      count = next
      store.setTarget(full ? { startIndex: 0, endIndex: next - 1 } : target, { animate: full })
    },
    subscribeTarget: sub(0),
    subscribeFrame: sub(1),
    subscribeSettle: sub(2),
    subscribeGesture: sub(3),
    destroy() {
      if (id) (o.cancelRaf ?? cancelAnimationFrame)(id)
      id = mode = 0
      subs.forEach(s => s.clear())
    },
  }
  return store
}
