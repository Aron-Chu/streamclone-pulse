import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Activity } from 'lucide-react'
import type { HubActivityPoint } from '../../../lib/publicHub'
import { internalGapCount, maxConnectedGapMs, chartActivityPoints, activityAxisTickIndices, formatActivityAxisTick, resolveChartBucketSelection } from '../../../lib/hubActivitySummary'
import { useAnalyticsMotion } from '../../motion/useAnalyticsMotion'
import { useSmoothedScalar } from '../../motion/useSmoothedScalar'
import { compact, getProviderColor } from '../analytics/hubFormat'
import { EmoteProviderIcon } from '../analytics/EmoteProviderIcon'
import { EmptyState, Skeleton } from './primitives'

export interface HubActivityRangeOption {
  key: string
  label: string
}

export interface HubActivityRangeControl {
  active: string
  options: HubActivityRangeOption[]
  onSelect: (key: string) => void
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
  loading?: boolean
  footnote?: string
  /** Optional time-window selector rendered above the chart (24h/7d/1mo/…). */
  rangeControl?: HubActivityRangeControl
  /** Unix ms for the selected activity bucket (network moments filtering). */
  selectedBucketT?: number | null
  /** When set, chart clicks toggle bucket selection for Pulse Moments Live. */
  onBucketSelect?: (bucketT: number | null) => void
  /** Hover preview for bucket inspector rail. */
  onBucketHover?: (bucketT: number | null) => void
  /** When true, draw provider overlay lines on the main chart (power-user mode). */
  showProviderOverlay?: boolean
  /** Lowercase emote name → image URL, used to render bucket emote thumbnails in the tooltip. */
  emoteImages?: Map<string, string>
}

type ProviderKey = 'sevenTv' | 'twitch' | 'bttv' | 'ffz'

interface Pt {
  x: number
  y: number
}

const PROVIDER_KEYS: ProviderKey[] = ['sevenTv', 'twitch', 'bttv', 'ffz']

const PROVIDER_LABELS: Record<ProviderKey, string> = {
  sevenTv: '7TV',
  twitch: 'Twitch',
  bttv: 'BTTV',
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
  return Math.max(point.emotes ?? 0, point.seventv ?? 0, point.twitch ?? 0, point.bttv ?? 0, point.ffz ?? 0)
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
    point.chat > 0 ||
    point.seventv > 0 ||
    emoteCount(point) > 0 ||
    point.viewers > 0
  )
}

