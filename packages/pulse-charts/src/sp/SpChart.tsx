/**
 * SpChart: the analytics timeline chart (hub and session), hand-written SVG.
 *
 * Per frame (zoom, pan, ease) nothing commits: one transformed group
 * translate(tx,0) scale(sx,1) carries bars, lines, hatches, highlight,
 * selection, cursor and the live rule in data units; refs take the axis ticks,
 * the live dot, the hatch pattern and the viewport attributes. Y is fixed from
 * the full-data max (laneFit: a y-scale per lane follows the view, see fitApply). At settle one commit changes the bar level, the bar
 * window, tick text and settle layers. No peak caps or ticks are drawn (F3).
 *
 * Lanes mode (props.lanes, opt-in): stacked lanes (lanes.ts) replace the rates
 * and viewers panels; without lanes the output is unchanged.
 */
import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { flushSync } from 'react-dom'
import { barBucketAt, type BarLevel } from '../barPyramid.ts'
import { spMark, spPerfLevelChange } from '../perfMarks.ts'
import { barAt, barWidthPx, barWindow, buildSpLevels, capLevel, fixedStep, needsRewindow, pickSpLevel, type SpBarWindow } from './bars.ts'
import { boxPath, gapRuns, runsPath, viewerGapRuns, wideRuns } from './gaps.ts'
import { createSpHoverStore } from './hoverStore.ts'
import { createSpFrame, layerNodes, type SpLayerBase, type SpLayerSlot } from './layers.ts'
import { panelY, SP_TICK_COLUMN, spLayout } from './layout.ts'
import {
  laneBars,
  laneFigure,
  laneFitMax,
  laneLayout,
  lanePaths,
  laneRawMax,
  laneRuns,
  laneSeries,
  laneSlots,
  laneTick,
  laneWidth,
  movingAverage3,
  snapToSlots,
  SP_LANE_GAP,
  SP_LANE_WIDTH,
} from './lanes.ts'
import { linePaths, slotPhase, type SpLinePaths } from './lines.ts'
import { clockTicks, compact, elapsedTicks, formatClock, formatElapsed, formatInt } from './scale.ts'
import { prefersReducedMotion, SpSelBand } from './selBand.tsx'
import type { SpCaption, SpChartData, SpChartHandle, SpChartProps, SpHit, SpLane, SpLaneBox, SpLayerPanel, SpLayout, SpLevelInfo, SpRange, SpValuePanel } from './types.ts'

const r4 = (v: number) => Math.round(v * 1e4) / 1e4
const r1 = (v: number) => Math.round(v * 10) / 10
/** Space between bars in px for a slot pitch in px. */
const gapPx = (pitch: number) => (pitch > 9 ? 2 : pitch > 4 ? 1 : 0.5)
const rule = (x: number, y0: number, y1: number) => 'M' + x + ' ' + y0 + 'V' + y1
const PANELS: readonly SpLayerPanel[] = ['band', 'rates', 'viewers']
const TOP: readonly SpLayerPanel[] = ['top']

function seriesMax(values: ArrayLike<number> | null | undefined, cov: ArrayLike<number>): number {
  let m = 0
  if (values) for (let i = 0; i < values.length; i += 1) if (cov[i] !== 2 && values[i]! > m) m = values[i]!
  return m
}

/** "Peak X, avg Y unit": values as passed (the chart computes none). */
const caption = (c: SpCaption, top: number, unit: string, pre: string) => (
  <span className="spc-chip" data-chart-scale-row={pre ? 'viewers' : 'rates'} style={{ top }}>
    <span data-chart-scale-value={pre + 'peak'}>Peak {formatInt(c.peak)}</span>
    {c.avg != null && (
      <>
        <span className="spc-vh">, </span>
        <i className="spc-avg-sw" aria-hidden="true" />
        <span data-chart-scale-value={pre + 'avg'}>avg {formatInt(c.avg)}</span>
      </>
    )}
    {unit && ' ' + unit}
  </span>
)

const line = (cls: string, d: string | null | undefined) => (d ? <path className={'spc-line ' + cls} d={d} vectorEffect="non-scaling-stroke" /> : null)

/** One series: solid, dashed (partial) and lone-point dots; colour on the group. */
const series = (k: string, l: SpLinePaths | null | undefined) =>
  l && (
    <g className={'spc-line-' + k}>
      {line('', l.solid)}
      {line('spc-line-dash', l.dashed)}
      {line('spc-dots', l.dots)}
    </g>
  )

/** Lane head chip: "Chat · peak 757/min", "Viewers · peak 34.3K" (session-original ch-lcap). */
const laneCaption = (L: SpLane, b: SpLaneBox) => {
  if (L.caption === false) return null
  const c = L.caption ?? { peak: b.raw }
  const rate = L.unit?.startsWith('/') ? L.unit : ''
  const sep = (
    <>
      <span className="spc-sep" aria-hidden="true">·</span>
      <span className="spc-vh">, </span>
    </>
  )
  return (
    <span key={L.key} className="spc-chip spc-lcap" data-chart-lane-caption={L.key} data-chart-scale-row={L.key} style={{ top: b.y + 1 }}>
      <i className={L.kind === 'bars' ? 'spc-lsw spc-lsw-bar' : 'spc-lsw'} style={{ background: L.color }} aria-hidden="true" />
      <b>{L.label}</b>
      {sep}
      peak <span className="spc-n" data-chart-scale-value={L.key + '-peak'}>{laneFigure(c.peak) + rate}</span>
      {c.avg != null && Number.isFinite(c.avg) && (
        <>
          {sep}
          <i className="spc-avg-sw spc-avg-sw-lane" aria-hidden="true" />
          avg <span className="spc-n" data-chart-scale-value={L.key + '-avg'}>{laneFigure(c.avg) + rate}</span>
        </>
      )}
    </span>
  )
}

const r2 = (v: number) => Math.round(v * 100) / 100
const o3 = (v: number) => Math.round(v * 1000) / 1000

/** Lane backgrounds, top rules and baselines (plot px; they never move with the view). */
/** A lane's avg hairline at a scale max, no higher than the lane's data top. */
const laneAvgD = (b: SpLaneBox, a: number, max: number, PW: number) =>
  'M0 ' + r1(Math.max(b.dataTop, b.y + b.height - (a / max) * (b.y + b.height - b.dataTop))) + 'H' + PW

