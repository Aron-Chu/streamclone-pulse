/**
 * Session chart pins (d3-designer session.js placePins, plan §2.4): numbered
 * pins for the first five Pulse Moments strip rows, in a 28 px rail above the
 * plot. Pin N is strip row N (utils/sessionStripMoments.ts), so a click calls
 * the strip's own handler and a hover lights the strip row.
 *
 * The rail is an SpChart 'top' layer: it is rendered at settle, where pins
 * closer than 46 px merge into one "1·5" cluster (a cluster click zooms to
 * it), and it follows every frame with transform writes only.
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import { recapMomentAnalyticalOffset, type StreamEdges } from '@streampulse/pulse-core'
import { clusterPins, pinClusterSpan, type SpLayer, type SpLayerContext, type SpViewportSource } from '@streampulse/pulse-charts/spchart'
import { spMark } from '@streampulse/pulse-charts/perfMarks'
import type { AnalyticsMinuteRollup, AnalyticsTopEmote, PulseStreamRecap } from '../../api.ts'
import type { ReplayHeatmapPoint } from '../../types/heatmap.ts'
import {
  SESSION_PIN_COUNT,
  sessionStripMoments,
  setStripPinHover,
  stripHasReactionCoverage,
  stripMomentEmotes,
} from '../../utils/sessionStripMoments.ts'
import { getEmoteImageUrl } from '../../utils/consoleFormat.ts'
import { ConsoleEmoteImg } from './ConsoleEmoteImg.tsx'
import { hms } from './sessionSpChartModel.ts'

/** What the console passes when the Pulse Moments strip renders (AnalyticsConsole.tsx:1613). */
export interface SessionStripPinsSource {
  recap: PulseStreamRecap
  streamStartedAt?: string
  heatmapPoints?: ReplayHeatmapPoint[]
  topEmotesCatalog?: AnalyticsTopEmote[]
  rollups?: AnalyticsMinuteRollup[]
  /** The strip's stream edges (sessionStreamEdges). */
  streamEdges?: StreamEdges
  /** The strip row's click handler. */
  onSelectOffset: (offsetSeconds: number) => void
}

export interface SessionPin {
  /** 1-based strip rank. */
  rank: number
  /** Analytical offset (s), as the strip row selects it. */
  offsetSeconds: number
  /** Epoch ms of the moment's minute. */
  atMs: number
  /** Where the pin sits: the middle of that minute. */
  pinMs: number
  emote: { name: string; count: number; src?: string } | null
  /** The strip row's top three emotes (the readout shows them with counts while the pin is selected). */
  tokens: { key: string; name: string; count: number; src?: string }[]
}

export function buildSessionPins(source: SessionStripPinsSource | null | undefined): SessionPin[] {
  if (!source) return []
  const startMs = source.streamStartedAt ? Date.parse(source.streamStartedAt) : NaN
  if (!Number.isFinite(startMs)) return []
  const moments = sessionStripMoments({
    recap: source.recap,
    hasReactionCoverage: stripHasReactionCoverage(source.recap),
    heatmapPoints: source.heatmapPoints,
    streamStartedAt: source.streamStartedAt,
    topEmotesCatalog: source.topEmotesCatalog,
    streamEdges: source.streamEdges,
  }).slice(0, SESSION_PIN_COUNT)
  return moments.map((moment, index) => {
    const offsetSeconds = recapMomentAnalyticalOffset(moment)
    const tokens = stripMomentEmotes({
      moment,
      rollups: source.rollups,
      streamStartedAt: source.streamStartedAt,
      topEmotesCatalog: source.topEmotesCatalog,
    }).emotes.slice(0, 3).map((emote, k) => ({
      key: emote.key ?? emote.id ?? `${emote.name}:${k}`,
      name: emote.name,
      count: emote.count,
      src: getEmoteImageUrl(emote),
    }))
    const top = tokens[0]
    return {
      rank: index + 1,
      offsetSeconds,
      atMs: startMs + offsetSeconds * 1000,
      pinMs: startMs + (offsetSeconds + 30) * 1000,
      emote: top ? { name: top.name, count: top.count, src: top.src } : null,
      tokens,
    }
  })
}

