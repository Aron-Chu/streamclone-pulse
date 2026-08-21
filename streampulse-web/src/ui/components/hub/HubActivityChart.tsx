import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Activity } from 'lucide-react'
import type { HubActivityPoint } from '../../../lib/publicHub'
import { activityBucketMs, internalGapCount, maxConnectedGapMs, chartActivityPoints, hubActivityEmoteCount, activityAxisTickIndices, formatActivityAxisTick, resolveChartBucketSelection } from '../../../lib/hubActivitySummary'
import { isActivityGapMarker, isAttestedActivityGap } from '../../../lib/hubActivityHonesty'
import { hubBucketBarRect, hubBucketCenterX, hubTimeDomain, hubTimeXPercent } from '../../../lib/hubTimeScale'
import { useAnalyticsMotion } from '../../motion/useAnalyticsMotion'
import { CHART_MOTION } from '../../../lib/chartMotion'
import { useSmoothedScalar } from '../../motion/useSmoothedScalar'
import { compact, getProviderColor } from '../analytics/hubFormat'
import { preferResolvableEmoteUrl } from '../../../lib/emoteAssetUrl'
import { EmoteProviderIcon } from '../analytics/EmoteProviderIcon'
import { EmptyState, Skeleton } from './primitives'
import { HubRangeMenu } from './HubRangeMenu'
import { HubActivityBarSeries } from '../analytics/HubActivityBarSeries'
import { HubActivityRhythmLines } from '../analytics/HubActivityRhythmLines'
import { HubActivityMomentAnnotations } from '../analytics/HubActivityMomentAnnotations'
import { classifyMomentMarker, resolveAnnotationCollisions, type HubChartAnnotation } from '../../../lib/hubChartMarkers'

export type { HubActivityRangeOption, HubActivityRangeControl } from './HubRangeMenu'
import type { HubActivityRangeControl } from './HubRangeMenu'

/** Median-viewer depth for the rhythm baseline, as a % of chart height. */
function rhythmLinesAvg(viewerMax: number, height: number): number | null {
  return viewerMax > 0 ? 50 : null
}

/** 90th-percentile-viewer depth for the rhythm "loud" line, as a % of chart height. */
function rhythmLinesLoud(viewerMax: number, height: number): number | null {
  return viewerMax > 0 ? 75 : null
}

/** Map a chart moment marker to a renderable annotation in chart % space. */
function markerToAnnotation(marker: HubActivityMomentMarker, xPercent: number): HubChartAnnotation {
  return {
    key: marker.key,
    bucketT: marker.bucketT,
    at: marker.at,
    kind: classifyMomentMarker(marker),
    channelName: marker.key,
    source: 'network',
    xPercent,
    rawKind: marker.kind,
  }
}

export interface HubActivityMomentMarker {
  key: string
  bucketT: number
  /** Exact event time in ms when known — markers use this, not a neighboring bucket. */
  at?: number
  kind?: string
}

export interface HubActivityChartProps {
  points: HubActivityPoint[]
  windowMinutes: number
  channelCount: number
  /** Live pool size for chart copy (corpus-wide series, pool-sized roster). */
  poolSize?: number
  /** Sum of Helix viewer counts on hub live rows — floors sparse trailing buckets on chart. */
  livePoolViewerSum?: number
  expectedBuckets?: number
  missingBuckets?: number
  coveragePct?: number
  /** Honest empty-state copy when the hub serves an attested gap / no activity. */
  emptyTitle?: string
  emptyDescription?: string
  loading?: boolean
  footnote?: string
  /** Optional time-window selector rendered above the chart (24h/7d/1mo/…). */
  rangeControl?: HubActivityRangeControl
  /** Unix ms for the selected activity bucket (network moments filtering). */
  selectedBucketT?: number | null
  /** Soft highlight for a bucket tied to a moment row (no table filter). */
  accentBucketT?: number | null
  /** When set, chart clicks toggle bucket selection for Pulse Moments Live. */
  onBucketSelect?: (bucketT: number | null) => void
  /** Hover preview for bucket inspector rail. */
  onBucketHover?: (bucketT: number | null) => void
  /** Fresh peak markers pinned to chart buckets. */
  momentMarkers?: HubActivityMomentMarker[]
  selectedMomentKey?: string | null
  onSelectMomentKey?: (key: string | null) => void
  /** When true, draw provider overlay lines on the main chart (power-user mode). */
  showProviderOverlay?: boolean
  /** Lowercase emote name → image URL, used to render bucket emote thumbnails in the tooltip. */
  emoteImages?: Map<string, string>
}

type ProviderKey = 'sevenTv' | 'twitch' | 'bttv' | 'ffz'
export type CoreSeriesKey = 'viewers' | 'chat' | 'emotes'

const FOCUS_DIM_FACTOR = 0.14
const HUB_CHART_COMPACT_MQ = '(max-width: 719px)'

function useHubChartCompact(): boolean {
  const [compact, setCompact] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return Boolean(window.matchMedia(HUB_CHART_COMPACT_MQ)?.matches)
  })
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(HUB_CHART_COMPACT_MQ)
    if (!mq?.addEventListener) return
    const sync = () => setCompact(Boolean(mq.matches))
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return compact
}

function seriesFocusOpacity(
  focusedSeriesKey: CoreSeriesKey | null,
  seriesKey: string,
  base = 1,
): number {
  if (!focusedSeriesKey) return base
  if (seriesKey === focusedSeriesKey) return base
  const emoteFamily = seriesKey === 'emotes' || seriesKey.startsWith('provider:')
  if (focusedSeriesKey === 'emotes' && emoteFamily) return base
  return base * FOCUS_DIM_FACTOR
}

function seriesFocusClass(
  focusedSeriesKey: CoreSeriesKey | null,
  seriesKey: string,
): string {
  const dimmed = seriesFocusOpacity(focusedSeriesKey, seriesKey) < 1
  return dimmed ? 'hx-series is-dimmed' : 'hx-series'
}

interface Pt {
  x: number
  y: number
}

interface BucketSelectionCueProps {
  x: number
  label?: string | null
  tone: 'selected' | 'accent'
  motionEnabled: boolean
}

function BucketSelectionCue({ x, label, tone, motionEnabled }: BucketSelectionCueProps) {
  const edge = x < 14 ? 'start' : x > 86 ? 'end' : 'center'
  return (
    <span
      className={`hx-bucket-cue hx-bucket-cue--${tone}${motionEnabled ? ' hx-bucket-cue--motion' : ''}`}
      data-edge={edge}
      style={{ left: `${x}%` }}
      aria-hidden="true"
    >
      <span className="hx-bucket-cue__line" />
      {label ? <span className="hx-bucket-cue__label">{label}</span> : null}
    </span>
  )
}

const PROVIDER_KEYS: ProviderKey[] = ['sevenTv', 'twitch', 'bttv', 'ffz']

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  sevenTv: '7TV',
  twitch: 'Twitch',
  bttv: 'BTTV',
  ffz: 'FFZ',
}

const PROVIDER_SHORT_LABELS: Record<ProviderKey, string> = {
  sevenTv: '7TV',
  twitch: 'TW',
  bttv: 'BT',
  ffz: 'FFZ',
}

const PROVIDER_DASH: Partial<Record<ProviderKey, string>> = {
  sevenTv: '5 3',
  bttv: '2 3',
  ffz: '7 4',
}

const PROVIDER_COLOR_KEYS: Record<ProviderKey, string> = {
  sevenTv: '7tv',
  twitch: 'twitch',
  bttv: 'bttv',
  ffz: 'ffz',
}

