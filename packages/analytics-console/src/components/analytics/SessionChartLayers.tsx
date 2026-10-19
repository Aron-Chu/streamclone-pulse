/**
 * Session chart layers (SpChart layer slot, plan §2.4): the category band,
 * the pin leader lines and the pin ghost line. Each renders at settle and
 * moves per frame through ctx.frame.subscribe with DOM writes only, so a
 * zoom or pan never commits React for them.
 *
 * Band: text-only segments in the 22 px band row (d3-designer chart.js
 * renderOverlay): hidden under 2 px, label only when it fits. A click zooms
 * to the segment; hover and focus light the Games strip through the shared
 * highlighted key.
 * Leaders: a thin rule from the pin rail down to the data at each pin's
 * minute (teal when that moment is selected). Ghost: a dashed rule at the
 * hovered pin or previewed strip row.
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import { gameSegmentKey, type ChartGameSegment } from '@streampulse/pulse-charts'
import { bandBox, type SpLayer, type SpLayerContext } from '@streampulse/pulse-charts/spchart'
import { useStripPinHover } from '../../utils/sessionStripMoments.ts'

export interface SessionBandSegment {
  key: string
  label: string
  startMs: number
  endMs: number
}

/** Games played as band segments in epoch ms, clipped to the plotted end. */
export function sessionBandSegments(
  games: readonly ChartGameSegment[],
  originMs: number,
  endMs: number,
): SessionBandSegment[] {
  return games
    .map(game => ({
      key: gameSegmentKey(game),
      label: game.gameName,
      startMs: originMs + game.offsetSeconds * 1000,
      endMs: Math.min(endMs, originMs + (game.offsetSeconds + game.durationSeconds) * 1000),
    }))
    .filter(segment => Number.isFinite(segment.startMs) && segment.endMs > segment.startMs)
}

interface BandProps {
  ctx: SpLayerContext
  segments: readonly SessionBandSegment[]
  highlightedKey: string | null
  onHoverKey(key: string | null): void
  onZoom(segment: SessionBandSegment): void
}

function BandSegments({ ctx, segments, highlightedKey, onHoverKey, onZoom }: BandProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const { frame, width } = ctx
  useLayoutEffect(() => {
    const place = () => {
      segments.forEach((segment, index) => {
        const el = refs.current[index]
        if (!el) return
        const box = bandBox(frame.xOfMs(segment.startMs), frame.xOfMs(segment.endMs), width)
        el.style.display = box.hidden ? 'none' : ''
        if (box.hidden) return
        el.style.transform = `translateX(${box.left.toFixed(1)}px)`
        el.style.width = `${box.width.toFixed(1)}px`
        const label = el.firstElementChild as HTMLElement | null
        if (label) label.style.visibility = box.showLabel ? '' : 'hidden'
      })
    }
    place()
    return frame.subscribe(place)
  }, [frame, width, segments])
  return (
    <>
      {segments.map((segment, index) => (
        <button
          key={segment.key}
          ref={el => void (refs.current[index] = el)}
          type="button"
          className="ssc-band spc-pe"
          data-session-band=""
          data-active={highlightedKey === segment.key ? '' : undefined}
          aria-label={`${segment.label}, zoom to this segment`}
          onClick={() => onZoom(segment)}
          onPointerEnter={() => onHoverKey(segment.key)}
          onPointerLeave={() => onHoverKey(null)}
          onFocus={() => onHoverKey(segment.key)}
          onBlur={() => onHoverKey(null)}
        >
          <span className="ssc-band-label" aria-hidden="true">{segment.label}</span>
        </button>
      ))}
    </>
  )
}

export function sessionBandLayer(props: Omit<BandProps, 'ctx'>): SpLayer | null {
  if (!props.segments.length) return null
  return {
    id: 'session-band',
    panel: 'band',
    mode: 'frame',
    surface: 'html',
    render: ctx => <BandSegments ctx={ctx} {...props} />,
  }
}

export interface SessionLeader {
  /** Epoch ms of the pin (the moment's minute centre). */
  ms: number
  on: boolean
}

interface MarksProps {
  ctx: SpLayerContext
  leaders: readonly SessionLeader[]
  /** Top of the drawn data at a sample (plot px), or null to use the panel bottom. */
  dataTopAt(index: number): number | null
  /** Analytical offset (s) to epoch ms of the ghost rule. */
  ghostMsForOffset(offsetSeconds: number): number
  previewOffsetSeconds: number | null
}

