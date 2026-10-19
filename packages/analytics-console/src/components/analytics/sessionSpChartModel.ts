/**
 * Session chart adapter: measured minute rollups to SpChart data, once per
 * data change. Values are the backend's; the only arithmetic is display
 * arithmetic (D5: a caption's peak is the busiest measured minute, its avg the
 * mean of measured minutes, as prod's scale row did).
 *
 * The samples run from the stream start (untracked minutes are coverage 2, so
 * they are never drawn as data) to the newest plotted minute. Hatches come only
 * from the backend's availability.missingRanges and coverageStartOffsetSeconds.
 */
import {
  buildChartSeries,
  minuteEmoteTotal,
  rollupHasMinuteData,
  viewerReadoutValue,
} from '@streampulse/pulse-charts'
import { overviewPath, type SpCaption, type SpChartData, type SpOverview, type SpSpanMs } from '@streampulse/pulse-charts/spchart'
import type { AnalyticsMinuteRollup, AnalyticsStreamDetail } from '../../api.ts'

const MINUTE_MS = 60_000
/** At most a day of untracked minutes is drawn before the first measured one. */
const MAX_LEAD_SAMPLES = 24 * 60

export interface SessionChartModel {
  data: SpChartData
  /** The rollup at each sample, or null where nothing was measured. */
  rows: (AnalyticsMinuteRollup | null)[]
  /** Stream start (epoch ms): the session's time origin. */
  originMs: number
  n: number
  /** Index of the first measured sample. */
  firstMeasured: number
  captions: { chat: SpCaption | null; emotes: SpCaption | null; viewers: SpCaption | null }
  /**
   * Emote lane spike threshold (prod's PulseMultiSignalChart rule as session-original
   * EM_SPIKE): 0.55 of the emote axis's fit max, the busiest measured minute plus 5 % of
   * the min-max span over minutes with emotes. One threshold for the whole stream, so a
   * zoom or a finer bar level never relights bars. Null without emotes.
   */
  emoteSpike: number | null
  gaps: SpSpanMs[]
  /** Seconds at the stream start that were not tracked, when the backend says so. */
  untrackedLeadSeconds: number | null
  overview: SpOverview | null
  /** The plotted emotes' per-minute counts (NaN where none), in plot order. */
  overlays: SessionOverlay[]
}

/** One plotted emote: prod's buildChartSeries colour and values (0 is a break). */
export interface SessionOverlay {
  key: string
  color: string
  values: Float64Array
}

const fin = Number.isFinite

function minuteMs(rollup: { minuteTs: string }): number {
  return Date.parse(rollup.minuteTs)
}

/** The smallest spacing between rows, in whole minutes (default one minute). */
function rowStepMs(rows: readonly AnalyticsMinuteRollup[]): number {
  let step = Infinity
  for (let i = 1; i < rows.length; i += 1) {
    const d = minuteMs(rows[i]!) - minuteMs(rows[i - 1]!)
    if (d > 0 && d < step) step = d
  }
  return fin(step) ? Math.max(MINUTE_MS, Math.round(step / MINUTE_MS) * MINUTE_MS) : MINUTE_MS
}

function spikeThreshold(values: ArrayLike<number>, coverage: ArrayLike<number>): number | null {
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]!
    if (coverage[i] === 2 || !fin(v) || v <= 0) continue
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return fin(hi) ? 0.55 * Math.ceil(hi + (hi - lo) * 0.05) : null
}

function caption(values: ArrayLike<number>, coverage: ArrayLike<number>, unit: string): SpCaption | null {
  let peak = -Infinity, sum = 0, count = 0
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]!
    if (coverage[i] === 2 || !fin(v)) continue
    if (v > peak) peak = v
    sum += v
    count += 1
  }
  return count ? { peak, avg: sum / count, unit } : null
}