const laneStatics = (LB: readonly SpLaneBox[], lanes: readonly SpLane[], PW: number) =>
  LB.map((b, k) => {
    const L = lanes[k]!
    const fills = L.bg == null ? [] : typeof L.bg === 'string' ? [L.bg] : L.bg
    const y1 = b.y + b.height
    return (
      <g key={b.key} className="spc-lane-bg" data-lane={b.key}>
        {fills.map((f, j) => (
          <rect key={j} x={0} y={b.y} width={PW} height={b.height} fill={f} />
        ))}
        {L.topLine && <path d={'M0 ' + (b.y + 0.5) + 'H' + PW} stroke={L.topLine} />}
        {L.baseline !== false && <path d={'M0 ' + (y1 - 0.5) + 'H' + PW} stroke={L.baseline ?? '#272728'} />}
      </g>
    )
  })

interface Ticks { ms: number[]; labels: string[]; u: number[]; stepU: number }
interface Live {
  d: SpChartData | null
  n: number
  layout: SpLayout | null
  level: BarLevel | null
  info: SpLevelInfo | null
  win: SpBarWindow | null
  fine: boolean
  ticks: Ticks | null
  minGap: number
  originMs: number
  p: SpChartProps
  top: number
  H: number
  /** Px per sample at the drawn view. */
  sx: number
}