const PROVIDER_STORAGE_KEY = 'sp.hub.providerLines'

function readStoredProviders(): Set<ProviderKey> | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(PROVIDER_STORAGE_KEY)
    if (raw == null) return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    const valid = parsed.filter((key): key is ProviderKey =>
      PROVIDER_KEYS.includes(key as ProviderKey),
    )
    return new Set(valid)
  } catch {
    return new Set()
  }
}

function saveEnabledProviders(enabled: Set<ProviderKey>) {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(PROVIDER_STORAGE_KEY, JSON.stringify([...enabled]))
  } catch {
    /* ignore quota errors */
  }
}

function emoteCount(point: HubActivityPoint): number {
  return hubActivityEmoteCount(point)
}


function providerValue(point: HubActivityPoint, key: ProviderKey): number {
  switch (key) {
    case 'sevenTv':
      return point.seventv ?? 0
    case 'twitch':
      return point.twitch ?? 0
    case 'bttv':
      return point.bttv ?? 0
    case 'ffz':
      return point.ffz ?? 0
    default:
      return 0
  }
}

function axisLabel(minutesAgo: number): string {
  if (minutesAgo <= 0) return 'now'
  if (minutesAgo >= 60 * 24 * 365) return `-${Math.round(minutesAgo / (60 * 24 * 365))}y`
  if (minutesAgo >= 60 * 24 * 30) return `-${Math.round(minutesAgo / (60 * 24 * 30))}mo`
  if (minutesAgo >= 60 * 24) return `-${Math.round(minutesAgo / (60 * 24))}d`
  if (minutesAgo >= 60) return `-${Math.round(minutesAgo / 60)}h`
  return `-${minutesAgo}m`
}

function windowLabel(minutes: number): string {
  if (minutes >= 60 * 24 * 365) return `${Math.round(minutes / (60 * 24 * 365))} year`
  if (minutes >= 60 * 24 * 30) return `${Math.round(minutes / (60 * 24 * 30))} month`
  if (minutes >= 60 * 24) return `${Math.round(minutes / (60 * 24))} day`
  if (minutes >= 60) return `${Math.round(minutes / 60)} hour`
  return `${minutes} minute`
}

function activePoint(point: HubActivityPoint): boolean {
  return (
    point.hasChatRollup ||
    point.hasViewerRollup ||
    (point.hasChatRollup !== false && point.chat > 0) ||
    point.seventv > 0 ||
    emoteCount(point) > 0 ||
    point.viewers > 0
  )
}

export function formatIncompleteCoveragePercent(
  pointCount: number,
  expectedBuckets: number,
): string {
  const expected = Math.max(0, Math.floor(expectedBuckets))
  const measured = Math.max(0, Math.floor(pointCount))
  if (expected === 0) return '0%'
  if (measured >= expected) return '100%'
  const pct = Math.floor(((measured / expected) * 100) * 10) / 10
  return `${pct.toFixed(1)}%`
}

function buildLine(pts: Pt[]): string {
  return monotoneCubicPath(pts)
}

/** Monotone cubic interpolation through a series — matches the pulse-charts
 *  presentation helper that the legacy chart used. Kept local so the chart
 *  has no dependency on a backend package export. */
function monotoneCubicPath(pts: Pt[]): string {
  if (pts.length === 0) return ''
  const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '0.00')
  const first = pts[0]!
  let path = `M${fmt(first.x)} ${fmt(first.y)}`
  if (pts.length === 1) return path
  if (pts.length === 2) {
    const second = pts[1]!
    return `${path} L${fmt(second.x)} ${fmt(second.y)}`
  }
  const intervals = pts.slice(0, -1).map((point, index) => {
    const next = pts[index + 1]!
    const dx = Math.max(0.0001, next.x - point.x)
    return { dx, slope: (next.y - point.y) / dx }
  })
  const slopes = new Array<number>(pts.length).fill(0)
  for (let index = 1; index < pts.length - 1; index += 1) {
    const left = intervals[index - 1]!
    const right = intervals[index]!
    if (left.slope === 0 || right.slope === 0 || Math.sign(left.slope) !== Math.sign(right.slope)) {
      slopes[index] = 0
      continue
    }
    const weightLeft = 2 * right.dx + left.dx
    const weightRight = right.dx + 2 * left.dx
    slopes[index] = (weightLeft + weightRight) / (weightLeft / left.slope + weightRight / right.slope)
  }
  slopes[0] = 0
  slopes[pts.length - 1] = 0
  for (let index = 0; index < pts.length - 1; index += 1) {
    const left = pts[index]!
    const right = pts[index + 1]!
    const dx = right.x - left.x
    if (dx <= 0) {
      path += ` L${fmt(right.x)} ${fmt(right.y)}`
      continue
    }
    const low = Math.min(left.y, right.y)
    const high = Math.max(left.y, right.y)
    const cp1y = Math.min(high, Math.max(low, left.y + (slopes[index]! * dx) / 3))
    const cp2y = Math.min(high, Math.max(low, right.y - (slopes[index + 1]! * dx) / 3))
    path += ` C ${fmt(left.x + dx / 3)} ${fmt(cp1y)}, ${fmt(right.x - dx / 3)} ${fmt(cp2y)}, ${fmt(right.x)} ${fmt(right.y)}`
  }
  return path
}

/**
 * Build smoothed line segments, breaking the line on large time gaps and —
 * when `sampleValues` is supplied — on buckets where the value is 0. Zero-value
 * buckets are treated as "no sample" rather than a real reading of 0, so the
 * line is interrupted instead of crashing to the chart floor. This matters for
 * the viewers series: IVR/GQL-backfilled chat buckets carry chat + emote counts
 * but no viewer samples, and plotting those zeros pinned the violet viewers line
 * to the bottom and then spiked it back up, which reads as a "broken" graph.
 */
function splitLinePaths(
  pts: Pt[],
  source: HubActivityPoint[],
  windowMinutes: number,
  sampleValues?: number[],
  hasSample?: boolean[],
): string[] {
  const maxGap = maxConnectedGapMs(windowMinutes)
  const measured: Array<{ pt: Pt; t: number }> = []
  for (let i = 0; i < pts.length; i += 1) {
    const isSample = hasSample
      ? hasSample[i]
      : !sampleValues || (sampleValues[i] ?? 0) > 0
    if (isSample && pts[i]) {
      measured.push({ pt: pts[i], t: source[i]?.t ?? 0 })
    }
  }
  if (measured.length === 0) return []
  if (measured.length === 1) {
    const p = measured[0].pt
    return [`M0 ${p.y.toFixed(2)} L100 ${p.y.toFixed(2)}`]
  }

  const rawSegments: Pt[][] = []
  let current: Pt[] = [measured[0].pt]
  for (let i = 1; i < measured.length; i += 1) {
    const prevT = measured[i - 1].t
    const currT = measured[i].t
    if (currT - prevT > maxGap) {
      if (current.length > 0) rawSegments.push(current)
      current = [measured[i].pt]
    } else {
      current.push(measured[i].pt)
    }
  }
  if (current.length > 0) rawSegments.push(current)

  const segments = rawSegments.map((seg) => {
    if (seg.length === 0) return seg
    const first = seg[0]
    const last = seg[seg.length - 1]
    const out = [...seg]
    if (first.x > 0 && first.x <= 25) {
      out.unshift({ x: 0, y: first.y })
    }
    if (last.x < 100 && last.x >= 75) {
      out.push({ x: 100, y: last.y })
    }
    return out
  })

  return segments.map(buildLine).filter(Boolean)
}

