/**
 * Which buckets the locks' warm-up reads (L1, hub rail board 2026-11-02): the
 * 3 busiest closed bars by chat, then the spike bar of each of the 5 most-used
 * emotes (the bar the emote lock's "Who drove it" reads), one server bucket
 * each, no repeats, at most 8. The newest bar is left out: it is still filling.
 */
import { HUB_WARM_MAX } from '../../../../lib/hubLockWarmup'
import type { HubActivityPoint } from '../../../../lib/publicHub'
import { emoteMapData, emoteSpike } from './hubV5EmoteMapModel'

export const WARM_BUSIEST = 3
export const WARM_EMOTES = 5

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const measured = (p: HubActivityPoint) => p.hasChatRollup !== false && !p.gapKind && finite(p.chat)

export function lockWarmTargets(points: readonly HubActivityPoint[], bucketMinutes: number): number[] {
  if (!(bucketMinutes > 0)) return []
  const slot = bucketMinutes * 60_000
  const ordered = points.filter((p) => p && finite(p.t)).slice().sort((a, b) => a.t - b.t)
  const closed = ordered.slice(0, -1)
  const out: number[] = []
  const add = (t: number) => {
    const b = Math.floor(t / slot) * slot
    if (out.length < HUB_WARM_MAX && !out.includes(b)) out.push(b)
  }
  for (const p of closed.filter((q) => measured(q) && q.bucketComplete !== false).sort((a, b) => b.chat! - a.chat!).slice(0, WARM_BUSIEST)) add(p.t)
  const newest = ordered[ordered.length - 1]?.t
  const data = emoteMapData(points, bucketMinutes)
  if (data) {
    const top = data.emotes.slice().sort((a, b) => b.c24 - a.c24).slice(0, WARM_EMOTES)
    for (const a of top) {
      const spike = emoteSpike(data, a, 'all')
      if (spike.peak >= 0 && spike.peakT !== newest) add(spike.peakT)
    }
  }
  return out
}

/** The bar [t, endT) holds a measured bucket, so its lock would read (a gap bar reads nothing). */
export function lockWarmBar(points: readonly HubActivityPoint[], t: number, endT: number): boolean {
  return points.some((p) => p && finite(p.t) && p.t >= t && p.t < endT && measured(p))
}