function PinMarks({ ctx, leaders, dataTopAt, ghostMsForOffset, previewOffsetSeconds }: MarksProps) {
  const offRef = useRef<SVGPathElement>(null)
  const onRef = useRef<SVGPathElement>(null)
  const ghostRef = useRef<SVGPathElement>(null)
  const pinHover = useStripPinHover()
  const ghostOffset = pinHover ?? previewOffsetSeconds
  const { frame, width, box, data, height, layout } = ctx
  useLayoutEffect(() => {
    const bottom = box.y + box.height
    const bandBottom = layout.band ? layout.band.y + layout.band.height : 0
    const place = () => {
      let off = ''
      let on = ''
      for (const leader of leaders) {
        const x = frame.xOfMs(leader.ms)
        if (!(x >= 0 && x <= width)) continue
        const index = Math.floor((leader.ms - data.startMs) / data.stepMs)
        const top = dataTopAt(index) ?? bottom
        const d = `M${x.toFixed(1)} -6V${Math.max(-6, top - 3).toFixed(1)}`
        if (leader.on) on += d
        else off += d
      }
      offRef.current?.setAttribute('d', off)
      onRef.current?.setAttribute('d', on)
      const ghost = ghostRef.current
      if (ghost) {
        const x = ghostOffset == null ? NaN : frame.xOfMs(ghostMsForOffset(ghostOffset))
        ghost.setAttribute('d', x >= 0 && x <= width ? `M${x.toFixed(1)} ${bandBottom}V${height}` : '')
      }
    }
    place()
    return frame.subscribe(place)
  }, [frame, width, box, data, height, layout, leaders, dataTopAt, ghostMsForOffset, ghostOffset])
  return (
    <>
      <path ref={offRef} className="ssc-leader" />
      <path ref={onRef} className="ssc-leader ssc-leader-on" />
      <path ref={ghostRef} className="ssc-ghost" data-session-pin-ghost="" />
    </>
  )
}

export function sessionPinMarksLayer(props: Omit<MarksProps, 'ctx'>): SpLayer {
  return {
    id: 'session-pin-marks',
    panel: 'rates',
    mode: 'frame',
    render: ctx => <PinMarks ctx={ctx} {...props} />,
  }
}

// ---- plotted emotes (d3-v2 session-original "Emotes on chart", 2026-10-15) ----

export interface SessionOverlayLine {
  key: string
  color: string
  values: ArrayLike<number>
}

const r2 = (v: number) => Math.round(v * 100) / 100

/**
 * One plotted emote as the chart core draws its own lines (sp/lines.ts): slot
 * means over measured samples at the line step, x at the slot centre in
 * sample units, a lone value as a dot. No bridge: a minute without the emote
 * breaks the line (prod's values are null there).
 */
export function overlayLinePaths(
  values: ArrayLike<number>,
  coverage: ArrayLike<number>,
  step: number,
  y: (value: number) => number,
): { solid: string; dots: string } {
  let solid = '', dots = ''
  let has = false, joined = false, chained = false, px = 0, py = 0
  const at = (x: number, yy: number) => r2(x) + ' ' + r2(yy)
  const dot = () => {
    if (has && !joined) dots += 'M' + at(px, py) + 'h0'
  }
  for (let i0 = 0; i0 < values.length; i0 += step) {
    const i1 = Math.min(values.length, i0 + step)
    let sum = 0, count = 0
    for (let i = i0; i < i1; i += 1) {
      const v = values[i]!
      if (coverage[i] === 2 || !Number.isFinite(v)) continue
      sum += v
      count += 1
    }
    if (!count) {
      dot()
      has = false
      chained = false
      continue
    }
    const x = (i0 + i1) / 2, yy = y(sum / count)
    joined = has
    if (has) {
      solid += (chained ? '' : 'M' + at(px, py)) + 'L' + at(x, yy)
      chained = true
    }
    has = true
    px = x
    py = yy
  }
  dot()
  return { solid, dots }
}

function OverlayLines({ ctx, lines }: { ctx: SpLayerContext; lines: readonly SessionOverlayLine[] }) {
  const { data, level, range, width, yRates } = ctx
  // The core's own rule (SpChart fineLinesPx 3): per sample once a sample is 3 px wide.
  const step = width / Math.max(1, range.endIndex + 1 - range.startIndex) >= 3 ? 1 : level.step
  const paths = useMemo(
    () => lines.map(line => ({ line, d: overlayLinePaths(line.values, data.coverage, step, yRates) })),
    // yRates is a new function per chart render; the rates panel is what it reads
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines, data, step, ctx.layout.rates],
  )
  return (
    <>
      {paths.map(({ line, d }) => (
        <g key={line.key} className="ssc-ovl-line" stroke={line.color} data-session-overlay-line={line.key}>
          {d.solid ? <path d={d.solid} vectorEffect="non-scaling-stroke" /> : null}
          {d.dots ? <path className="ssc-ovl-dots" d={d.dots} vectorEffect="non-scaling-stroke" /> : null}
        </g>
      ))}
    </>
  )
}

/** The plotted emotes on the rates panel, in data units (redrawn at settle only). */
export function sessionOverlaysLayer(lines: readonly SessionOverlayLine[]): SpLayer | null {
  if (!lines.length) return null
  return {
    id: 'session-overlays',
    panel: 'rates',
    mode: 'scaled',
    render: ctx => <OverlayLines ctx={ctx} lines={lines} />,
  }
}
