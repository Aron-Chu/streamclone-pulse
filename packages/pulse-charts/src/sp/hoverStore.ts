/** Hover / keyboard cursor store. Readouts subscribe; the chart never commits for it. */
import type { SpHit, SpHoverStore } from './types.ts'

export function createSpHoverStore(): SpHoverStore {
  let hit: SpHit | null = null
  const subs = new Set<() => void>()
  const key = (h: SpHit | null) => h && h.source + h.index + ':' + h.bar?.fromIndex
  return {
    get: () => hit,
    set(next) {
      if (next === hit || key(next) === key(hit)) return
      hit = next
      subs.forEach(cb => cb())
    },
    subscribe: cb => (subs.add(cb), () => void subs.delete(cb)),
  }
}