export function buildSessionChartModel(args: {
  rollups: readonly AnalyticsMinuteRollup[]
  streamStartedAt: string | undefined
  /** Plotted emotes, in plot order (at most MAX_PLOTTED_EMOTES are drawn). */
  overlayKeys?: readonly string[]
  availability?: AnalyticsStreamDetail['availability']
  coverageStartOffsetSeconds?: number
}): SessionChartModel | null {
  const sorted = args.rollups
    .filter(row => fin(minuteMs(row)))
    .slice()
    .sort((a, b) => minuteMs(a) - minuteMs(b))
  // Trailing and leading rows without data are not plotted.
  let a = 0, b = sorted.length
  while (a < b && !rollupHasMinuteData(sorted[a]!)) a += 1
  while (b > a && !rollupHasMinuteData(sorted[b - 1]!)) b -= 1
  const rows = sorted.slice(a, b)
  if (!rows.length) return null
  const stepMs = rowStepMs(rows)
  const firstMs = minuteMs(rows[0]!)
  const lastMs = minuteMs(rows[rows.length - 1]!)
  const streamMs = args.streamStartedAt ? Date.parse(args.streamStartedAt) : NaN
  const lead = fin(streamMs) ? Math.min(MAX_LEAD_SAMPLES, Math.max(0, Math.floor((firstMs - streamMs) / stepMs))) : 0
  const startMs = firstMs - lead * stepMs
  const n = Math.round((lastMs - startMs) / stepMs) + 1
  const originMs = fin(streamMs) ? Math.min(streamMs, startMs) : startMs

  const chat = new Float64Array(n).fill(NaN)
  const emotes = new Float64Array(n).fill(NaN)
  const viewers = new Float64Array(n).fill(NaN)
  const coverage = new Uint8Array(n).fill(2)
  const at: (AnalyticsMinuteRollup | null)[] = new Array(n).fill(null)
  // The bottom lane draws these (SessionSpChart sessionLanes, one trace each);
  // the core's single dashed overlay stays off.
  const overlaySeries = args.overlayKeys?.length
    ? buildChartSeries(rows as AnalyticsMinuteRollup[], new Set(args.overlayKeys)).filter(s => s.dashed)
    : []
  const overlays: SessionOverlay[] = overlaySeries.map(s => ({ key: s.key, color: s.color, values: new Float64Array(n).fill(NaN) }))
  rows.forEach((row, k) => {
    const i = Math.round((minuteMs(row) - startMs) / stepMs)
    if (i < 0 || i >= n || !rollupHasMinuteData(row)) return
    at[i] = row
    coverage[i] = 0
    chat[i] = row.chatCount ?? NaN
    emotes[i] = minuteEmoteTotal(row)
    viewers[i] = viewerReadoutValue(row) ?? NaN
    overlays.forEach((o, j) => {
      o.values[i] = overlaySeries[j]!.values[k] ?? NaN
    })
  })

  const data: SpChartData = { startMs, stepMs, chat, emotes, viewers, coverage, overlay: null }

  const gaps: SpSpanMs[] = []
  const cover = args.coverageStartOffsetSeconds
  if (fin(streamMs) && cover != null && fin(cover) && cover > 0) gaps.push({ startMs: streamMs, endMs: streamMs + cover * 1000 })
  for (const r of args.availability?.missingRanges ?? []) {
    if (fin(streamMs) && fin(r.fromOffsetSeconds) && fin(r.toOffsetSeconds) && r.toOffsetSeconds > r.fromOffsetSeconds) {
      gaps.push({ startMs: streamMs + r.fromOffsetSeconds * 1000, endMs: streamMs + r.toOffsetSeconds * 1000 })
    }
  }
  const leadRange = (args.availability?.missingRanges ?? []).find(r => r.fromOffsetSeconds <= 0 && r.toOffsetSeconds > 0)
  const untrackedLeadSeconds = leadRange ? leadRange.toOffsetSeconds : cover != null && cover > 0 ? cover : null

  return {
    data,
    rows: at,
    originMs,
    n,
    firstMeasured: lead,
    captions: {
      chat: caption(chat, coverage, 'chat/min'),
      emotes: caption(emotes, coverage, 'emotes/min'),
      viewers: caption(viewers, coverage, 'viewers'),
    },
    emoteSpike: spikeThreshold(emotes, coverage),
    gaps,
    untrackedLeadSeconds,
    overview: overviewPath(chat, 1000, { coverage }),
    overlays,
  }
}

/** D5: the rates caption names the series that sets the panel's scale. */
export function ratesCaption(
  model: SessionChartModel,
  series: { chat: boolean; emotes: boolean },
): SpCaption | null {
  const c = series.chat ? model.captions.chat : null
  const e = series.emotes ? model.captions.emotes : null
  if (c && e) return (e.peak ?? 0) >= (c.peak ?? 0) ? e : c
  return e ?? c
}

// ---- display formats (the d3 design's session.js / shared.js) ----

const integer = new Intl.NumberFormat('en-US')
const pad2 = (v: number) => String(v).padStart(2, '0')

/** Full integer with grouping, or an em dash. */
export function fullInt(value: number | null | undefined): string {
  return value == null || !fin(value) ? '—' : integer.format(Math.round(value))
}

/** Unpadded h:mm:ss. */
export function hms(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return Math.floor(s / 3600) + ':' + pad2(Math.floor((s % 3600) / 60)) + ':' + pad2(s % 60)
}

/** Local clock "2:27 PM". */
export function clockLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** "45 min", "2h 5m" or "3 h". */
export function spanLabel(ms: number): string {
  const m = Math.round(ms / MINUTE_MS)
  if (m < 60) return m + ' min'
  const h = Math.floor(m / 60), r = m % 60
  return r ? h + 'h ' + r + 'm' : h + ' h'
}

export interface SessionRangePreset { label: string; seconds: number }

const PRESETS: readonly SessionRangePreset[] = [
  { label: '15m', seconds: 900 },
  { label: '1h', seconds: 3600 },
  { label: '2h', seconds: 7200 },
  { label: '4h', seconds: 14_400 },
]

/** The range seg: presets shorter than the stream, then Full (phones: 1h, 4h, Full). */
export function sessionRangePresets(streamSeconds: number, phone: boolean): SessionRangePreset[] {
  return [
    ...PRESETS.filter(p => p.seconds < streamSeconds && (!phone || p.label === '1h' || p.label === '4h')),
    { label: 'Full', seconds: 0 },
  ]
}

/** Samples a preset shows, end-anchored (session.js: showSpan(end - s, end)). */
export function presetRange(n: number, stepMs: number, seconds: number): { startIndex: number; endIndex: number } {
  if (!seconds) return { startIndex: 0, endIndex: n - 1 }
  const span = Math.max(1, Math.round((seconds * 1000) / stepMs))
  return { startIndex: Math.max(0, n - 1 - span), endIndex: n - 1 }
}

/** Whether a preset is the view (session.js syncPreset: within 2% and ending at the end). */
export function presetPressed(
  preset: SessionRangePreset,
  view: { startIndex: number; endIndex: number },
  n: number,
  stepMs: number,
): boolean {
  const full = view.startIndex <= 0 && view.endIndex >= n - 1
  if (!preset.seconds) return full
  const spanS = ((view.endIndex - view.startIndex) * stepMs) / 1000
  return !full && Math.abs(spanS - preset.seconds) < preset.seconds * 0.02 && ((n - 1 - view.endIndex) * stepMs) / 1000 < 30
}