function buildLine(pts: Pt[]): string {
  if (pts.length < 2) return ''
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const minX = Math.min(p1.x, p2.x)
    const maxX = Math.max(p1.x, p2.x)
    const c1x = Math.max(minX, Math.min(maxX, p1.x + (p2.x - p0.x) / 6))
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = Math.max(minX, Math.min(maxX, p2.x - (p3.x - p1.x) / 6))
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return d
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
  if (pts.length < 2) return []
  const maxGap = maxConnectedGapMs(windowMinutes)
  const segments: Pt[][] = []
  let current: Pt[] = []
  const flush = () => {
    if (current.length >= 2) segments.push(current)
    current = []
  }
  for (let i = 0; i < pts.length; i += 1) {
    const isSample = hasSample
      ? hasSample[i]
      : !sampleValues || (sampleValues[i] ?? 0) > 0
    if (!isSample) {
      flush()
      continue
    }
    if (current.length > 0) {
      const prevT = source[i - 1]?.t ?? 0
      const nextT = source[i]?.t ?? prevT
      if (nextT - prevT > maxGap) flush()
    }
    current.push(pts[i])
  }
  flush()
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
  coveragePct = 100,
  loading,
  footnote,
  rangeControl,
  selectedBucketT = null,
  onBucketSelect,
  onBucketHover,
  showProviderOverlay = false,
  emoteImages,
}: HubActivityChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const hoverIndexRef = useRef<number | null>(null)
  const hoverRafRef = useRef<number | null>(null)
  const lastBucketTRef = useRef<number | null | undefined>(undefined)
  const [enabledProviders, setEnabledProviders] = useState<Set<ProviderKey> | null>(null)

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
        ? `${poolSize ?? channelCount} channels in live pool`
        : 'tracked streams'
    const base = `Corpus-wide viewers and tracked IRC chat over the last ${windowLabel(windowMinutes)} (${poolLabel})`
    return bucketSelectEnabled
      ? `${base}. Click a bucket to filter Pulse Moments Live.`
      : base
  }, [poolSize, channelCount, windowMinutes, bucketSelectEnabled])

  const providerMeta = useMemo(
    () =>
      PROVIDER_KEYS.reduce(
        (acc, key) => {
          acc[key] = {
            label: PROVIDER_LABELS[key],
            color: getProviderColor(PROVIDER_COLOR_KEYS[key]),
            dash: PROVIDER_DASH[key],
          }
          return acc
        },
        {} as Record<ProviderKey, { label: string; color: string; dash?: string }>,
      ),
    [],
  )

  const chartPoints = useMemo(
    () => chartActivityPoints(points, windowMinutes, undefined, livePoolViewerSum),
    [points, windowMinutes, livePoolViewerSum],
  )

  const model = useMemo(() => {
    const n = chartPoints.length
    const viewerMax = chartPoints.reduce((acc, p) => Math.max(acc, p.viewers), 0) || 1
    const chatMax = chartPoints.reduce((acc, p) => Math.max(acc, p.chat), 0) || 1
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
    const windowMs = Math.max(1, (windowMinutes || 30) * 60_000)
    const startT = lastT - windowMs
    const xAtIndex = (i: number): number => (n <= 1 ? 50 : (i / (n - 1)) * 100)
    const xs = chartPoints.map((_, i) => xAtIndex(i))
    const atViewerY = (value: number): number => PAD + (1 - value / viewerMax) * (100 - PAD)
    const atChatY = (value: number): number => PAD + (1 - value / chatMax) * (100 - PAD)
    const atEmoteY = (value: number): number => PAD + (1 - value / emoteMax) * (100 - PAD)
    const viewers = chartPoints.map((p, i) => ({ x: xs[i], y: atViewerY(p.viewers) }))
    const chat = chartPoints.map((p, i) => ({ x: xs[i], y: atChatY(p.chat) }))
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

    const slotWidth = n > 0 ? 100 / n : 100
    const barW = Math.max(0.35, Math.min(slotWidth * 0.78, 3.5))
    const bars = chartPoints.map((p, i) => {
      const cx = xs[i]
      const h = (p.chat / chatMax) * (100 - PAD)
      let x = cx - barW / 2
      let w = barW
      if (x < 0) {
        w += x
        x = 0
      }
      if (x + w > 100) w = 100 - x
      return { x, w, y: 100 - h, h, index: i }
    })
    const active = chartPoints.filter(activePoint)
    const firstActive = active[0]
    const firstActiveIndex = firstActive ? chartPoints.findIndex((p) => p.t === firstActive.t) : -1
    const firstActiveX = firstActiveIndex >= 0 ? xAtIndex(firstActiveIndex) : 0
    let lastViewerIdx = -1
    for (let i = chartPoints.length - 1; i >= 0; i -= 1) {
      if (chartPoints[i].viewers > 0) {
        lastViewerIdx = i
        break
      }
    }
    const sampleNote =
      firstActive && Math.max(0, Math.round((firstActive.t - startT) / 60_000)) > Math.max(15, windowMinutes * 0.2)
        ? `No live samples before ${axisLabel(Math.max(0, Math.round((lastT - firstActive.t) / 60_000)))}`
        : ''

    return {
      n,
      chatMax,
      xs,
      lastT,
      viewers,
      chat,
      viewerLines: splitLinePaths(
        viewers,
        chartPoints,
        windowMinutes,
        undefined,
        chartPoints.map((p) => p.hasViewerRollup || p.viewers > 0),
      ),
      providerLines,
      providerLaneLines,
      internalGapBands,
      bars,
      firstActiveX,
      lastViewerIdx,
      sampleNote,
      internalGaps: internalGapCount(chartPoints, windowMinutes),
      peakViewers: chartPoints.reduce((a, p) => Math.max(a, p.viewers), 0),
      peakChat: chartPoints.reduce((a, p) => Math.max(a, p.chat), 0),
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
          if (chartPoints[i].chat >= chartPoints[idx].chat) idx = i
        }
        return formatActivityAxisTick(chartPoints[idx]?.t ?? 0, windowMinutes)
      })(),
    }
  }, [chartPoints, windowMinutes])

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

  const { motionEnabled } = useAnalyticsMotion()

  const crosshairTargets = useMemo(() => {
    if (hover == null) {
      return { hx: 0, hy: 0, hasViewer: false }
    }
    const hp = chartPoints[hover]
    return {
      hx: model.chat[hover]?.x ?? 0,
      hy: hp && hp.viewers > 0 ? (model.viewers[hover]?.y ?? 0) : 0,
      hasViewer: Boolean(hp && hp.viewers > 0),
    }
  }, [hover, chartPoints, model.chat, model.viewers])

  const crosshairEnabled = hover != null && motionEnabled
  const smoothHx = useSmoothedScalar(crosshairTargets.hx, crosshairEnabled)
  const smoothHy = useSmoothedScalar(
    crosshairTargets.hy,
    crosshairEnabled && crosshairTargets.hasViewer,
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

  const rangeTabs = rangeControl ? (
    <div className="hx-range-tabs hx-range-tabs--window" role="group" aria-label="Activity time window">
      {rangeControl.options.map((option) => {
        const active = option.key === rangeControl.active
        return (
          <button
            key={option.key}
            type="button"
            className={active ? 'is-active' : undefined}
            aria-pressed={active}
            onClick={() => rangeControl.onSelect(option.key)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  ) : null

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
          Waiting for live activity — the chart draws once channels start sending chat and emotes.
        </EmptyState>
      </>
    )
  }

  const {
    chatMax,
    xs,
    lastT,
    viewers,
    chat,
    viewerLines,
    providerLines,
    providerLaneLines,
    internalGapBands,
    bars,
    firstActiveX,
    lastViewerIdx,
    sampleNote,
    internalGaps,
    peakViewers,
    peakChat,
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
    const best = nearestPointIndex(event.clientX)
    const point = chartPoints[best]
    const next = resolveChartBucketSelection(point, selectedBucketT)
    if (next === undefined) return
    onBucketSelect(next)
  }

  const selectedIndex =
    selectedBucketT != null ? chartPoints.findIndex((point) => point.t === selectedBucketT) : -1

  const hp = hover != null ? chartPoints[hover] : null
  const hx = crosshairEnabled ? smoothHx : crosshairTargets.hx
  const hy =
    crosshairEnabled && crosshairTargets.hasViewer ? smoothHy : crosshairTargets.hy
  // The tooltip is rendered below the plot (see .tip CSS) so it never covers the
  // graph. Horizontally it tracks the cursor but clamps near the edges so it
  // stays within the chart width.
  const tipShift = hx < 18 ? '0%' : hx > 82 ? '-100%' : '-50%'
  const minutesAgo = hp != null ? Math.max(0, Math.round((lastT - hp.t) / 60_000)) : 0

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
          <div className="hx-chart-header__window" aria-label="Activity time window">
            {rangeTabs}
          </div>
        ) : null}
        <div className="hx-chart-actions" aria-label="Chart series toggles">
          <div className="hx-legend">
            <span>
              <span className="sw" style={{ background: 'hsl(var(--sp-chart-viewers))' }} />
              Viewers
            </span>
            <span>
              <span className="sw sw--bar" style={{ background: 'hsl(var(--sp-chart-chat))' }} />
              Tracked IRC chat / min
            </span>
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
      </div>
      {chartSummary ? (
        <p className="hx-chart-summary muted" role="status">
          {chartSummary}
        </p>
      ) : null}
      <div className="hx-plot-stack">
        <div className="hx-plot-stack__row">
          <span className="hx-plot-stack__gutter" aria-hidden="true" />
          <div className="hx-plot-stack__plot">
            <div className="hx-chart-axis-labels" aria-hidden="true">
              <span className="hx-chart-axis-labels__left">Viewers</span>
              <span className="hx-chart-axis-labels__right">Tracked IRC chat/min</span>
            </div>
          </div>
        </div>
        <div className="hx-plot-stack__row">
          <span className="hx-plot-stack__gutter" aria-hidden="true" />
          <div className="hx-plot-stack__plot">
            <div
              ref={wrapRef}
              className={`hx-chart2${bucketSelectEnabled ? ' hx-chart2--selectable' : ''}`}
              data-hover={hover != null ? 'true' : undefined}
              data-selected={selectedIndex >= 0 ? 'true' : undefined}
              role="img"
              aria-label={chartAriaLabel}
              onMouseMove={handleMove}
              onMouseLeave={handleLeave}
              onClick={bucketSelectEnabled ? handleClick : undefined}
            >
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <g className="grid">
            {[25, 50, 75].map((y) => (
              <line key={y} x1="0" y1={y} x2="100" y2={y} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
          <g className="bars" aria-hidden="true">
            {bars.map((bar) =>
              bar.h > 0.35 ? (
                <rect
                  key={bar.index}
                  data-index={bar.index}
                  className={`hx-chat-bar${hover === bar.index ? ' is-active' : ''}${selectedIndex === bar.index ? ' is-selected' : ''}`}
                  x={bar.x}
                  y={bar.y}
                  width={bar.w}
                  height={bar.h}
                  rx="0.5"
                />
              ) : null,
            )}
          </g>
          {/* Dark underlay stroked behind the viewers line so it reads crisply over
              the chat-volume bars and provider lines regardless of what's behind. */}
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
          {showProviderOverlay
            ? shownProviders.map((key) =>
                providerLines[key].map((line, i) => (
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
                )),
              )
            : null}
        </svg>

        <div className="hx-chart2__layer">
          <span className="ylab ylab--viewers">{compact(peakViewers)} peak viewers</span>
          <span className="ylab ylab--chat">{compact(chatMax)}/m peak chat</span>
          {sampleNote ? (
            <>
              <span className="gap-fill" style={{ width: `${Math.max(0, firstActiveX)}%` }} />
              <span className="gap-note" style={{ left: `${Math.max(12, Math.min(46, firstActiveX / 2))}%` }}>
                {sampleNote}
              </span>
            </>
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
              <span className="gap-note" style={{ left: '18%' }}>
                Data gap — no measurements recorded for this period
              </span>
            </>
          ) : null}
          {!sampleNote && (missingBuckets > 0 || internalGaps > 0) ? (
            <span className="gap-note" style={{ left: '70%' }}>
              {points.length}/{expectedBuckets ?? points.length} buckets · {Math.round(coveragePct)}% coverage
            </span>
          ) : null}

          {hover == null ? (
            lastViewerIdx >= 0 ? (
              <span className="now" style={{ left: `${viewers[lastViewerIdx].x}%`, top: `${viewers[lastViewerIdx].y}%` }}>
                <span className="halo" style={{ background: 'hsl(var(--sp-chart-viewers))' }} />
                <i style={{ background: 'hsl(var(--sp-chart-viewers))' }} />
              </span>
            ) : null
          ) : (
            <>
              <span className="cross hx-crosshair" style={{ left: `${hx}%` }} />
              {hp && hp.viewers > 0 ? (
                <span
                  className="hdot hx-crosshair"
                  style={{ left: `${hx}%`, top: `${hy}%`, background: 'hsl(var(--sp-chart-viewers))' }}
                />
              ) : null}
              <div className="tip" style={{ left: `${hx}%`, transform: `translateX(${tipShift})` }}>
                <div className="t">{axisLabel(minutesAgo)}</div>
                <div className="row">
                  <span className="sw" style={{ background: 'hsl(var(--sp-chart-viewers))' }} />
                  Viewers&nbsp;<b>{compact(hp?.viewers ?? 0)}</b>
                </div>
                <div className="row">
                  <span className="sw sw--bar" style={{ background: 'hsl(var(--sp-chart-chat))' }} />
                  Tracked IRC chat&nbsp;<b>{compact(hp?.chat ?? 0)}</b>/m
                </div>
                {shownProviders.map((key) => (
                  <div className="row" key={key}>
                    <span className="sw" style={{ background: providerMeta[key].color }} />
                    {providerMeta[key].label}&nbsp;<b>{compact(hp ? providerValue(hp, key) : 0)}</b>/m
                  </div>
                ))}
                {hp?.topEmotes && hp.topEmotes.length > 0 ? (
                  <div className="tip-emotes">
                    <span className="tip-emotes__label">Top emotes this bucket</span>
                    <ol className="tip-emotes__list">
                      {hp.topEmotes.slice(0, 3).map((emote, i) => {
                        const img = emoteImages?.get(emote.name.toLowerCase())
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
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
            </div>
          </div>
        </div>
        <div className="hx-plot-stack__row">
          <span className="hx-plot-stack__gutter" aria-hidden="true" />
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
                    <span className="hx-provider-lane__label" aria-hidden="true">
                      <span
                        className="hx-provider-lane__dot"
                        style={{ background: meta.color }}
                      />
                      {meta.label}
                    </span>
                    <div className="hx-provider-lane__plot" aria-hidden="true">
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
        {footnote ?? 'Viewers and tracked IRC chat use separate scales.'}
      </p>
    </>
  )
}
