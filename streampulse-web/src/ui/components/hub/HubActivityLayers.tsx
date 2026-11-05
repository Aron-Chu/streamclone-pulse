/**
 * Hub activity chart layers (SpLayer entries, plan §1.1 item 3 and §1.5):
 *
 * - the stamp: the busiest chat bucket's top emote, a bucket total
 *   ("×3,327") whose accessible name carries the unit ("3,327 uses in 6 min");
 * - moment markers: one hairline tick per marker the caller passes.
 *
 * Both are settle layers: drawn at settle from the settled px and hidden while
 * the view moves, so nothing here runs per frame.
 */
import type { SpLayer, SpLayerContext } from '@streampulse/pulse-charts/spchart'
import { emoteDisplaySrc } from '../../../lib/emoteAssetUrl'
import { formatHubCardInt } from '../../../lib/hubBucketCardModel'
import type { HubActivitySpModel } from './hubActivitySpModel'

/** The stamp stays this far inside the plot edges (d3-v2 hub.js / chart.js). */
const STAMP_EDGE_PX = 30
/** Distance from the bar top to the stamp top (chart.js: y - 28). */
const STAMP_LIFT_PX = 28
/** The stamp's picture is drawn this wide, so it asks the CDN for the size that matches. */
const STAMP_PICTURE_PX = 20

export interface HubMarkerInput {
  key: string
  /** Event time when known, else the bucket start. */
  ms: number
}

export function stampAccessibleName(name: string, count: number, bucketMinutes: number): string {
  return `${name}: ${formatHubCardInt(count)} uses in ${formatHubCardInt(bucketMinutes)} min`
}

/** Chat peak (per minute) of the bar holding `index` at the settled level. */
function slotChatPeak(ctx: SpLayerContext, index: number): number {
  const { data, level } = ctx
  const slotMs = level.slotMs
  const ms = data.startMs + index * data.stepMs
  const slotStart = Math.floor(ms / slotMs) * slotMs
  const from = Math.max(0, Math.ceil((slotStart - data.startMs) / data.stepMs))
  const to = Math.min(data.chat.length, Math.ceil((slotStart + slotMs - data.startMs) / data.stepMs))
  let peak = 0
  for (let i = from; i < to; i += 1) {
    const value = data.chat[i]!
    if (Number.isFinite(value) && (data.coverage[i] ?? 2) !== 2 && value > peak) peak = value
  }
  return peak
}

export function hubStampLayer(model: HubActivitySpModel, emoteImages?: ReadonlyMap<string, string> | null): SpLayer | null {
  const stamp = model.stamp
  if (!stamp) return null
  const { emote } = stamp
  const imageUrl = emote.imageUrl || emoteImages?.get(emote.name.toLowerCase()) || null
  const stampSrc = imageUrl ? emoteDisplaySrc(imageUrl, STAMP_PICTURE_PX) : undefined
  return {
    id: 'hub-stamp',
    panel: 'rates',
    mode: 'settle',
    surface: 'html',
    render(ctx) {
      const x = ctx.xOfMs(stamp.t + model.bucketMs / 2)
      if (!(x > STAMP_EDGE_PX && x < ctx.width - STAMP_EDGE_PX)) return null
      const top = ctx.yRates(slotChatPeak(ctx, stamp.index)) - ctx.box.y - STAMP_LIFT_PX
      return (
        <span
          className="hub-act-stamp"
          data-hub-stamp=""
          role="img"
          aria-label={stampAccessibleName(emote.name, emote.count, model.bucketMinutes)}
          style={{ left: Math.round(x * 10) / 10, top: Math.round(top * 10) / 10 }}
        >
          {stampSrc ? <img src={stampSrc} alt="" width={STAMP_PICTURE_PX} height={STAMP_PICTURE_PX} decoding="async" referrerPolicy="no-referrer" /> : null}
          <span aria-hidden="true">×{formatHubCardInt(emote.count)}</span>
        </span>
      )
    },
  }
}

export function hubMarkersLayer(markers: readonly HubMarkerInput[]): SpLayer | null {
  if (!markers.length) return null
  return {
    id: 'hub-markers',
    panel: 'rates',
    mode: 'settle',
    render(ctx) {
      let d = ''
      for (const marker of markers) {
        const x = Math.round(ctx.xOfMs(marker.ms)) + 0.5
        if (x < 0 || x > ctx.width) continue
        d += `M${x} ${ctx.box.y}v6`
      }
      return d ? <path className="hub-act-marker" data-hub-moment-markers="" d={d} /> : null
    },
  }
}