/** The pin a selection belongs to: the nearest within 90 s, as the strip highlights its row. */
export function selectedPinIndex(pins: readonly SessionPin[], selectedOffsetSeconds: number | null | undefined): number {
  if (selectedOffsetSeconds == null || !Number.isFinite(selectedOffsetSeconds)) return -1
  let best = -1, delta = Infinity
  pins.forEach((pin, i) => {
    const d = Math.abs(pin.offsetSeconds - selectedOffsetSeconds)
    if (d < delta) {
      best = i
      delta = d
    }
  })
  return delta <= 90 ? best : -1
}

const EDGE_PX = 22

interface RailProps {
  ctx: SpLayerContext
  pins: readonly SessionPin[]
  selectedIndex: number
  onSelect(pin: SessionPin): void
  onClear(): void
  store: SpViewportSource
}

function PinRail({ ctx, pins, selectedIndex, onSelect, onClear, store }: RailProps) {
  const { frame, width, range, data } = ctx
  const clusters = useMemo(
    () => clusterPins(pins.map((pin, index) => ({ index, x: ctx.xOfMs(pin.pinMs) })), width),
    // settled px: recomputed when the settled range or the width changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pins, width, range.startIndex, range.endIndex, data],
  )
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  useLayoutEffect(() => {
    const place = () => {
      clusters.forEach((cluster, k) => {
        const el = refs.current[k]
        if (!el) return
        let x0 = Infinity, x1 = -Infinity
        for (const i of cluster.members) {
          const x = frame.xOfMs(pins[i]!.pinMs)
          x0 = Math.min(x0, x)
          x1 = Math.max(x1, x)
        }
        const mid = (x0 + x1) / 2
        const out = x1 < 0 || x0 > width
        el.style.visibility = out ? 'hidden' : ''
        el.style.transform = `translateX(${Math.min(Math.max(mid, EDGE_PX), width - EDGE_PX).toFixed(1)}px) translateX(-50%)`
      })
    }
    place()
    return frame.subscribe(place)
  }, [clusters, frame, pins, width])
  const marked = useRef(false)
  useLayoutEffect(() => {
    if (marked.current || !clusters.length) return
    marked.current = true
    spMark('sp:pins-ready')
  }, [clusters])

  return (
    <>
      {clusters.map((cluster, k) => {
        const lead = pins[cluster.members[0]!]!
        const many = cluster.members.length > 1
        const pressed = cluster.members.includes(selectedIndex)
        const label = many
          ? `Moments ${cluster.label.replace(/·/g, ' and ')}, zoom in to separate them`
          : `Moment ${lead.rank} at ${hms(lead.offsetSeconds)}${lead.emote ? `, top emote ${lead.emote.name}` : ''}`
        return (
          <button
            key={cluster.members.join('-')}
            ref={el => void (refs.current[k] = el)}
            type="button"
            className="ssc-pin spc-pe"
            aria-pressed={pressed}
            aria-label={label}
            data-session-pin={many ? undefined : lead.rank}
            data-session-pin-cluster={many ? cluster.members.map(i => i + 1).join(',') : undefined}
            onPointerEnter={() => !many && setStripPinHover(lead.offsetSeconds)}
            onPointerLeave={() => !many && setStripPinHover(null)}
            onClick={() => {
              if (many) {
                const span = pinClusterSpan(cluster.members.map(i => pins[i]!.atMs))
                const n = data.chat.length
                const startIndex = Math.max(0, Math.floor((span.startMs - data.startMs) / data.stepMs))
                const endIndex = Math.min(n - 1, Math.ceil((span.endMs - data.startMs) / data.stepMs))
                store.setTarget({ startIndex, endIndex }, { animate: true })
                return
              }
              if (pressed) onClear()
              else onSelect(lead)
            }}
          >
            <span className="ssc-pn">{cluster.label}</span>
            {lead.emote ? (
              <ConsoleEmoteImg src={lead.emote.src} name={lead.emote.name} width={20} height={20} className="ssc-img" fallbackClassName="ssc-img ssc-img-fb" />
            ) : null}
          </button>
        )
      })}
    </>
  )
}

/** Rail height above the plot: 6 px gap + 28 px pins (session.html .pins). */
export const SESSION_PINS_TOP_PX = 34

export function sessionPinsLayer(props: Omit<RailProps, 'ctx'>): SpLayer {
  return {
    id: 'session-pins',
    panel: 'top',
    mode: 'frame',
    surface: 'html',
    render: ctx => (
      <div className="ssc-pins" role="group" aria-label="Top moments on the timeline" data-session-pins="">
        <PinRail ctx={ctx} {...props} />
      </div>
    ),
  }
}