export const SpChart = forwardRef<SpChartHandle, SpChartProps>(function SpChart(p, ref) {
  const d = p.data, vp = p.viewport, H = p.plotHeight, caps = p.captions, le = p.liveEdge
  const hub = p.density === 'hub'
  const n = d ? d.chat.length : 0
  const tickCol = p.tickColumnPx ?? SP_TICK_COLUMN[hub ? 'hub' : 'session']
  const topPx = p.topPx ?? 0
  const alignMs = p.alignMs ?? (hub ? 0 : d?.startMs ?? 0)
  const fineLinesPx = p.fineLinesPx === undefined ? (hub ? null : 3) : p.fineLinesPx
  const originMs = p.viewportOriginMs ?? d?.startMs ?? 0
  const s = p.series ?? {}
  const sChat = s.chat !== false, sEm = s.emotes !== false, sV = s.viewers !== false, sOv = s.overlay !== false && !!d?.overlay
  const lanesIn = p.lanes?.length ? p.lanes : null
  const minHatch = p.minHatchPx ?? 0
  const ownHover = useMemo(createSpHoverStore, [])
  const hover = p.hover ?? ownHover
  const uid = 'spc' + useId().replace(/\W/g, '')
  const frame = useMemo(createSpFrame, [])
  const uOf = (ms: number) => (d ? (ms - d.startMs) / d.stepMs : 0)

  const rootRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const rectRef = useRef<DOMRect | null>(null)
  const [measured, setMeasured] = useState(0)
  const W = p.width ?? measured
  useLayoutEffect(() => {
    const el = rootRef.current
    if (p.width != null || !el) return
    const read = () => {
      rectRef.current = null
      setMeasured(Math.round(el.clientWidth))
    }
    read()
    if (typeof ResizeObserver > 'u') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [p.width])

  // ---- data, levels, layout (per data load or resize) ----
  const fixed = d ? fixedStep(p.fixedLevelMinutes, d.stepMs) : 0
  const levels = useMemo(() => (n ? buildSpLevels(d!, alignMs, fixed || 1) : []), [d, alignMs, fixed])
  const maxes = useMemo(() => (d ? [d.chat, d.emotes, d.overlay, d.viewers].map(v => seriesMax(v, d.coverage)) : [0, 0, 0, 0]), [d])
  const showRates = sChat || sEm || sOv
  const ratesMax = Math.max(sChat ? maxes[0]! : 0, sEm ? maxes[1]! : 0, sOv ? maxes[2]! : 0)
  const [view, setView] = useState(() => ({ range: { ...vp.getTarget() }, moving: false }))
  // laneFit: the drawn lanes fit the last settled view, never a re-window mid-gesture; between settles a y-scale
  // per lane follows the view (fitApply)
  const fitRef = useRef(view.range)
  if (!view.moving) fitRef.current = view.range
  const fitA = p.laneFit ? fitRef.current.startIndex : 0, fitB = p.laneFit ? fitRef.current.endIndex : Infinity
  const laneRawNow = useMemo(() => (d && lanesIn ? lanesIn.map(L => laneRawMax(d, L, fitA, fitB)) : null), [d, lanesIn, fitA, fitB])
  const rawKey = laneRawNow?.join() ?? ''
  // the same maxima keep the layout (and every lane path) as it is
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const laneRaw = useMemo(() => laneRawNow, [rawKey, lanesIn])
  const laneGap = p.laneGap ?? SP_LANE_GAP
  const layout = useMemo(
    () =>
      W > 0
        ? lanesIn
          ? laneLayout({ width: W, height: H, tickColumn: tickCol, band: p.band ?? !hub, topPx, gap: laneGap, lanes: lanesIn, raw: laneRaw ?? [], fit: p.laneFit })
          : spLayout({ width: W, height: H, tickColumn: tickCol, band: p.band ?? !hub, topPx, rates: showRates, viewers: sV, viewersCaption: !!caps?.viewers, ratesMax, viewersMax: maxes[3]! })
        : null,
    [W, H, tickCol, p.band, hub, topPx, showRates, sV, !!caps?.viewers, ratesMax, maxes, lanesIn, laneRaw, laneGap, p.laneFit],
  )
  const LB = layout?.lanes ?? null
  const PW = layout?.plotWidth ?? 0
  const R = layout?.rates ?? null
  const V = layout?.viewers ?? null
  const top = layout?.band?.height ?? 0
  const ready = !!(d && layout && levels.length && (levels[0]!.buckets.length || maxes[3]! > 0))

  // ---- settled view, level, bar window ----
  const range = view.range
  const span = range.endIndex + 1 - range.startIndex
  // mutable state that never renders
  const m = useRef({
    view, step: 0, pw: 0, tick: [] as string[], attr: '', bw: '', rewin: false, settling: false, reported: false,
    px: null as number | null, down: null as { x: number; y: number; t: string } | null, seq: undefined as number | undefined,
    live: null as unknown as Live,
    /** The visual range as of the last frame. */
    vis: { ...view.range } as SpRange,
  }).current
  m.view = view
  const bo = p.barOptions
  const boKey = bo ? [bo.minSlotPx, bo.maxBars, bo.tolerance, bo.maxLevelMinutes, bo.maxRects].join() : ''
  const level = useMemo(() => {
    if (!ready) return null
    const fresh = (range.startIndex <= 0 && range.endIndex >= n - 1) || m.pw !== PW
    let lv = pickSpLevel(levels, range, PW, d!.stepMs, fresh ? null : m.step, bo, fixed > 0)!
    // a gesture never refines: the coarser of the level on screen and the ideal one
    const cur = view.moving ? levels.find(l => l.step === m.step) : null
    if (cur && cur.step > lv.step) lv = cur
    return capLevel(levels, lv, span, bo?.maxRects)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, levels, view, PW, boKey, fixed])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const win = useMemo(() => (level ? barWindow(level, d!, range, bo?.maxRects) : null), [level, view])
  const sxS = PW / span
  const offS = -range.startIndex * sxS
  const fine = fineLinesPx != null && sxS >= fineLinesPx
  const lineStep = fine ? 1 : level?.step ?? 1
  const info = useMemo(() => level && { step: level.step, slotMs: level.slotMs, minutes: level.slotMs / 60_000 }, [level])
  const sel = p.selected
  const selU = sel && d ? [uOf(sel.startMs), uOf(sel.endMs)] : null
  const selBar = !!selU && sel!.kind !== 'minute'
  const barRule = bo?.rule
  const slide = p.selSlide ?? null
  // lanes / selSlide: the selection snapped outward to whole bars at the current level
  const selS = selU && level && (lanesIn || slide) ? snapToSlots(selU[0]!, selU[1]!, level.step, slotPhase(d!, alignMs, level.step), n) : null

  const bars = useMemo(() => {
    if (!level || !win || !R || !sChat || lanesIn) return null
    const gap = gapPx(level.step * sxS) / sxS
    const pw = barRule === 'prod' ? barWidthPx(level.step * sxS, barRule) / sxS : 0
    return level.buckets.slice(win.from, win.to).map(b => {
      const y = panelY(R, b.avg[0]!)
      return (
        <rect
          key={b.startMs}
          className={selBar && (b.to <= selU![0]! || b.from >= selU![1]!) ? 'spc-bar spc-dim' : 'spc-bar'}
          x={r4(pw ? (b.from + b.to) / 2 - pw / 2 : b.from + gap / 2)}
          y={r1(y)}
          width={r4(pw || Math.max(0.6 / sxS, b.to - b.from - gap))}
          height={r1(R.y + R.height - y)}
          data-bar-partial={b.observed < b.expected ? '' : undefined}
        />
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, win, R, sChat, sxS, selBar, selU?.[0], selU?.[1], lanesIn, barRule])

  // laneFit: each lane clips to its box, and a group inside the clip takes the lane's y-scale (fitApply)
  const fitOn = !!p.laneFit
  const fitEls = useRef(new Map<SVGGElement, string>()).current
  const barEls = useRef(new Set<SVGGElement>()).current
  const tkEls = useRef(new Map<SVGTextElement, string>()).current
  const avgRef = useRef<SVGPathElement>(null)
  const regBars = (g: SVGGElement | null) => void (g && fitOn && barEls.add(g))
  const regTk = (key: string) => (el: SVGTextElement | null) => void (el && fitOn && tkEls.set(el, key))
  const fitLane = (key: string, node: ReactNode) =>
    fitOn ? (
      <g key={key} clipPath={'url(#' + uid + 'c' + key + ')'}>
        <g ref={g => void (g && fitEls.set(g, key))} data-lane-fit="">
          {node}
        </g>
      </g>
    ) : (
      node
    )

  // lanes: bars per bar lane over the bar window (one commit per settle, none per frame)
  const laneRects = useMemo(() => {
    if (!lanesIn || !LB || !level || !win || !d) return null
    const ph = slotPhase(d, alignMs, level.step)
    return lanesIn.map((L, k) => {
      const v = L.kind === 'bars' ? laneSeries(d, L) : null
      if (!v) return null
      const rects = laneBars({ values: v, coverage: d.coverage, box: LB[k]!, lane: L, step: level.step, phase: ph, a: win.u0, b: win.u1, sx: sxS, rule: barRule, sel: selS })
      return fitLane(
        L.key,
        <g key={L.key} ref={regBars} className="spc-lane-bars" data-lane={L.key} fill={L.color}>
          {rects.map(b => (
            <rect key={b.i} className="spc-bar" x={b.x} y={b.y} width={b.w} height={b.h} fillOpacity={b.op < 1 ? b.op : undefined} data-lane-partial={b.partial ? '' : undefined} />
          ))}
        </g>,
      )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanesIn, LB, level, win, d, alignMs, sxS, barRule, selS?.[0], selS?.[1]])

  // lanes: trend, area and line paths at the line level (per data, level and settled zoom)
  const minLU = minHatch > 0 && sxS > 0 ? minHatch / sxS : 0
  const lanePathsAll = useMemo(() => {
    if (!lanesIn || !LB || !d) return null
    const ph = slotPhase(d, alignMs, lineStep)
    return lanesIn.map((L, k) => {
      const box = LB[k]!, floor = box.y + box.height
      // laneFit: values outside the settled view can pass the lane top (each lane clips)
      const y = (v: number) => panelY(box, v)
      const minU = L.bridge === false ? 0 : minLU
      if (L.kind === 'bars') {
        const v = laneSeries(d, L)
        if (!v || !L.trend) return null
        const sl = laneSlots(v, d.coverage, lineStep, ph)
        return [{ key: L.key, color: L.trend.color ?? L.color, ...lanePaths(laneRuns(sl, movingAverage3(sl.v), y, minU), true, false, floor, false) }]
      }
      const src = L.lines ?? [{ key: L.key, color: L.color, values: laneSeries(d, L) }]
      return src.map(line => {
        if (!line.values) return { key: line.key, color: line.color, line: '', dots: '', fill: '' }
        const sl = laneSlots(line.values, d.coverage, lineStep, ph)
        return { key: line.key, color: line.color, ...lanePaths(laneRuns(sl, sl.v, y, minU), !!L.smooth, L.kind === 'area', floor) }
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lanesIn, LB, d, alignMs, lineStep, minLU])

  const lines = useMemo(() => {
    if (!d || !layout || lanesIn) return null
    const ph = slotPhase(d, alignMs, lineStep)
    const lp = (v: ArrayLike<number> | null | undefined, P: SpValuePanel | null, dash?: boolean) =>
      v && P ? linePaths(v, d.coverage, lineStep, ph, x => panelY(P, x), dash) : null
    return { e: sEm ? lp(d.emotes, R) : null, o: sOv ? lp(d.overlay, R) : null, v: lp(d.viewers, V, true) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, layout, lineStep, alignMs, sEm, sOv, lanesIn])

  const gapKey = p.gaps ? JSON.stringify(p.gaps) : ''
  // with minHatchPx, spans narrower than that at the settled zoom get no hatch (lanes join across them);
  // lanes hatch unmeasured spans only, through every lane (session-original: no viewers-lane hatch)
  const hatch = useMemo(() => {
    if (!d || !layout) return ''
    const keep = (r: number[]) => (minLU ? wideRuns(r, minLU) : r)
    const VB = LB ? null : V
    return runsPath(keep(gapRuns(d, p.gaps)), top, H) + (VB ? runsPath(keep(viewerGapRuns(d)), VB.dataTop, VB.y + VB.height) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, layout, gapKey, minLU])

  // static value axis: gridlines, labels (right column, or inside when the column is 0), avg hairlines
  const ra = caps?.rates?.avg, va = caps?.viewers?.avg
  const valueAxis = useMemo(() => {
    let grid = '', avg = '', marks = ''
    const labels: ReactNode[] = []
    const inside = !tickCol
    if (LB && lanesIn) {
      // lanes: one max tick per lane (in the column, or inside the right edge in the lane head); no gridlines
      LB.forEach((b, k) => {
        const L = lanesIn[k]!, t = r1(b.dataTop)
        // a 4 x 1 px filled box, not a hairline stroke (Chromium can drop a 1 px stroke at a fractional page offset)
        if (!inside) marks += 'M' + PW + ' ' + t + 'h4v1h-4Z'
        labels.push(
          <text key={'l' + b.key} ref={regTk(b.key)} className={inside ? 'spc-tk spc-tk-in' : 'spc-tk'} data-lane={b.key} x={inside ? PW - 6 : PW + 10} y={inside ? r1(t - 5) : r1(t + 4)} textAnchor={inside ? 'end' : undefined}>
            {laneTick(b.max)}
          </text>,
        )
        const a = L.caption ? L.caption.avg : null
        if (a != null && Number.isFinite(a)) avg += laneAvgD(b, a, b.max, PW)
      })
      return { grid, avg, labels, marks }
    }
    const add = (P: SpValuePanel | null, k: string, a: number | null | undefined) => {
      if (!P) return
      P.ticks.forEach((t, i) => {
        const y = r1(panelY(P, t))
        grid += 'M0 ' + y + 'H' + PW
        if (inside && k === 'v' && i < P.ticks.length - 1) return
        labels.push(
          <text key={k + t} className={inside ? 'spc-tk spc-tk-in' : 'spc-tk'} x={inside ? PW - 6 : PW + 10} y={inside ? (k === 'r' && !t && V ? y + 13 : y - 4) : y + 4} textAnchor={inside ? 'end' : undefined}>
            {compact(t)}
          </text>,
        )
      })
      if (a != null && Number.isFinite(a)) avg += 'M0 ' + r1(panelY(P, a)) + 'H' + PW
    }
    add(R, 'r', ra)
    add(V, 'v', va)
    return { grid, avg, labels, marks }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, ra, va, lanesIn])

  // time axis: ticks over the settled view plus one span each side (text at settle, x per frame)
  const minGap = p.axis?.minGapPx ?? (hub ? 96 : 80)
  const ticks = useMemo((): Ticks | null => {
    if (!d || !layout) return null
    const a = Math.max(0, range.startIndex - span), b = Math.min(n, range.endIndex + 1 + span)
    const t = (u: number) => d.startMs + u * d.stepMs
    const w = (PW * (b - a)) / span
    const ax = p.axis
    const ms = hub ? clockTicks(t(a), t(b), w, minGap) : elapsedTicks(t(a), t(b), w, originMs, minGap)
    // session-original: 0:00 sits at the first minute's edge when the stream started within a minute before it
    if (!hub && a === 0 && originMs < t(0) && originMs > t(0) - d.stepMs) ms.unshift(originMs)
    const st = ms.length > 1 ? ms[1]! - ms[0]! : 0
    return { ms, labels: ms.map(x => (ax?.format ? ax.format(x) : hub ? formatClock(x, st >= 864e5) : formatElapsed(x, originMs))), u: ms.map(x => uOf(x)), stepU: st / d.stepMs }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d, layout, view, hub, originMs, minGap, p.axis])

  const base: SpLayerBase | null =
    layout && info && d
      ? {
          width: PW, height: H, layout, level: info, range, data: d,
          xOfMs: ms => offS + sxS * uOf(ms),
          xOfIndex: i => offS + sxS * i,
          uOfMs: uOf,
          yRates: v => panelY(R, v),
          yViewers: v => panelY(V, v),
          frame, store: vp, hover,
        }
      : null
  const lay = (panels: readonly SpLayerPanel[], slot: SpLayerSlot) => layerNodes(p.layers, panels, slot, base)

  // ---- imperative frame path ----
  const scaled = useRef(new Set<SVGGElement>()).current
  const reg = (g: SVGGElement | null) => void (g && scaled.add(g))
  const patRef = useRef<SVGPatternElement>(null)
  const touchRef = useRef<SVGRectElement>(null)
  const hovRef = useRef<SVGPathElement>(null)
  const crossRef = useRef<SVGPathElement>(null)
  const dotRef = useRef<HTMLSpanElement>(null)
  const tickEls = useRef<(SVGGElement | null)[]>([]).current
  // lanes: line weights follow the zoom per frame ([far, near])
  const laneW = useRef(new Map<SVGPathElement, readonly [number, number]>()).current
  const regW = (w: readonly [number, number]) => (el: SVGPathElement | null) => void (el && laneW.set(el, w))

  const applyFrame = (v: SpRange, fromStore?: boolean) => {
    const L = m.live, dd = L.d, lay = L.layout
    if (!dd || !lay) return
    const pw = lay.plotWidth
    frame.update(v, pw)
    const sx = frame.scale, tx = frame.offset
    const tf = 'translate(' + tx + ' 0) scale(' + sx + ' 1)'
    scaled.forEach(g => (g.isConnected ? g.setAttribute('transform', tf) : scaled.delete(g)))
    if (laneW.size) {
      const vis = v.endIndex + 1 - v.startIndex
      laneW.forEach((w, el) => (el.isConnected ? el.setAttribute('stroke-width', String(r2(laneWidth(w, vis, L.n)))) : laneW.delete(el)))
    }
    if (barEls.size && L.level && L.p.barOptions?.rule === 'prod') {
      // laneFit: a bar's width follows the zoom about its centre (sp-chart.css), as the next settle draws it
      const st = L.level.step, f = r4(barWidthPx(st * sx, 'prod') / sx / (barWidthPx(st * L.sx, 'prod') / L.sx))
      const bw = f === 1 ? '' : String(f)
      if (bw !== m.bw) {
        m.bw = bw
        barEls.forEach(g => (g.isConnected ? g.style.setProperty('--spc-bw', bw) : barEls.delete(g)))
      }
    }
    patRef.current?.setAttribute('patternTransform', 'scale(' + 1 / sx + ' 1) rotate(45)')
    const dot = dotRef.current, edge = L.p.liveEdge
    if (dot && edge) {
      const x = frame.xOfMs(edge.atMs)
      dot.style.display = x < 0 || x > pw + 0.5 ? 'none' : ''
      dot.style.transform = 'translate(' + x + 'px,' + (L.top + 5) + 'px)'
    }
    const A = L.ticks
    if (A) {
      // thin labels while a gesture zooms out past the settled spacing
      const sp = A.stepU * sx, g = L.minGap * 0.6
      const k = !sp || sp >= g ? 1 : Math.ceil(g / sp)
      for (let j = 0; j < A.u.length; j += 1) {
        const el = tickEls[j], u = A.u[j]!
        if (!el) continue
        // a tick before the first sample (only the 0:00 one above) pins to the data's left edge
        const x = tx + sx * Math.max(0, u)
        const on = x >= -1 && x <= pw + 1 && (k < 2 || Math.round(u / A.stepU) % k === 0)
        const anchor = on ? (x < 28 ? 'start' : x > pw - 28 ? 'end' : 'middle') : ''
        el.setAttribute('transform', 'translate(' + x + ' 0)')
        if (m.tick[j] !== anchor) {
          m.tick[j] = anchor
          el.setAttribute('visibility', on ? 'visible' : 'hidden')
          if (on) el.lastElementChild?.setAttribute('text-anchor', anchor)
        }
      }
    }
    const si = Math.round(v.startIndex), ei = Math.round(v.endIndex), key = si + '-' + ei
    if (key !== m.attr) {
      m.attr = key
      const sec = (i: number) => String((dd.startMs + i * dd.stepMs - L.originMs) / 1000)
      touchRef.current?.setAttribute('data-chart-viewport-start', sec(si))
      touchRef.current?.setAttribute('data-chart-viewport-end', sec(ei))
      svgRef.current?.setAttribute('data-bench-viewport', key)
    }
    frame.emit()
    // past half the overscan mid-gesture: one commit for a new bar window
    if (fromStore && frame.moving && L.win && !m.rewin && needsRewindow(L.win, v, L.n)) {
      m.rewin = true
      setView({ range: { startIndex: si, endIndex: ei }, moving: true })
    }
  }

  // data-gesture hides settle layers and sets will-change (sp-chart.css)
  const gesture = (on: boolean) => {
    frame.moving = on
    rootRef.current?.toggleAttribute('data-gesture', on)
  }

  // ---- laneFit: each lane's y-scale follows the view ----
  // A lane's target is laneFitMax of its max over the samples in view (x, v and t in log units). The shown max
  // springs to it, critically damped: ~120 ms when the bars grow, ~70 ms when they shrink, so a value past the
  // lane top is clipped only briefly. The drawn lanes fit the settled view, and a y-scale about each lane's floor
  // makes up the difference, so a settle swaps the drawn scale with no jump. Reduced motion snaps.
  const fit = useRef({
    x: new Map<string, number>(), v: new Map<string, number>(), t: new Map<string, number>(),
    at: '', d: null as SpChartData | null, lanes: null as readonly SpLane[] | null | undefined, raf: 0, last: -1,
  }).current
  const fitTarget = (r: SpRange) => {
    const L = m.live, dd = L.d, lanes = L.p.lanes
    if (!dd || !lanes) return
    const a = Math.floor(r.startIndex), b = Math.ceil(r.endIndex), at = a + '-' + b
    if (at === fit.at && dd === fit.d && lanes === fit.lanes) return
    Object.assign(fit, { at, d: dd, lanes })
    fit.t.clear()
    for (const ln of lanes) fit.t.set(ln.key, Math.log(laneFitMax(laneRawMax(dd, ln, a, b))))
    // a lane that left forgets its spring
    for (const key of [...fit.x.keys()]) if (!fit.t.has(key)) fit.x.delete(key)
  }
  /** Moves each shown max dt s toward its target (dt Infinity jumps); true while one still moves. */
  const fitStep = (dt: number) => {
    let on = false
    fit.t.forEach((t, key) => {
      const x = fit.x.get(key)
      if (x == null || dt === Infinity) {
        fit.x.set(key, t)
        fit.v.set(key, 0)
        return
      }
      const w = 2 / (t > x ? 0.07 : 0.12), e = w * dt, k = 1 / (1 + e + 0.48 * e * e + 0.235 * e * e * e)
      const c = x - t, q = ((fit.v.get(key) ?? 0) + w * c) * dt
      let nx = t + (c + q) * k, nv = ((fit.v.get(key) ?? 0) - w * q) * k
      if (Math.abs(nx - t) < 1e-3 && Math.abs(nv) < 1e-2) {
        nx = t
        nv = 0
      } else on = true
      fit.x.set(key, nx)
      fit.v.set(key, nv)
    })
    return on
  }
  /** Writes each lane's y-scale, max tick and avg hairline for its shown max. */
  const fitApply = () => {
    const L = m.live, LB = L.layout?.lanes, lanes = L.p.lanes
    if (!LB || !lanes) return
    const box = (key: string) => LB.find(b => b.key === key)
    const shown = (b: SpLaneBox) => {
      const x = fit.x.get(b.key)
      return x == null ? b.max : Math.exp(x)
    }
    fitEls.forEach((key, g) => {
      const b = box(key)
      if (!g.isConnected || !b) return void (g.isConnected || fitEls.delete(g))
      const k = r4(b.max / shown(b)), fl = b.y + b.height
      if (k === 1) g.removeAttribute('transform')
      else g.setAttribute('transform', 'matrix(1 0 0 ' + k + ' 0 ' + r2(fl * (1 - k)) + ')')
    })
    tkEls.forEach((key, el) => {
      const b = box(key)
      if (!el.isConnected || !b) return void (el.isConnected || tkEls.delete(el))
      const s = laneTick(+shown(b).toPrecision(2))
      if (el.textContent !== s) el.textContent = s
    })
    const av = avgRef.current
    if (av) {
      let s = ''
      LB.forEach((b, k) => {
        const c = lanes[k]?.caption, a = c ? c.avg : null
        if (a != null && Number.isFinite(a)) s += laneAvgD(b, a, shown(b), L.layout!.plotWidth)
      })
      if (av.getAttribute('d') !== s) av.setAttribute('d', s)
    }
  }
  const fitLoop = (now: number) => {
    fit.raf = 0
    const dt = fit.last < 0 ? 1 / 60 : Math.min(0.034, Math.max(0, (now - fit.last) / 1000))
    fit.last = now
    fitTarget(m.vis)
    const on = fitStep(dt)
    fitApply()
    if (on || frame.moving) fit.raf = requestAnimationFrame(fitLoop)
    else fit.last = -1
  }
  /** Starts the spring (or snaps under reduced motion or with no rAF). */
  const fitKick = () => {
    if (!m.live.p.laneFit || fit.raf) return
    if (typeof requestAnimationFrame !== 'function' || prefersReducedMotion()) {
      fitTarget(m.vis)
      fitStep(Infinity)
      return fitApply()
    }
    fit.raf = requestAnimationFrame(fitLoop)
  }

  // ---- hit testing (no layout read except a cached plot rect) ----
  const hitAt = (i: number, source: SpHit['source']): SpHit | null => {
    const L = m.live, dd = L.d, lv = L.level
    if (!dd || !lv || i < 0 || i >= L.n) return null
    const bar = barAt(dd, lv, i)
    return {
      index: i,
      ms: dd.startMs + i * dd.stepMs,
      sample: { chat: dd.chat[i]!, emotes: dd.emotes[i]!, viewers: dd.viewers[i]!, overlay: dd.overlay ? dd.overlay[i]! : NaN, coverage: dd.coverage[i]! },
      bar,
      levelMinutes: lv.slotMs / 60_000,
      fine: L.fine,
      x: frame.xOfIndex(L.fine || !bar ? i + 0.5 : (bar.fromIndex + bar.toIndex) / 2),
      source,
    }
  }
  const plotX = (clientX: number) => clientX - ((rectRef.current ??= svgRef.current?.getBoundingClientRect() ?? null)?.left ?? 0)
  const hitX = (x: number, source: SpHit['source']) =>
    x < 0 || x > (m.live.layout?.plotWidth ?? 0) ? null : hitAt(Math.floor((x - frame.offset) / frame.scale), source)
  const cols = (h: SpHit) => (m.live.fine || !h.bar ? [h.index, h.index + 1] : [h.bar.fromIndex, h.bar.toIndex])
  const cursor = () => {
    const L = m.live, h = hover.get()
    const [a, b] = h && L.layout ? cols(h) : []
    hovRef.current?.setAttribute('d', a == null ? '' : boxPath(a, b!, L.top, L.H))
    crossRef.current?.setAttribute('d', a == null ? '' : rule((a + b!) / 2, L.top, L.H))
  }

  useLayoutEffect(() => {
    const before = m.live?.level?.step
    m.live = { d, n, layout, level, info, win, fine, ticks, minGap, originMs, p, top, H, sx: sxS }
    m.rewin = false
    m.tick = []
    m.attr = ''
    if (d) frame.setData(d.startMs, d.stepMs)
    applyFrame((m.vis = vp.getVisual()))
    if (p.laneFit) {
      // a commit (settle, re-window, data or lanes) keeps each shown max and rescales against the new drawing
      fitTarget(m.vis)
      const on = fitStep(0)
      fitApply()
      if (on) fitKick()
    }
    cursor()
    if (m.settling) {
      m.settling = false
      gesture(false)
    }
    if (level) {
      m.step = level.step
      m.pw = PW
      if (before !== level.step || !m.reported) {
        if (m.reported) spPerfLevelChange()
        m.reported = true
        p.onLevel?.(level.slotMs / 60_000)
      }
    }
  })

  useLayoutEffect(() => {
    const t = vp.getTarget(), r0 = m.view.range
    if (t.startIndex !== r0.startIndex || t.endIndex !== r0.endIndex) setView({ range: { ...t }, moving: false })
    const offs = [
      vp.subscribeFrame(v => {
        if (!frame.moving) gesture(true)
        applyFrame(v, true)
        m.vis = v
        fitKick()
      }),
      vp.subscribeSettle(r => {
        const v = m.view
        if (v.range.startIndex === r.startIndex && v.range.endIndex === r.endIndex && !v.moving) gesture(false)
        else {
          // one commit for level, window, tick text and settle layers; they show after it lands
          m.settling = true
          flushSync(() => setView({ range: { ...r }, moving: false }))
        }
        m.live.p.onSettle?.(r)
        if (m.px != null && hover.get()?.source === 'pointer') hover.set(hitX(m.px, 'pointer'))
      }),
      hover.subscribe(cursor),
    ]
    return () => offs.forEach(off => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vp, hover])

  useEffect(() => () => void (fit.raf && typeof cancelAnimationFrame === 'function' && cancelAnimationFrame(fit.raf)), [fit])

  useEffect(() => {
    const inv = () => void (rectRef.current = null)
    for (const e of ['scroll', 'resize']) addEventListener(e, inv, true)
    return () => {
      for (const e of ['scroll', 'resize']) removeEventListener(e, inv, true)
    }
  }, [])

  // sp:chart-ready at the first rAF after the first commit with bars
  const hasRects = !!bars?.length || !!laneRects?.some(g => g != null)
  useLayoutEffect(() => {
    if (hasRects) requestAnimationFrame(() => spMark('sp:chart-ready'))
  }, [hasRects])

  useImperativeHandle(ref, () => ({
    hitTest: clientX => hitX(plotX(clientX), 'pointer'),
    barAnchor: index => {
      const L = m.live, dd = L.d, lv = L.level, lay = L.layout
      const b = dd && lv && lay && barBucketAt(lv, dd.startMs + index * dd.stepMs)
      if (!b) return null
      const x0 = frame.xOfIndex(b.from), g = gapPx(lv!.step * frame.scale), r = lay!.rates
      const pw = L.p.barOptions?.rule === 'prod' ? barWidthPx(lv!.step * frame.scale, 'prod') : 0
      return {
        x: pw ? (x0 + frame.xOfIndex(b.to)) / 2 - pw / 2 : x0 + g / 2,
        width: pw || Math.max(0.6, frame.xOfIndex(b.to) - x0 - g),
        // lanes: the top of the first lane (rates spans every lane)
        top: r ? (lay!.lanes ? r.y : panelY(r, b.avg[0]!)) : L.top,
        bottom: r ? r.y + r.height : L.H,
        colTop: L.top,
        colBottom: L.H,
      }
    },
    plotElement: () => svgRef.current,
    xOfMs: ms => frame.xOfMs(ms),
    level: () => m.live.info,
    frame: () => frame,
    layout: () => m.live.layout,
  }))

  // ---- input ----
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    const x = (m.px = plotX(e.clientX)), cur = hover.get()
    if (cur?.source !== 'pointer' || cur.index !== Math.floor((x - frame.offset) / frame.scale)) hover.set(hitX(x, 'pointer'))
  }
  const onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    m.px = rectRef.current = null
    if (hover.get()?.source === 'pointer') hover.set(null)
  }
  const onClick = (e: MouseEvent) => {
    const dn = m.down, touch = dn?.t === 'touch'
    m.down = null
    if (dn && Math.hypot(e.clientX - dn.x, e.clientY - dn.y) > 6) return
    // a click's clientX is whole px in Chrome; the pointerdown's is exact, like the hover's,
    // so the click lands on the sample the readout names (1-minute bars are ~1 px wide)
    const h = hitX(plotX(dn ? dn.x : e.clientX), touch ? 'touch' : 'pointer'), cur = hover.get()
    if (!h) return
    // touch: the first tap shows the readout, a second tap on the same bar opens it
    if (touch && (!cur || cols(cur)[0] !== cols(h)[0])) return hover.set(h)
    p.onBarClick?.(h, e)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const k = e.key, cur = hover.get(), t = vp.getTarget(), w = t.endIndex - t.startIndex, mid = (t.startIndex + t.endIndex) / 2
    const go = (c: number, w2: number) => vp.setTarget({ startIndex: c - w2 / 2, endIndex: c + w2 / 2 })
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault()
      const dir = k === 'ArrowRight' ? 1 : -1
      const [a, b] = cur ? cols(cur) : [t.endIndex - dir, t.endIndex]
      const i = Math.max(0, Math.min(n - 1, dir > 0 ? b! : a! - 1))
      if (i < t.startIndex || i > t.endIndex) go(i, w)
      hover.set(hitAt(i, 'keyboard'))
    } else if ((k === 'Enter' || k === ' ') && cur?.source === 'keyboard') {
      e.preventDefault()
      p.onBarClick?.(cur, e)
    } else if (k === '+' || k === '=') go(mid, w / 1.5)
    else if (k === '-' || k === '_') go(mid, w * 1.5)
    else if (k === '0') vp.setTarget({ startIndex: 0, endIndex: n - 1 })
    else if (k === 'Escape') p.onEscape?.()
  }

  // ---- lanes: line, trend and area paths (opacity drops while a selection shows) ----
  const selOn = !!selU
  const laneLines = (all: NonNullable<typeof lanePathsAll>) =>
    lanesIn!.map((L, k) => {
      const ps = all[k]
      if (!ps) return null
      const area = L.kind === 'area'
      if (L.kind === 'bars') {
        const w = L.trend!.width ?? SP_LANE_WIDTH
        return fitLane(
          L.key,
          <g key={'t' + L.key} className="spc-lane-trend" data-lane={L.key}>
            {ps[0]!.line && (
              <path ref={regW(w)} d={ps[0]!.line} fill="none" stroke={ps[0]!.color} strokeOpacity={o3((L.trend!.opacity ?? 1) * (selOn ? 0.65 : 1))} strokeWidth={r2(laneWidth(w, span, n))} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            )}
          </g>,
        )
      }
      const w = L.width ?? (L.key === 'viewers' ? ([1.25, 1.25] as const) : ([1.5, 1.5] as const))
      const lop = L.lineOpacity != null ? o3(L.lineOpacity * (selOn && !area ? 0.65 : 1)) : selOn && !area ? 0.55 : undefined
      return fitLane(
        L.key,
        <g key={'l' + L.key} className={'spc-lane-' + L.kind} data-lane={L.key}>
          {ps.map((e, j) => {
            const gid = uid + 'g' + k + '-' + j
            return (
              // a plotted emote's line draws in from the left when it mounts (sp-chart.css .spc-line-in)
              <g key={e.key} className={L.lines ? 'spc-line-in' : undefined}>
                {e.fill && L.gradient && (
                  <defs>
                    <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor={e.color} stopOpacity={L.gradient[0]} />
                      <stop offset="1" stopColor={e.color} stopOpacity={L.gradient[1]} />
                    </linearGradient>
                  </defs>
                )}
                {e.fill && <path className="spc-lane-fill" d={e.fill} fill={L.gradient ? 'url(#' + gid + ')' : e.color} fillOpacity={L.gradient ? undefined : 0.1} />}
                {e.line && (
                  <path ref={regW(w)} data-lane-line={L.lines ? e.key : undefined} d={e.line} fill="none" stroke={e.color} strokeOpacity={lop} strokeWidth={r2(laneWidth(w, span, n))} strokeLinejoin="round" strokeLinecap={L.smooth || L.lines ? 'round' : undefined} vectorEffect="non-scaling-stroke" />
                )}
                {e.dots && <path className="spc-line spc-dots" d={e.dots} stroke={e.color} strokeOpacity={lop} vectorEffect="non-scaling-stroke" />}
              </g>
            )
          })}
        </g>,
      )
    })

  // ---- render ----
  const hl = p.highlightRange && d ? [uOf(p.highlightRange.startMs), uOf(p.highlightRange.endMs)] : null
  const liveU = le && d ? uOf(le.atMs) : null
  m.seq ??= le?.pollSeq

  return (
    <div ref={rootRef} className={'spc spc--' + (hub ? 'hub' : 'session') + (p.className ? ' ' + p.className : '')} style={{ '--spc-tick': tickCol + 'px' } as CSSProperties}>
      {topPx > 0 && (
        <div className="spc-top" style={{ height: topPx, width: PW || undefined }}>
          {ready && (
            <>
              <svg className="spc-top-svg" width={PW} height={topPx}>
                {lay(TOP, 'svg')}
              </svg>
              {lay(TOP, 'html')}
            </>
          )}
        </div>
      )}
      <div className="spc-plot" style={{ height: H }}>
        {ready ? (
          <>
            <svg
              ref={svgRef}
              className="spc-svg"
              width={W}
              height={H}
              role="application"
              aria-roledescription="chart"
              aria-label={p.ariaLabel ?? 'Analytics timeline chart'}
              aria-describedby={p.ariaDescribedBy}
              tabIndex={0}
              data-bench-plot=""
              data-activity-bucket-minutes={info?.minutes}
              data-selection={selBar ? '' : undefined}
              onPointerMove={onPointerMove}
              onPointerLeave={onPointerLeave}
              onPointerDown={e => void (m.down = { x: e.clientX, y: e.clientY, t: e.pointerType })}
              onMouseDown={e => e.preventDefault()}
              onClick={onClick}
              onKeyDown={onKeyDown}
              onBlur={() => hover.get()?.source === 'keyboard' && hover.set(null)}
            >
              <path className="spc-grid" d={valueAxis.grid} />
              {LB && lanesIn && laneStatics(LB, lanesIn, PW)}
              {/* the nested svg clips the plot (overflow hidden) */}
              <svg className="spc-clip" width={PW} height={H}>
                <pattern ref={patRef} id={uid} width="6" height="6" patternUnits="userSpaceOnUse">
                  <path className="spc-hatch-line" d="M0 0V6" />
                </pattern>
                {/* laneFit: one clip per lane box, in sample units across x */}
                {fitOn &&
                  LB?.map(b => (
                    <clipPath key={b.key} id={uid + 'c' + b.key}>
                      <rect x={-n - 1} y={b.y} width={3 * n + 2} height={b.height} />
                    </clipPath>
                  ))}
                <g ref={reg} data-spc-scaled="">
                  <path ref={hovRef} className="spc-hov" />
                  {hatch && <path className="spc-hatch" d={hatch} fill={'url(#' + uid + ')'} />}
                  <g className="spc-bars">{bars}</g>
                  {laneRects}
                  {lanePathsAll && laneLines(lanePathsAll)}
                  {series('viewers', lines?.v)}
                  {series('emotes', lines?.e)}
                  {series('overlay', lines?.o)}
                  {hl && <path className="spc-hl-dim" d={boxPath(-n, hl[0]!, top, H) + boxPath(hl[1]!, 2 * n, top, H)} />}
                  {hl && !LB && line('spc-hl-edge', rule(hl[0]!, top, H) + rule(hl[1]!, top, H))}
                  {selS && R
                    ? slide
                      ? <SpSelBand key={level!.step} a={selS[0]} b={selS[1]} y0={R.y} y1={R.y + R.height} sx={sxS} settleMs={slide.settleMs} reduced={slide.reducedMotion ? slide.reducedMotion() : prefersReducedMotion()} />
                      : line('spc-sel', boxPath(selS[0], selS[1], R.y, R.y + R.height))
                    : selU && R && line('spc-sel', selBar ? boxPath(selU[0]!, selU[1]!, R.y, R.y + R.height) : rule((selU[0]! + selU[1]!) / 2, top, H))}
                  <path ref={crossRef} className="spc-cross" vectorEffect="non-scaling-stroke" />
                  {liveU != null && line('spc-live-rule', rule(liveU, top, H))}
                  {lay(PANELS, 'scaled')}
                </g>
              </svg>
              {valueAxis.avg && <path ref={avgRef} className="spc-avg" d={valueAxis.avg} />}
              {valueAxis.marks && <path className="spc-tkmark" d={valueAxis.marks} />}
              {valueAxis.labels}
              <rect ref={touchRef} className="spc-touch" width={PW} height={H} fill="transparent" data-chart-touch-action="pan-y" />
              {lay(PANELS, 'svg')}
            </svg>
            <div className="spc-ov" style={{ width: PW }}>
              {!LB && caps?.rates && R && caption(caps.rates, R.y + 4, caps.rates.unit ?? '', '')}
              {!LB && caps?.viewers && V && caption(caps.viewers, V.y + 1, caps.viewers.unit ?? 'viewers', 'viewers-')}
              {LB && lanesIn && LB.map((b, k) => laneCaption(lanesIn[k]!, b))}
              {le && (
                <span ref={dotRef} className={le.stale ? 'spc-live spc-live-hollow' : 'spc-live'} data-chart-live-edge="" data-chart-live-edge-tone={le.tone}>
                  {/* one ring per new poll value: the keyed span remounts and its CSS animation runs once */}
                  {le.pollSeq !== m.seq && <span key={le.pollSeq} className="spc-ring" />}
                  {le.label && <span className="spc-vh">{le.label}</span>}
                </span>
              )}
              {lay(PANELS, 'html')}
            </div>
          </>
        ) : (
          <div className="spc-skel" data-skeleton="">
            {p.skeleton}
          </div>
        )}
      </div>
      <div className="spc-axisbox">
        {ready && ticks && (
          <svg className="spc-axis" data-bench-axis="" width={PW} height="22" aria-hidden="true">
            <path className="spc-axis-base" d={'M0 .5H' + PW} />
            {ticks.ms.map((t, j) => (
              <g key={t} ref={el => void (tickEls[j] = el)} visibility="hidden">
                <path d="M0 0V4" />
                <text y="17">{ticks.labels[j]}</text>
              </g>
            ))}
          </svg>
        )}
      </div>
      {p.navigator != null && <div className="spc-navslot">{p.navigator}</div>}
    </div>
  )
})