/** Close a lane line path to the baseline for a semi-transparent area fill. */
function areaPathFromLine(d: string): string {
  if (!d) return ''
  const nums = d.match(/-?\d*\.?\d+/g)
  if (!nums || nums.length < 4) return ''
  const startX = nums[0]
  const endX = nums[nums.length - 2]
  return `${d} L ${endX} 100 L ${startX} 100 Z`
}

export function HubActivityChart({
  points,
  windowMinutes,
  channelCount,
  poolSize,
  livePoolViewerSum,
  expectedBuckets,
  missingBuckets = 0,
  emptyTitle,
  emptyDescription,
  loading,
  footnote,
  rangeControl,
  selectedBucketT = null,
  accentBucketT = null,
  onBucketSelect,
  onBucketHover,
  momentMarkers = [],
  selectedMomentKey = null,
  onSelectMomentKey,
  showProviderOverlay = false,
  emoteImages,
}: HubActivityChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const compactAnnotations = useHubChartCompact()
  const [hover, setHover] = useState<number | null>(null)
  const hoverIndexRef = useRef<number | null>(null)
  const hoverRafRef = useRef<number | null>(null)
  const lastBucketTRef = useRef<number | null | undefined>(undefined)
  const [enabledProviders, setEnabledProviders] = useState<Set<ProviderKey> | null>(null)
  const [focusedSeriesKey, setFocusedSeriesKey] = useState<CoreSeriesKey | null>(null)
  const pressStartRef = useRef<{ x: number; y: number; index: number } | null>(null)
  const pressPointerIdRef = useRef<number | null>(null)
  const pressEnteredRef = useRef(false)
  const pressCancelledRef = useRef(false)
  const [pressDragging, setPressDragging] = useState(false)
  const keyboardIndexRef = useRef<number | null>(null)
  const suppressClickUntilRef = useRef(0)
  const [announcement, setAnnouncement] = useState('')

  const toggleSeriesFocus = useCallback((seriesKey: CoreSeriesKey) => {
    setFocusedSeriesKey((current) => (current === seriesKey ? null : seriesKey))
  }, [])

  useEffect(() => () => {
    if (hoverRafRef.current != null) {
      cancelAnimationFrame(hoverRafRef.current)
    }
  }, [])

  useEffect(() => {
    if (enabledProviders == null) return
    saveEnabledProviders(enabledProviders)
  }, [enabledProviders])

  const bucketSelectEnabled = Boolean(onBucketSelect)

  const chartAriaLabel = useMemo(() => {
    const poolLabel =
      (poolSize ?? channelCount) > 0
        ? `${poolSize ?? channelCount} channels in tracked pool`
        : 'tracked streams'
    const base = `Corpus-wide viewers, total emotes, and tracked IRC chat over the last ${windowLabel(windowMinutes)} (${poolLabel})`
    const selectedCopy =
      selectedBucketT != null
        ? ` Selected bucket: ${formatActivityAxisTick(selectedBucketT, windowMinutes)}.`
        : ''
    return bucketSelectEnabled
      ? `${base}.${selectedCopy} Click a bucket to filter Pulse Moments Live.`
      : `${base}.${selectedCopy}`
  }, [poolSize, channelCount, windowMinutes, bucketSelectEnabled, selectedBucketT])

  const providerMeta = useMemo(
    () =>
      PROVIDER_KEYS.reduce(
        (acc, key) => {
          acc[key] = {
            label: PROVIDER_LABELS[key],
            shortLabel: PROVIDER_SHORT_LABELS[key],
            color: getProviderColor(PROVIDER_COLOR_KEYS[key]),
            dash: PROVIDER_DASH[key],
          }
          return acc
        },
        {} as Record<ProviderKey, { label: string; shortLabel: string; color: string; dash?: string }>,
      ),
    [],
  )

  const chartPoints = useMemo(
    () => chartActivityPoints(points, windowMinutes, undefined, livePoolViewerSum),
    [points, windowMinutes, livePoolViewerSum],
  )
  const measuredChartPointCount = chartPoints.filter((point) => !isActivityGapMarker(point)).length

  const model = useMemo(() => {
    const n = chartPoints.length
    const viewerMax = chartPoints.reduce((acc, p) => Math.max(acc, p.viewers), 0) || 1
    const measuredChatValue = (point: HubActivityPoint): number =>
      point.hasChatRollup === false ? 0 : point.chat
    const chatMax = chartPoints.reduce((acc, p) => Math.max(acc, measuredChatValue(p)), 0) || 1
    const emoteMax =
      chartPoints.reduce(
        (acc, p) =>
          Math.max(
            acc,
            p.seventv,
            p.twitch ?? 0,
            p.bttv ?? 0,
            p.ffz ?? 0,
            emoteCount(p),
          ),
        0,
      ) || 1
    const PAD = 10
    const lastT = chartPoints[n - 1]?.t ?? 0
    const bucketDurationMs = activityBucketMs(windowMinutes)
    const timeDomain = hubTimeDomain(chartPoints, bucketDurationMs) ?? {
      start: lastT,
      endExclusive: lastT + bucketDurationMs,
      bucketDurationMs,
    }
    // rhythm reference lines share the stacked-bar scale so they sit
    // directly on the bars (median = avg, p90 = loud), excluding the
    // in-progress trailing bucket so it cannot skew the baseline.
    const rhythmAvg = rhythmLinesAvg(viewerMax, 100)
    const rhythmLoud = rhythmLinesLoud(viewerMax, 100)
    const startT = timeDomain.start
    const xAtIndex = (i: number): number => {
      if (n <= 1) return 50
      if (!timeDomain) return (i / Math.max(1, n - 1)) * 100
      return hubBucketCenterX(chartPoints[i]?.t ?? 0, timeDomain) ?? 50
    }
    const xs = chartPoints.map((_, i) => xAtIndex(i))
    const atViewerY = (value: number): number => PAD + (1 - value / viewerMax) * (100 - PAD)
    const atChatY = (value: number): number => PAD + (1 - value / chatMax) * (100 - PAD)
    const atEmoteY = (value: number): number => PAD + (1 - value / emoteMax) * (100 - PAD)
    const viewers = chartPoints.map((p, i) => ({ x: xs[i], y: atViewerY(p.viewers) }))
    const chat = chartPoints.map((p, i) => ({ x: xs[i], y: atChatY(measuredChatValue(p)) }))
    const totalEmotes = chartPoints.map((p, i) => ({ x: xs[i], y: atEmoteY(emoteCount(p)) }))
    const providerLines = PROVIDER_KEYS.reduce(
      (acc, key) => {
        acc[key] = splitLinePaths(
          chartPoints.map((p, i) => ({ x: xs[i], y: atEmoteY(providerValue(p, key)) })),
          chartPoints,
          windowMinutes,
          chartPoints.map((p) => providerValue(p, key)),
        )
        return acc
      },
      {} as Record<ProviderKey, string[]>,
    )
    const LANE_PAD = 4
    const providerLaneLines = PROVIDER_KEYS.reduce(
      (acc, key) => {
        const maxVal = chartPoints.reduce((a, p) => Math.max(a, providerValue(p, key)), 0) || 1
        const atLaneY = (value: number): number =>
          LANE_PAD + (1 - value / maxVal) * (100 - LANE_PAD * 2)
        acc[key] = splitLinePaths(
          chartPoints.map((p, i) => ({ x: xs[i], y: atLaneY(providerValue(p, key)) })),
          chartPoints,
          windowMinutes,
          chartPoints.map((p) => providerValue(p, key)),
        )
        return acc
      },
      {} as Record<ProviderKey, string[]>,
    )
    const internalGapBands: { left: number; width: number }[] = []
    const maxGap = maxConnectedGapMs(windowMinutes)
    for (let i = 1; i < chartPoints.length; i += 1) {
      const prevT = chartPoints[i - 1]?.t ?? 0
      const nextT = chartPoints[i]?.t ?? prevT
      if (nextT - prevT > maxGap) {
        internalGapBands.push({
          left: xs[i - 1],
          width: Math.max(0.5, xs[i] - xs[i - 1]),
        })
      }
    }

    const chatGapBands: { left: number; width: number; attested: boolean }[] = []
    let chatGapStart = -1
    let chatGapAttested = false
    const flushChatGap = (endIndex: number) => {
      if (chatGapStart < 0 || endIndex < chatGapStart) return
      const startRect = timeDomain ? hubBucketBarRect(chartPoints[chatGapStart]?.t ?? 0, timeDomain) : null
      const endRect = timeDomain ? hubBucketBarRect(chartPoints[endIndex]?.t ?? 0, timeDomain) : null
      const left = startRect?.left ?? 0
      const right = endRect ? endRect.left + endRect.width : 100
      chatGapBands.push({ left, width: Math.max(0.5, right - left), attested: chatGapAttested })
      chatGapStart = -1
      chatGapAttested = false
    }
    for (let i = 0; i < chartPoints.length; i += 1) {
      if (isAttestedActivityGap(chartPoints[i])) {
        if (chatGapStart < 0) chatGapStart = i
        chatGapAttested = true
      } else {
        flushChatGap(i - 1)
      }
    }
    flushChatGap(chartPoints.length - 1)
    const active = chartPoints.filter(activePoint)
    const firstActive = active[0]
    const firstActiveIndex = firstActive ? chartPoints.findIndex((p) => p.t === firstActive.t) : -1
    const firstActiveX = firstActiveIndex >= 0 ? xAtIndex(firstActiveIndex) : 0
    const sampleNote =
      firstActive && Math.max(0, Math.round((firstActive.t - startT) / 60_000)) > Math.max(15, windowMinutes * 0.2)
        ? `No live samples before ${axisLabel(Math.max(0, Math.round((lastT - firstActive.t) / 60_000)))}`
        : ''

    const slotWidth = n > 1 ? (xs[1] - xs[0]) : 4
    const barW = Math.max(1, Math.min(6, slotWidth * 0.7))
    const bars = chartPoints.map((p, i) => {
      const cx = xs[i] ?? 50
      const h = (measuredChatValue(p) / chatMax) * (100 - PAD)
      let x = cx - barW / 2
      let w = barW
      if (x < 0) {
        w += x
        x = 0
      }
      if (x + w > 100) w = 100 - x
      return { x, w, y: 100 - h, h, index: i }
    })

    return {
      n,
      chatMax,
      xs,
      lastT,
      timeDomain,
      rhythmAvg,
      rhythmLoud,
      bars,
      viewers,
      chat,
      totalEmotes,
      viewerLines: splitLinePaths(
        viewers,
        chartPoints,
        windowMinutes,
        undefined,
        chartPoints.map((p) => p.hasViewerRollup || p.viewers > 0),
      ),
      totalEmoteLines: splitLinePaths(
        totalEmotes,
        chartPoints,
        windowMinutes,
        chartPoints.map((p) => emoteCount(p)),
      ),
      providerLines,
      providerLaneLines,
      internalGapBands,
      chatGapBands,
      firstActiveX,
      sampleNote,
      internalGaps: internalGapCount(chartPoints, windowMinutes),
      peakViewers: chartPoints.reduce((a, p) => Math.max(a, p.viewers), 0),
      peakChat: chartPoints.reduce((a, p) => Math.max(a, measuredChatValue(p)), 0),
      peakEmotes: chartPoints.reduce((a, p) => Math.max(a, emoteCount(p)), 0),
      emoteMax,
      peakViewerAt: (() => {
        let idx = 0
        for (let i = 0; i < chartPoints.length; i += 1) {
          if (chartPoints[i].viewers >= chartPoints[idx].viewers) idx = i
        }
        return formatActivityAxisTick(chartPoints[idx]?.t ?? 0, windowMinutes)
      })(),
      peakChatAt: (() => {
        let idx = 0
        for (let i = 0; i < chartPoints.length; i += 1) {
          if (measuredChatValue(chartPoints[i]) >= measuredChatValue(chartPoints[idx])) idx = i
        }
        return formatActivityAxisTick(chartPoints[idx]?.t ?? 0, windowMinutes)
      })(),
    }
  }, [chartPoints, windowMinutes])

  // Destructure before any early return so hook order stays stable across
  // loading → data transitions (React hook rules).
  const { timeDomain } = model

  // Moment markers → render-ready annotations: spikes vs regular, resolved
  // collisions in the chart's coordinate space, selected-state dimming.
  const chartAnnotations = useMemo<HubChartAnnotation[]>(() => {
    if (momentMarkers.length === 0) return []
    const pre = momentMarkers
      .map((marker) => {
        const at = marker.at ?? marker.bucketT
        const x = timeDomain ? hubTimeXPercent(at, timeDomain) : null
        if (x == null) return null
        return markerToAnnotation(marker, x)
      })
      .filter((a): a is HubChartAnnotation => a != null)
    const resolved = resolveAnnotationCollisions(pre, { minSpacingPx: 24 })
    const selectedKey = selectedMomentKey
    return selectedKey ? resolved.map((a) => (a.key === selectedKey ? { ...a, labelOmitted: false } : a)) : resolved
  }, [momentMarkers, timeDomain, selectedMomentKey])

  const ticks = useMemo(() => {
    return activityAxisTickIndices(chartPoints.length).map((index) =>
      formatActivityAxisTick(chartPoints[index]?.t ?? 0, windowMinutes),
    )
  }, [chartPoints, windowMinutes])

  // Only surface provider lines that actually carry data. The live global
  // rollups break out 7TV (dedicated column); Twitch/BTTV/FFZ only appear when
  // per-emote provider rollups exist for the window, so dead toggles are hidden
  // instead of drawing flat zero lines the user reads as "broken".
  const availableProviders = useMemo(
    () => PROVIDER_KEYS.filter((key) => chartPoints.some((p) => providerValue(p, key) > 0)),
    [chartPoints],
  )
  const storedProviders = useMemo(() => readStoredProviders(), [chartPoints.length])
  const resolvedEnabledProviders = useMemo(() => {
    if (enabledProviders != null) return enabledProviders
    if (storedProviders != null) return storedProviders
    return new Set(availableProviders)
  }, [enabledProviders, storedProviders, availableProviders])
  const shownProviders = showProviderOverlay
    ? availableProviders
    : availableProviders.filter((key) => resolvedEnabledProviders.has(key))
  const hasTotalEmotes = useMemo(
    () => chartPoints.some((p) => emoteCount(p) > 0),
    [chartPoints],
  )

  const { motionEnabled } = useAnalyticsMotion()

  // The spike-glow pulse and trailing-bucket sweep sit on CSS/SMIL animation;
  // honor OS-level reduced motion by gating the pulse element itself.
  const [reducedMotion, setReducedMotion] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const crosshairTargets = useMemo(() => {
    if (hover == null) {
      return { hx: 0, hy: 0, emoteHy: 0, hasViewer: false, hasEmote: false }
    }
    const hp = chartPoints[hover]
    const emoteVal = hp ? emoteCount(hp) : 0
    return {
      hx: model.chat[hover]?.x ?? 0,
      hy: hp && hp.viewers > 0 ? (model.viewers[hover]?.y ?? 0) : 0,
      emoteHy: emoteVal > 0 ? (model.totalEmotes[hover]?.y ?? 0) : 0,
      hasViewer: Boolean(hp && hp.viewers > 0),
      hasEmote: emoteVal > 0,
    }
  }, [hover, chartPoints, model.chat, model.viewers, model.totalEmotes])

  const crosshairEnabled = hover != null && motionEnabled
  const smoothHx = useSmoothedScalar(crosshairTargets.hx, crosshairEnabled)
  const smoothHy = useSmoothedScalar(
    crosshairTargets.hy,
    crosshairEnabled && crosshairTargets.hasViewer,
  )
  const smoothEmoteHy = useSmoothedScalar(
    crosshairTargets.emoteHy,
    crosshairEnabled && crosshairTargets.hasEmote,
  )

  const flushHover = useCallback((index: number | null) => {
    setHover(index)
    if (!onBucketHover) return
    if (index == null) {
      if (lastBucketTRef.current !== null) {
        lastBucketTRef.current = null
        onBucketHover(null)
      }
      return
    }
    const point = chartPoints[index]
    const bucketT = point?.t ?? null
    if (bucketT === lastBucketTRef.current) return
    lastBucketTRef.current = bucketT
    onBucketHover(bucketT)
  }, [chartPoints, onBucketHover])

  const commitHoverIndex = useCallback((index: number | null) => {
    hoverIndexRef.current = index
    if (hoverRafRef.current != null) return
    hoverRafRef.current = requestAnimationFrame(() => {
      hoverRafRef.current = null
      flushHover(hoverIndexRef.current)
    })
  }, [flushHover])

  const rangeTabs = rangeControl ? <HubRangeMenu control={rangeControl} /> : null

  if (loading) {
    return (
      <>
        {rangeControl ? <div className="hx-chart-actions">{rangeTabs}</div> : null}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 220, marginTop: '0.7rem' }} aria-hidden="true">
          {Array.from({ length: 24 }).map((_, i) => (
            <Skeleton key={i} width={10} height={`${30 + ((i * 37) % 60)}%`} radius="3px" style={{ flex: 1 }} />
          ))}
        </div>
      </>
    )
  }

  if (points.length < 2) {
    return (
      <>
        {rangeControl ? <div className="hx-chart-actions">{rangeTabs}</div> : null}
        <EmptyState icon={<Activity aria-hidden="true" />}>
          {emptyTitle ? (
            <>
              <strong>{emptyTitle}</strong>
              {emptyDescription ? <> — {emptyDescription}</> : null}
            </>
          ) : (
            'Waiting for live activity — the chart draws once channels start sending chat and emotes.'
          )}
        </EmptyState>
      </>
    )
  }

  const {
    chatMax,
    xs,
    lastT,
    rhythmAvg,
    rhythmLoud,
    bars,
    viewers,
    chat,
    viewerLines,
    totalEmoteLines,
    providerLines,
    providerLaneLines,
    internalGapBands,
    chatGapBands,
    firstActiveX,
    sampleNote,
    internalGaps,
    peakViewers,
    peakChat,
    peakEmotes,
    peakViewerAt,
    peakChatAt,
  } = model

  const chartSummary = (() => {
    const parts: string[] = []
    if (peakViewers > 0) {
      parts.push(`Peak ${compact(peakViewers)} viewers at ${peakViewerAt}`)
    }
    if (peakChat > 0) {
      parts.push(`chat busiest around ${peakChatAt}`)
    }
    return parts.length > 0 ? parts.join(' · ') : null
  })()

  function nearestPointIndex(clientX: number): number {
    const el = wrapRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const ratio = rect.width ? (clientX - rect.left) / rect.width : 0
    const mx = Math.max(0, Math.min(100, ratio * 100))
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < xs.length; i += 1) {
      const dist = Math.abs(xs[i] - mx)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    }
    return best
  }

  function handleMove(event: ReactMouseEvent<HTMLDivElement>) {
    const best = nearestPointIndex(event.clientX)
    commitHoverIndex(best)
  }

  function handleLeave() {
    if (hoverRafRef.current != null) {
      cancelAnimationFrame(hoverRafRef.current)
      hoverRafRef.current = null
    }
    hoverIndexRef.current = null
    flushHover(null)
  }

  function handleClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!onBucketSelect) return
    if (Date.now() < suppressClickUntilRef.current) return
    setFocusedSeriesKey(null)
    const best = nearestPointIndex(event.clientX)
    const point = chartPoints[best]
    const next = resolveChartBucketSelection(point, selectedBucketT)
    if (next === undefined) return
    onBucketSelect(next)
  }

  /** Touch tap/scrub uses horizontal intent; vertical motion remains page scroll. */
  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!onBucketSelect || event.pointerType === 'mouse') return
    if (event.button !== undefined && event.button !== 0) return
    const best = nearestPointIndex(event.clientX)
    pressPointerIdRef.current = event.pointerId
    pressStartRef.current = { x: event.clientX, y: event.clientY, index: best }
    pressEnteredRef.current = false
    pressCancelledRef.current = false
    commitHoverIndex(best)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!onBucketSelect || event.pointerType === 'mouse' || !pressStartRef.current) return
    const start = pressStartRef.current
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (!pressEnteredRef.current && Math.abs(dy) >= 6 && Math.abs(dy) > Math.abs(dx)) {
      pressCancelledRef.current = true
      pressStartRef.current = null
      pressPointerIdRef.current = null
      flushHover(null)
      return
    }
    if (!pressEnteredRef.current && Math.abs(dx) >= 6 && Math.abs(dx) > Math.abs(dy)) {
      pressEnteredRef.current = true
      setPressDragging(true)
      try {
        wrapRef.current?.setPointerCapture(event.pointerId)
      } catch {
        /* ignore capture failures in test browsers */
      }
    }
    if (pressEnteredRef.current) commitHoverIndex(nearestPointIndex(event.clientX))
  }

  function finalizePointerSelection(index: number) {
    const point = chartPoints[index]
    pressStartRef.current = null
    pressPointerIdRef.current = null
    pressEnteredRef.current = false
    setPressDragging(false)
    if (!point || !onBucketSelect || pressCancelledRef.current) {
      pressCancelledRef.current = false
      return
    }
    pressCancelledRef.current = false
    setFocusedSeriesKey(null)
    const next = resolveChartBucketSelection(point, selectedBucketT)
    if (next === undefined) return
    onBucketSelect(next)
    setAnnouncement(next == null ? 'Bucket selection cleared' : `Selected ${formatActivityAxisTick(next, windowMinutes)}`)
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!onBucketSelect || event.pointerType === 'mouse') return
    suppressClickUntilRef.current = Date.now() + 500
    if (pressStartRef.current == null) {
      pressCancelledRef.current = false
      return
    }
    const index = pressEnteredRef.current ? nearestPointIndex(event.clientX) : pressStartRef.current.index
    if (pressEnteredRef.current && pressPointerIdRef.current != null) {
      try {
        wrapRef.current?.releasePointerCapture(pressPointerIdRef.current)
      } catch {
        /* ignore capture failures in test browsers */
      }
    }
    finalizePointerSelection(index)
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse') return
    pressStartRef.current = null
    pressPointerIdRef.current = null
    pressEnteredRef.current = false
    pressCancelledRef.current = false
    setPressDragging(false)
    flushHover(null)
  }

  function selectKeyboardIndex(index: number) {
    const bounded = Math.max(0, Math.min(chartPoints.length - 1, index))
    keyboardIndexRef.current = bounded
    commitHoverIndex(bounded)
    const point = chartPoints[bounded]
    if (!point) return
    setAnnouncement(`${formatActivityAxisTick(point.t, windowMinutes)}, ${compact(point.viewers)} viewers, ${compact(point.chat)} chat, ${compact(hubActivityEmoteCount(point))} emotes`)
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!bucketSelectEnabled || chartPoints.length === 0) return
    const selectedIndex = selectedBucketT == null ? -1 : chartPoints.findIndex((point) => point.t === selectedBucketT)
    const current = keyboardIndexRef.current ?? (hover ?? (selectedIndex >= 0 ? selectedIndex : 0))
    if (event.key === 'Home') {
      event.preventDefault()
      selectKeyboardIndex(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      selectKeyboardIndex(chartPoints.length - 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const step = event.shiftKey ? 5 : 1
      selectKeyboardIndex(current + (event.key === 'ArrowRight' ? step : -step))
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const point = chartPoints[current]
      if (!point) return
      setFocusedSeriesKey(null)
      const next = resolveChartBucketSelection(point, selectedBucketT)
      onBucketSelect?.(next ?? null)
      setAnnouncement(next == null ? 'Bucket selection cleared' : `Selected ${formatActivityAxisTick(next, windowMinutes)}`)
    } else if (event.key === 'Escape' && selectedBucketT != null) {
      event.preventDefault()
      onBucketSelect?.(null)
      setAnnouncement('Bucket selection cleared')
    }
  }

  const selectedIndex =
    selectedBucketT != null ? chartPoints.findIndex((point) => point.t === selectedBucketT) : -1

  const accentIndex =
    accentBucketT != null && selectedBucketT == null
      ? chartPoints.findIndex((point) => point.t === accentBucketT)
      : -1

  const hp = hover != null && chartPoints[hover] != null && !isActivityGapMarker(chartPoints[hover]) ? chartPoints[hover] : null
  const hx = crosshairEnabled ? smoothHx : crosshairTargets.hx
  const hy =
    crosshairEnabled && crosshairTargets.hasViewer ? smoothHy : crosshairTargets.hy
  const emoteHy =
    crosshairEnabled && crosshairTargets.hasEmote ? smoothEmoteHy : crosshairTargets.emoteHy
  const tipShift = hx < 18 ? '0%' : hx > 82 ? '-100%' : '-50%'
  const tipStyle = { left: `${hx}%`, transform: `translateX(${tipShift})` }
  const tipPoint = hover != null ? chartPoints[hover] : null
  const tipMinutesAgo = tipPoint != null ? Math.max(0, Math.round((lastT - tipPoint.t) / 60_000)) : 0

  function toggleProvider(key: ProviderKey) {
    if (showProviderOverlay) return
    setEnabledProviders((prev) => {
      const base = prev ?? resolvedEnabledProviders
      const next = new Set(base)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <>
      <div className="hx-chart-header">
        {rangeControl ? (
          <div className="hx-chart-header__window">
            {rangeTabs}
          </div>
        ) : null}
        <div className="hx-chart-actions" aria-label="Chart series toggles">
          <div className="hx-legend" role="group" aria-label="Chart series">
            <button
              type="button"
              className={`hx-legend-chip${focusedSeriesKey === 'viewers' ? ' is-focused' : ''}${focusedSeriesKey != null && focusedSeriesKey !== 'viewers' ? ' is-dimmed' : ''}`}
              aria-pressed={focusedSeriesKey === 'viewers'}
              title={focusedSeriesKey === 'viewers' ? 'Click to show all series' : 'Highlight Viewers'}
              onClick={() => toggleSeriesFocus('viewers')}
            >
              <span className="sw" style={{ background: 'hsl(var(--sp-chart-viewers))' }} aria-hidden="true" />
              Viewers
            </button>
            <button
              type="button"
              className={`hx-legend-chip${focusedSeriesKey === 'chat' ? ' is-focused' : ''}${focusedSeriesKey != null && focusedSeriesKey !== 'chat' ? ' is-dimmed' : ''}`}
              aria-pressed={focusedSeriesKey === 'chat'}
              title={focusedSeriesKey === 'chat' ? 'Click to show all series' : 'Highlight Tracked IRC chat'}
              onClick={() => toggleSeriesFocus('chat')}
            >
              <span className="sw sw--bar sw--chat" aria-hidden="true" />
              <span className="hx-series-label--full">Tracked IRC chat / min</span>
              <span className="hx-series-label--compact">Chat/min</span>
            </button>
            {hasTotalEmotes ? (
              <button
                type="button"
                className={`hx-legend-chip${focusedSeriesKey === 'emotes' ? ' is-focused' : ''}${focusedSeriesKey != null && focusedSeriesKey !== 'emotes' ? ' is-dimmed' : ''}`}
                aria-pressed={focusedSeriesKey === 'emotes'}
                title={focusedSeriesKey === 'emotes' ? 'Click to show all series' : 'Highlight Total emotes/min'}
                onClick={() => toggleSeriesFocus('emotes')}
              >
                <span className="sw sw--dash sw--emotes" aria-hidden="true" />
                <span className="hx-series-label--full">Total emotes/min</span>
                <span className="hx-series-label--compact">Emotes/min</span>
              </button>
            ) : null}
          </div>
        {availableProviders.length > 0 && !showProviderOverlay ? (
          <div className="hx-provider-chips" role="group" aria-label="Emote provider lanes">
            {availableProviders.map((key) => {
              const active = resolvedEnabledProviders.has(key)
              return (
                <button
                  key={key}
                  type="button"
                  className={`hx-provider-chip${active ? ' is-active' : ''}`}
                  aria-pressed={active}
                  title={`${active ? 'Hide' : 'Show'} ${providerMeta[key].label} provider lane`}
                  onClick={() => toggleProvider(key)}
                >
                  <EmoteProviderIcon provider={PROVIDER_COLOR_KEYS[key]} size={14} />
                  <span>{providerMeta[key].label}</span>
                </button>
              )
            })}
          </div>
        ) : null}
        </div>
        <div className="hx-chart-header__readout" aria-live="polite">
          {hp ? (
            <><strong>{axisLabel(Math.max(0, Math.round((lastT - hp.t) / 60_000)))}</strong> · Viewers {compact(hp.viewers)} · Chat {compact(hp.chat)} · Emotes {compact(emoteCount(hp))}</>
          ) : hover != null ? 'No recorded activity in this bucket · Viewers — · Chat — · Emotes —' : ''}
        </div>
      </div>
      {chartSummary ? (
        <p className="hx-chart-summary muted" role="status">
          {chartSummary}
        </p>
      ) : null}
      <div className="hx-plot-stack" data-hub-compact={compactAnnotations ? 'true' : undefined}>
        <div
          className="hx-chart-series-labels"
          data-hub-chart-series-labels
          hidden={!compactAnnotations}
        >
          <span className="hx-chart-series-labels__item hx-chart-series-labels__item--viewers">
            {compact(peakViewers)} peak viewers
          </span>
          {hasTotalEmotes && !showProviderOverlay ? (
            <span className="hx-chart-series-labels__item hx-chart-series-labels__item--emotes">
              {compact(peakEmotes)}/m peak emotes
            </span>
          ) : null}
          <span className="hx-chart-series-labels__item hx-chart-series-labels__item--chat">
            {compact(chatMax)}/m peak chat
          </span>
        </div>
        <div className="hx-plot-stack__row hx-plot-stack__row--full">
          <div className="hx-plot-stack__plot">
            <div className="hx-chart-axis-labels" aria-hidden="true" hidden={compactAnnotations}>
              <span className="hx-chart-axis-labels__left">Viewers</span>
              {hasTotalEmotes && !showProviderOverlay ? (
                <span className="hx-chart-axis-labels__center">Total emotes/min</span>
              ) : null}
              <span className="hx-chart-axis-labels__right">Tracked IRC chat/min</span>
            </div>
          </div>
        </div>
        <div className="hx-plot-stack__row hx-plot-stack__row--full">
          <div className="hx-plot-stack__plot hx-plot-stack__plot--chart">
            <div
              ref={wrapRef}
              data-hover={hover != null ? 'true' : undefined}
              data-selected={selectedIndex >= 0 ? 'true' : undefined}
              className={`hx-chart2${bucketSelectEnabled ? ' hx-chart2--selectable' : ''}${pressDragging ? ' hx-chart2--dragging' : ''}`}
              role="img"
              aria-label={chartAriaLabel}
              tabIndex={onSelectMomentKey || bucketSelectEnabled ? 0 : undefined}
              onMouseMove={handleMove}
              onMouseLeave={handleLeave}
              onPointerLeave={handleLeave}
              onClick={bucketSelectEnabled ? handleClick : undefined}
              onPointerDown={bucketSelectEnabled ? handlePointerDown : undefined}
              onPointerMove={bucketSelectEnabled ? handlePointerMove : undefined}
              onPointerUp={bucketSelectEnabled ? handlePointerUp : undefined}
              onPointerCancel={bucketSelectEnabled ? handlePointerCancel : undefined}
              onKeyDown={(event) => {
                const fromMarker = (event.target as HTMLElement | null)?.closest?.('[data-chart-marker-key]')
                if (event.key === 'Escape' && selectedMomentKey) {
                  event.preventDefault()
                  onSelectMomentKey?.(null)
                  return
                }
                if (fromMarker) return
                if (bucketSelectEnabled) handleKeyDown(event)
              }}
            >
              <svg key={windowMinutes} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <g className="grid">
            {[25, 50, 75].map((y) => (
              <line key={y} x1="0" y1={y} x2="100" y2={y} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
          <g className={`hx-bar-series-layer bars hx-series ${focusedSeriesKey != null && focusedSeriesKey !== 'chat' ? 'is-dimmed' : ''} ${seriesFocusClass(focusedSeriesKey, 'chat')}`} aria-hidden="true">
            {bars.map((bar) =>
              bar.h > 0.35 ? (
                <rect
                  key={bar.index}
                  data-index={bar.index}
                  className={`hx-chat-bar${hover === bar.index ? ' is-active' : ''}${selectedIndex === bar.index ? ' is-selected' : ''}${accentIndex === bar.index && selectedIndex !== bar.index ? ' is-accent' : ''}`}
                  x={bar.x}
                  y={bar.y}
                  width={bar.w}
                  height={bar.h}
                  rx="0.5"
                  onClick={() => onBucketSelect?.(chartPoints[bar.index]?.t ?? null)}
                  style={{ cursor: onBucketSelect ? 'pointer' : 'default' }}
                />
              ) : null,
            )}
          </g>
          {/* Continuous smoothed viewer curve with crisp underlay */}
          <g opacity={seriesFocusOpacity(focusedSeriesKey, 'viewers')}>
            {viewerLines.map((line, i) => (
              <path
                key={`view-underlay-${i}`}
                className="hx-chart-line hx-chart-line-underlay"
                d={line}
                fill="none"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {viewerLines.map((line, i) => (
              <path
                key={`view-${i}`}
                className="hx-chart-line hx-chart-line--viewers"
                d={line}
                fill="none"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </g>
          {/* Continuous smoothed total emotes curve */}
          {hasTotalEmotes && !showProviderOverlay ? (
            <g opacity={seriesFocusOpacity(focusedSeriesKey, 'emotes')}>
              {totalEmoteLines.map((line, i) => (
                <g key={`emote-${i}`}>
                  <path
                    className="hx-chart-line hx-chart-line-underlay hx-chart-line-underlay--emotes"
                    d={line}
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    className="hx-chart-line hx-chart-line--emotes"
                    d={line}
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              ))}
            </g>
          ) : null}
          {showProviderOverlay
            ? shownProviders.map((key) => (
              <g key={key} className={seriesFocusClass(focusedSeriesKey, `provider:${key}`)}>
                {providerLines[key].map((line, i) => (
                  <path
                    key={`${key}-${i}`}
                    className="hx-chart-line hx-chart-line--provider"
                    d={line}
                    fill="none"
                    stroke={providerMeta[key].color}
                    strokeDasharray={providerMeta[key].dash}
                    vectorEffect="non-scaling-stroke"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
              </g>
            ))
            : null}
          <HubActivityMomentAnnotations
            annotations={chartAnnotations}
            height={100}
            reducedMotion={reducedMotion}
            selectedAnnotationKey={selectedMomentKey}
          />
        </svg>

        <div className="hx-chart2__layer">
          {selectedIndex >= 0 ? (
            <BucketSelectionCue
              key={`selected-${chartPoints[selectedIndex]?.t ?? selectedIndex}`}
              x={xs[selectedIndex] ?? 0}
              tone="selected"
              motionEnabled={motionEnabled}
            />
          ) : accentIndex >= 0 ? (
            <BucketSelectionCue
              key={`accent-${chartPoints[accentIndex]?.t ?? accentIndex}`}
              x={xs[accentIndex] ?? 0}
              label="Moment bucket"
              tone="accent"
              motionEnabled={motionEnabled}
            />
          ) : null}
          {/* Preserved legacy interaction layer: keyboard/touch hit targets with the
              chart-marker contract (data-chart-marker-key, selection kind, aria-pressed,
              focus ring). Visuals come from HubActivityMomentAnnotations; these buttons
              are the interactive surface bound to the same annotations. */}
          {chartAnnotations.map((a) => (
            <button
              key={a.key}
              type="button"
              tabIndex={0}
              className={`hx-signal-marker${selectedMomentKey === a.key ? ' hx-signal-marker--selected' : ''}${a.labelOmitted ? '' : ''}`}
              data-chart-marker-key={a.key}
              data-chart-selection-kind={(a.rawKind ?? a.kind).toLowerCase()}
              data-hub-focus-ring="ring"
              style={{ left: `${a.xPercent ?? 50}%`, minWidth: 24, minHeight: 24 }}
              aria-label={`Signal marker ${a.kind}${selectedMomentKey === a.key ? ', selected' : ''}`}
              aria-pressed={selectedMomentKey === a.key}
              onClick={(event) => {
                event.stopPropagation()
                onSelectMomentKey?.(selectedMomentKey === a.key ? null : a.key)
              }}
            />
          ))}
          {!compactAnnotations ? (
            <>
          <span className="ylab ylab--viewers">{compact(peakViewers)} peak viewers</span>
          <span className="ylab ylab--chat">{compact(chatMax)}/m peak chat</span>
          {hasTotalEmotes && !showProviderOverlay ? (
            <span className="ylab ylab--emotes">{compact(peakEmotes)}/m peak emotes</span>
          ) : null}
            </>
          ) : null}
          {sampleNote ? (
            <span className="gap-fill" style={{ width: `${Math.max(0, firstActiveX)}%` }} />
          ) : null}
          {!sampleNote && internalGaps > 0 ? (
            <>
              {internalGapBands.map((band, i) => (
                <span
                  key={`gap-band-${i}`}
                  className="gap-fill gap-fill--internal"
                  style={{ left: `${band.left}%`, width: `${band.width}%` }}
                />
              ))}
            </>
          ) : null}
          {!sampleNote ? (
            <>
              {chatGapBands.map((band, i) => (
                <span
                  key={`chat-gap-band-${i}`}
                  className={`gap-fill gap-fill--internal gap-fill--chat-rollup${band.attested ? ' gap-fill--attested' : ''}`}
                  style={{ left: `${band.left}%`, width: `${band.width}%` }}
                />
              ))}
            </>
          ) : null}

          {hover != null ? (
            <>
              <span className="cross hx-crosshair" style={{ left: `${hx}%` }} />
              {hp && hp.viewers > 0 ? (
                <span
                  className="hdot hx-crosshair"
                  style={{ left: `${hx}%`, top: `${hy}%`, background: 'hsl(var(--sp-chart-viewers))' }}
                />
              ) : null}
              {hasTotalEmotes && !showProviderOverlay && hp && emoteCount(hp) > 0 ? (
                <span className="hdot hx-crosshair hx-crosshair--emotes" style={{ left: `${hx}%`, top: `${emoteHy}%` }} />
              ) : null}
            </>
          ) : null}
        </div>
        <span className="hx-chart-sr" role="status">{announcement}</span>
            </div>
            <div className="hx-chart-tip-slot" aria-live="polite">
            {hover != null && tipPoint ? (
              <div className="tip" style={tipStyle}>
                <div className="t">{axisLabel(tipMinutesAgo)}</div>
                <div className="tip-metrics">
                {hp ? (
                  <>
                  <div className="row">
                    <span className="sw" style={{ background: 'hsl(var(--sp-chart-viewers))' }} />
                    Viewers&nbsp;<b>{compact(hp.viewers)}</b>
                  </div>
                  <div className="row">
                    <span className="sw sw--bar sw--chat" />
                    {hp.hasChatRollup === false ? (
                      <>Tracked IRC chat&nbsp;<b>no rollups</b></>
                    ) : hp.hasChatRollup === undefined ? (
                      <>Tracked IRC chat&nbsp;<b>legacy status unknown</b></>
                    ) : (
                      <>Tracked IRC chat&nbsp;<b>{compact(hp.chat)}</b>/m</>
                    )}
                  </div>
                  {hasTotalEmotes ? (
                    <div className="row">
                      <span className="sw sw--dash sw--emotes" />
                      Total emotes&nbsp;<b>{compact(emoteCount(hp))}</b>/m
                    </div>
                  ) : null}
                  {shownProviders.map((key) => (
                    <div className="row" key={key}>
                      <span className="sw" style={{ background: providerMeta[key].color }} />
                      {providerMeta[key].label}&nbsp;<b>{compact(providerValue(hp, key))}</b>/m
                    </div>
                  ))}
                  </>
                ) : (
                  <>
                    <div className="row">
                      <span className="sw" style={{ background: 'hsl(var(--sp-chart-viewers))' }} />
                      Viewers&nbsp;<b>—</b>
                    </div>
                    <div className="row">
                      <span className="sw sw--bar sw--chat" />
                      Tracked IRC chat&nbsp;<b>no recorded activity</b>
                    </div>
                    {hasTotalEmotes ? (
                      <div className="row">
                        <span className="sw sw--dash sw--emotes" />
                        Total emotes&nbsp;<b>—</b>
                      </div>
                    ) : null}
                  </>
                )}
                </div>
                <div
                  className={`tip-emotes${hp?.topEmotes && hp.topEmotes.length > 0 ? '' : ' tip-emotes--empty'}`}
                >
                  {hp?.topEmotes && hp.topEmotes.length > 0 ? (
                    <>
                      <span className="tip-emotes__label">Top emotes this bucket</span>
                      <ol className="tip-emotes__list">
                        {hp.topEmotes.slice(0, 3).map((emote, i) => {
                          const img = preferResolvableEmoteUrl(
                            emote.imageUrl,
                            emoteImages?.get(emote.name.toLowerCase()),
                          )
                          return (
                            <li key={`${emote.name}-${i}`}>
                              <span className="tip-emotes__name">
                                {img ? (
                                  <img
                                    className="tip-emotes__img"
                                    src={img}
                                    alt=""
                                    loading="lazy"
                                    decoding="async"
                                  />
                                ) : (
                                  <span
                                    className="tip-emotes__dot"
                                    style={{ background: getProviderColor(emote.provider) }}
                                    aria-hidden="true"
                                  />
                                )}
                                {emote.name}
                              </span>
                              <b>{compact(emote.count)}</b>
                            </li>
                          )
                        })}
                      </ol>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
          </div>
        </div>
        <div className="hx-chart-status" data-hub-chart-status role="status">
          {sampleNote ? <span className="hx-chart-status__note">{sampleNote}</span> : null}
          {!sampleNote && internalGaps > 0 ? (
            <span className="hx-chart-status__note">Data gap — no measurements recorded for this period</span>
          ) : null}
          {!sampleNote && chatGapBands.some((b) => b.attested) && internalGaps === 0 ? (
            <span className="hx-chart-status__note">No IRC chat rollups in this stretch</span>
          ) : null}
          {!sampleNote && (missingBuckets > 0 || internalGaps > 0) ? (
            <span className="hx-chart-status__note">
              {measuredChartPointCount}/{expectedBuckets ?? chartPoints.length} buckets · {formatIncompleteCoveragePercent(
                measuredChartPointCount,
                expectedBuckets ?? chartPoints.length,
              )} coverage
            </span>
          ) : null}
        </div>
        <div className="hx-plot-stack__row hx-plot-stack__row--full">
          <div className="hx-plot-stack__plot">
            <div className="hx-axis" aria-hidden="true">
              {ticks.map((label, i) => (
                <span key={i}>{label}</span>
              ))}
            </div>
          </div>
        </div>
        {availableProviders.length > 0 && !showProviderOverlay ? (
          shownProviders.length > 0 ? (
            <div className="hx-provider-lanes" role="group" aria-label="Emote provider sparklines">
              {shownProviders.map((key) => {
                const meta = providerMeta[key]
                return (
                  <div
                    key={key}
                    className="hx-provider-lane"
                    role="img"
                    aria-label={`${meta.label} emote uses per minute over the last ${windowLabel(windowMinutes)}`}
                  >
                    <div className="hx-provider-lane__plot" aria-hidden="true">
                      <span className="hx-provider-lane__label">
                        <span
                          className="hx-provider-lane__dot"
                          style={{ background: meta.color }}
                        />
                        {meta.shortLabel}
                      </span>
                      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                        {providerLaneLines[key].map((line, i) => (
                          <g key={i}>
                            <path
                              className="hx-provider-lane__area"
                              d={areaPathFromLine(line)}
                              fill={meta.color}
                            />
                            <path
                              className="hx-provider-lane__line-underlay"
                              d={line}
                              fill="none"
                              vectorEffect="non-scaling-stroke"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                            <path
                              className="hx-provider-lane__line"
                              d={line}
                              fill="none"
                              stroke={meta.color}
                              strokeDasharray={meta.dash}
                              vectorEffect="non-scaling-stroke"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </g>
                        ))}
                      </svg>
                      {hover != null || selectedIndex >= 0 ? (
                        <span
                          className="hx-provider-lane__cross"
                          style={{
                            left: `${hover != null ? hx : (model.xs[selectedIndex] ?? 0)}%`,
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="hx-provider-lanes-hidden" role="status">
              Provider lanes hidden
            </p>
          )
        ) : null}
      </div>
      <p className="hx-chart-footnote muted">
        {footnote ?? 'Viewers, tracked IRC chat, and total emotes use separate scales.'}
      </p>
    </>
  )
}
