/**
 * The session chart (plan §1.2, §2.4; d3-v2 session-original lanes, F21/F23/F24):
 * SpChart in lanes mode (Viewers, Chat, Emotes and the plotted-emote lane on one
 * time axis) with the session's layers (pins rail, category band, pin leaders
 * and ghost), the sliding selection band and the navigator slot. The pins rail,
 * leaders and ghost draw only with Show on chart's Moments marker (showPins);
 * without it the rail takes no height. AnalyticsChart owns the data, the
 * viewport store and the clicks; this file only assembles the chart.
 */
import { forwardRef, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { CHART_THEME } from '@streampulse/pulse-charts'
import {
  SpChart,
  SP_LANE_WIDTH,
  type SpBarOptions,
  type SpCaption,
  type SpCaptions,
  type SpChartHandle,
  type SpHit,
  type SpHoverStore,
  type SpLane,
  type SpLayer,
  type SpLiveEdge,
  type SpSelection,
  type SpSelSlide,
  type SpSeriesVisibility,
  type SpSpanMs,
  type SpViewportStore,
} from '@streampulse/pulse-charts/spchart'
import { useConsoleMotion } from '../../hooks/useConsoleMotion.ts'
import {
  sessionBandLayer,
  sessionPinMarksLayer,
  type SessionBandSegment,
  type SessionLeader,
  type SessionOverlayLine,
} from './SessionChartLayers.tsx'
import { sessionPinsLayer, SESSION_PINS_TOP_PX, type SessionPin } from './SessionChartPins.tsx'
import type { SessionChartModel } from './sessionSpChartModel.ts'

/**
 * F21: the hosted portal's bars. One bar per minute down to 1.05 px a minute (its
 * budget path), prod's thin centred widths, at most 1500 rects per bar lane.
 * Replaces D2's 5 px floor, ~72 bars and 10-minute ceiling.
 */
export const SESSION_BAR_OPTIONS: SpBarOptions = { minSlotPx: 1.05, tolerance: 0.85, rule: 'prod', maxRects: 1500 }

/** Plot height (session-original baseH and Expand): 440, expanded 580 (phones 340 / 420). */
export function sessionPlotHeight(expanded: boolean, phone: boolean): number {
  return phone ? (expanded ? 420 : 340) : expanded ? 580 : 440
}

/** Gap above a lane unless the lane sets its own (session-original laneGap). */
export const SESSION_LANE_GAP = 12
/** Gaps narrower than this many px join and draw no hatch (C04). */
export const SESSION_MIN_HATCH_PX = 6

const BAND = 'rgb(255 255 255 / .025)'
const OVERLAY_WASH = 'rgb(148 163 184 / .055)'
const OVERLAY_RULE = 'rgb(148 163 184 / .18)'

/**
 * The lanes (session-original.js `lanes`, prod's chart theme):
 * - Viewers: a cyan line over a cyan fade.
 * - Chat: faint violet bars under a violet trend.
 * - Emotes: green bars, brighter over the stream's spike threshold, under a green trend.
 * - The plotted emotes: one trace each in prod's per-emote palette, in a shorter
 *   bottom lane with no caption (F24). It shows while `overlays` is non-empty
 *   (the caller passes them with All and Emotes only).
 * The series segment picks the lanes. Captions: a lane's peak is its busiest
 * measured minute, the viewers peak the header's when given (D5); the avg joins
 * only with Show on chart's Averages (`showAvg`; viewers use the header's avg).
 */
export function sessionLanes(
  model: SessionChartModel,
  o: {
    series: SpSeriesVisibility
    overlays: readonly SessionOverlayLine[]
    showAvg: boolean
    /** The header's viewer figures (avg only with Averages on), or null. */
    viewers?: { peak: number | null; avg: number | null } | null
  },
): SpLane[] {
  const T = CHART_THEME
  const rate = (c: SpCaption | null): SpCaption | undefined => (c ? { peak: c.peak, avg: o.showAvg ? c.avg ?? null : null } : undefined)
  const v = o.viewers
  const vPeak = v?.peak ?? model.captions.viewers?.peak ?? null
  const lanes: SpLane[] = []
  if (o.series.viewers !== false) {
    lanes.push({
      key: 'viewers', label: 'Viewers', kind: 'area', color: T.viewer.color, unit: ' viewers', smooth: true,
      lineOpacity: T.viewer.line, gradient: [T.viewer.fillTop, T.viewer.fillBottom], width: SP_LANE_WIDTH, baseline: false,
      caption: vPeak != null ? { peak: vPeak, avg: o.showAvg ? v?.avg ?? null : null } : undefined,
    })
  }
  if (o.series.chat !== false) {
    lanes.push({
      key: 'chat', label: 'Chat', kind: 'bars', color: T.chat.color, unit: '/min', gap: 8, barOpacity: T.chat.whisperBar, minBarPx: 1,
      trend: { opacity: T.chat.lineOpacity, width: SP_LANE_WIDTH }, bg: BAND, baseline: false, caption: rate(model.captions.chat),
    })
  }
  if (o.series.emotes !== false) {
    lanes.push({
      key: 'emotes', label: 'Emotes', kind: 'bars', color: T.emote.color, unit: '/min', gap: 0, barOpacity: T.emote.bar,
      spikeOpacity: T.emote.barSpike, spikeAbs: model.emoteSpike ?? undefined, minBarPx: 1,
      trend: { opacity: T.emote.line, width: SP_LANE_WIDTH }, bg: BAND, baseline: false, caption: rate(model.captions.emotes),
    })
  }
  if (o.overlays.length) {
    lanes.push({
      key: 'overlay', label: 'Emote overlays', kind: 'line', color: o.overlays[0]!.color, unit: '/min', weight: 0.55, caption: false, gap: 0,
      lines: o.overlays.map(l => ({ key: l.key, color: l.color, values: l.values })),
      lineOpacity: 0.95, width: [1.15, 1.7], bridge: false, bg: [BAND, OVERLAY_WASH], topLine: OVERLAY_RULE, baseline: false,
    })
  }
  return lanes
}

export interface SessionSpChartProps {
  model: SessionChartModel
  store: SpViewportStore
  hover: SpHoverStore
  width: number
  plotHeight: number
  phone: boolean
  series: SpSeriesVisibility
  captions: SpCaptions
  liveEdge: SpLiveEdge | null
  highlightRange: SpSpanMs | null
  selected: SpSelection | null
  band: {
    segments: SessionBandSegment[]
    highlightedKey: string | null
    onHoverKey(key: string | null): void
  }
  pins: {
    list: SessionPin[]
    selectedIndex: number
    onSelect(pin: SessionPin): void
    onClear(): void
  }
  /** Show on chart's Moments marker: the pin rail, leaders and ghost. */
  showPins: boolean
  /** Plotted emotes, one trace each in the bottom lane (empty when hidden). */
  overlays: readonly SessionOverlayLine[]
  /** Px added to plotHeight (session-original fillH: the column fill). */
  extraPlotPx?: number
  previewOffsetSeconds: number | null
  navigator: ReactNode
  onBarClick(hit: SpHit): void
  onLevel?(minutes: number): void
}

export const SessionSpChart = forwardRef<SpChartHandle, SessionSpChartProps>(function SessionSpChart(p, ref) {
  const { model, store } = p
  const chartRef = useRef<SpChartHandle | null>(null)
  const setRef = useCallback((handle: SpChartHandle | null) => {
    chartRef.current = handle
    if (typeof ref === 'function') ref(handle)
    else if (ref) ref.current = handle
  }, [ref])

  const zoomToSegment = useCallback((segment: SessionBandSegment) => {
    const { startMs, stepMs } = model.data
    const startIndex = Math.max(0, Math.floor((segment.startMs - startMs) / stepMs))
    const endIndex = Math.min(model.n - 1, Math.ceil((segment.endMs - startMs) / stepMs) - 1)
    store.setTarget({ startIndex, endIndex: Math.max(endIndex, startIndex + 1) }, { animate: true })
  }, [model, store])

  // session-original lanes leaders: from the pin rail down through every lane to the last lane's floor,
  // which is the plot's bottom (the last lane takes the rest); the layer stops 3 px above what this returns
  const plotHeight = p.plotHeight + Math.max(0, Math.round(p.extraPlotPx ?? 0))
  const dataTopAt = useCallback((): number | null => plotHeight + 3, [plotHeight])

  // Lanes rebuild on data, series, plotted emotes and caption figures only (never on hover or zoom).
  // AnalyticsChart's captions say whether Averages is on: the rates avg is null without it.
  const { series, overlays, captions } = p
  const viewersOn = series.viewers !== false, chatOn = series.chat !== false, emotesOn = series.emotes !== false
  const showAvg = captions.rates?.avg != null || captions.viewers?.avg != null
  const vPeak = captions.viewers?.peak ?? null, vAvg = captions.viewers?.avg ?? null
  const lanes = useMemo(
    () =>
      sessionLanes(model, {
        series: { viewers: viewersOn, chat: chatOn, emotes: emotesOn },
        overlays,
        showAvg,
        viewers: { peak: vPeak, avg: vAvg },
      }),
    [model, viewersOn, chatOn, emotesOn, overlays, showAvg, vPeak, vAvg],
  )
  // F23: the selected bar's band slides with prod's settle; the console's reduced-motion gate makes it jump
  const { motionEnabled } = useConsoleMotion()
  const selSlide = useMemo<SpSelSlide>(() => ({ reducedMotion: () => !motionEnabled }), [motionEnabled])

  const ghostMsForOffset = useCallback((offsetSeconds: number) => model.originMs + (offsetSeconds + 30) * 1000, [model.originMs])

  const leaders = useMemo<SessionLeader[]>(
    () => p.pins.list.map((pin, i) => ({ ms: pin.pinMs, on: i === p.pins.selectedIndex })),
    [p.pins.list, p.pins.selectedIndex],
  )

  const { segments, highlightedKey, onHoverKey } = p.band
  const { list: pinList, onSelect, onClear, selectedIndex } = p.pins
  const { showPins } = p
  const layers = useMemo(() => {
    const out: SpLayer[] = []
    if (showPins) out.push(sessionPinsLayer({ pins: pinList, selectedIndex, onSelect, onClear, store }))
    const band = sessionBandLayer({ segments, highlightedKey, onHoverKey, onZoom: zoomToSegment })
    if (band) out.push(band)
    if (showPins) out.push(sessionPinMarksLayer({ leaders, dataTopAt, ghostMsForOffset, previewOffsetSeconds: p.previewOffsetSeconds }))
    return out
  }, [showPins, pinList, selectedIndex, onSelect, onClear, store, segments, highlightedKey, onHoverKey, zoomToSegment, leaders, dataTopAt, ghostMsForOffset, p.previewOffsetSeconds])

  return (
    <SpChart
      ref={setRef}
      data={model.data}
      viewport={store}
      hover={p.hover}
      series={p.series}
      barOptions={SESSION_BAR_OPTIONS}
      lanes={lanes.length ? lanes : null}
      laneGap={SESSION_LANE_GAP}
      minHatchPx={SESSION_MIN_HATCH_PX}
      selSlide={selSlide}
      plotHeight={plotHeight}
      density="session"
      tickColumnPx={p.phone ? 0 : 56}
      topPx={showPins ? SESSION_PINS_TOP_PX : 0}
      viewportOriginMs={model.originMs}
      width={p.width}
      captions={p.captions}
      gaps={model.gaps}
      liveEdge={p.liveEdge}
      highlightRange={p.highlightRange}
      selected={p.selected}
      layers={layers}
      navigator={p.navigator}
      className="ssc-chart"
      onBarClick={p.onBarClick}
      onLevel={p.onLevel}
    />
  )
})
