import type { MomentMinuteSlot, MomentMinuteWindow } from './momentMinuteWindow'

/** A card draws ten minutes either side of its moment: the run-up and what followed. */
export const ACTIVITY_MINUTES_BEFORE = 10
export const ACTIVITY_MINUTES_AFTER = 10
/** A minute at twice the stream's earlier average or more is part of the surge. */
export const ACTIVITY_SURGE_X = 2
/**
 * Emotes are drawn as the line only where most of the card's minutes carry them: a
 * rollup leaves a minute's emotes out when there were none or it did not count them,
 * so a sparse emote line would be mostly gaps.
 */
export const ACTIVITY_EMOTE_COVERAGE = 0.6

/** The drawing's own units: a 16:9 box, as the card's picture. */
export const ACTIVITY_WIDTH = 320
export const ACTIVITY_HEIGHT = 180
const BAR_WIDTH = 6
const STEP = ACTIVITY_WIDTH / (ACTIVITY_MINUTES_BEFORE + ACTIVITY_MINUTES_AFTER)

export type ActivitySeries = 'chat' | 'emotes'

/** Where in the 320 × 180 box the line is drawn: its top and floor, side margin, and tallest bar. */
export interface ActivityFrame { top: number; bottom: number; side: number; barMax: number }
/** No picture: the line fills the frame, edge to edge, under the chips along its top. */
export const ACTIVITY_FRAME_FULL: ActivityFrame = { top: 46, bottom: 168, side: 0, barMax: 50 }
/** Over a picture: the line runs along its bottom third, so the picture stays the picture. */
export const ACTIVITY_FRAME_PHOTO: ActivityFrame = { top: 116, bottom: 175, side: 0, barMax: 28 }

export interface ActivityPoint { relative: number; x: number; y: number }
export interface ActivityBar { relative: number; x: number; y: number; height: number }

export interface ActivityGeometry {
  /** What the line is: chat or emotes per minute. The bars are the other one. */
  series: ActivitySeries
  /** The line, smoothed without overshoot: one subpath per run of measured minutes, so a gap stays a gap. */
  line: string
  /** The same runs closed down to the floor. */
  area: string
  bars: ActivityBar[]
  /** The stream's earlier average for the line's series, when the comparison supplies one. */
  baselineY: number | null
  /** The moment's own minute, when it was measured. */
  moment: ActivityPoint | null
  /**
   * Where the moment sits along the drawn line, 0 to 1. The line draws in across its own
   * extent, which is short of the frame while the minutes after a young moment are still
   * to come, so the dot lands when the line reaches it.
   */
  momentAt: number
  /** The run of minutes up to the moment at the surge level or above, when it lasted 2 minutes or more. */
  surge: { fromX: number; toX: number; minutes: number } | null
  floor: number
  top: number
}

const fixed = (value: number) => Number(value.toFixed(1))
const valueOf = (slot: MomentMinuteSlot, series: ActivitySeries) => series === 'chat' ? slot.chatPerMin : slot.emotesPerMin
const measured = (slot: MomentMinuteSlot | undefined, series: ActivitySeries): slot is MomentMinuteSlot =>
  slot?.state === 'measured' && typeof valueOf(slot, series) === 'number' && Number.isFinite(valueOf(slot, series)!)
const inRange = (window: MomentMinuteWindow) =>
  window.slots.filter(slot => slot.relative >= -ACTIVITY_MINUTES_BEFORE && slot.relative <= ACTIVITY_MINUTES_AFTER)

/**
 * The series a card draws as its line: the one its headline names when the
 * minutes carry it (emotes at the moment's own minute and across most of the
 * range), else chat, which every measured minute has.
 */
export function momentActivitySeries(window: MomentMinuteWindow, preferred?: ActivitySeries | null): ActivitySeries {
  if (preferred !== 'emotes') return 'chat'
  const counted = inRange(window).filter(slot => measured(slot, 'chat'))
  const own = counted.find(slot => slot.relative === 0)
  const withEmotes = counted.filter(slot => (slot.emotesPerMin ?? 0) > 0).length
  return own && (own.emotesPerMin ?? 0) > 0 && withEmotes / counted.length >= ACTIVITY_EMOTE_COVERAGE ? 'emotes' : 'chat'
}

/**
 * A card's activity line from the moment's minute window (the same per-minute
 * rollups the open moment's chart reads). Only measured minutes are drawn: a
 * missing or unrecorded minute breaks the line rather than dropping it to zero, and
 * minutes after the latest one the API returned are simply not there yet. Returns
 * null when no minute in the card's range was measured.
 */
export function momentActivityGeometry(
  window: MomentMinuteWindow,
  baseline: number | null,
  { series = 'chat', frame = ACTIVITY_FRAME_FULL }: { series?: ActivitySeries; frame?: ActivityFrame } = {},
): ActivityGeometry | null {
  const slots = inRange(window)
  const counted = slots.filter(slot => measured(slot, series))
  if (!counted.length) return null
  const { top, bottom, side, barMax } = frame
  const x = (relative: number) => side + (relative + ACTIVITY_MINUTES_BEFORE) * (ACTIVITY_WIDTH - 2 * side) / (ACTIVITY_MINUTES_BEFORE + ACTIVITY_MINUTES_AFTER)
  const usual = baseline != null && Number.isFinite(baseline) && baseline > 0 ? baseline : null
  const peak = Math.max(1, ...counted.map(slot => valueOf(slot, series)!), usual ?? 0) * 1.12
  const y = (value: number) => bottom - value / peak * (bottom - top)
  const runs: ActivityPoint[][] = []
  let run: ActivityPoint[] = []
  for (const slot of slots) {
    if (measured(slot, series)) run.push({ relative: slot.relative, x: fixed(x(slot.relative)), y: fixed(y(valueOf(slot, series)!)) })
    else if (run.length) { runs.push(run); run = [] }
  }
  if (run.length) runs.push(run)
  const line = runs.map(monotonePath).join('')
  const area = runs.map(points => `${monotonePath(points)}L${points.at(-1)!.x},${bottom}L${points[0]!.x},${bottom}Z`).join('')
  // The bars are the other series, where the rollup counted it.
  const other: ActivitySeries = series === 'chat' ? 'emotes' : 'chat'
  const barSlots = slots.filter(slot => measured(slot, other) && valueOf(slot, other)! > 0)
  const barTop = Math.max(0, ...barSlots.map(slot => valueOf(slot, other)!))
  const bars = barTop > 0 ? barSlots.map(slot => {
    const height = fixed(Math.max(2, valueOf(slot, other)! / barTop * barMax))
    return { relative: slot.relative, x: fixed(x(slot.relative) - BAR_WIDTH / 2), y: fixed(bottom - height), height }
  }) : []
  const own = counted.find(slot => slot.relative === 0)
  const surge = own && usual ? surgeBefore(slots, usual, series) : null
  return {
    series,
    line,
    area,
    bars,
    baselineY: usual != null ? fixed(y(usual)) : null,
    moment: own ? { relative: 0, x: fixed(x(0)), y: fixed(y(valueOf(own, series)!)) } : null,
    momentAt: Math.min(1, Math.max(0, (x(0) - runs[0]![0]!.x) / Math.max(1, runs.at(-1)!.at(-1)!.x - runs[0]![0]!.x))),
    surge: surge ? { fromX: fixed(x(surge.from) - STEP / 2), toX: fixed(x(0)), minutes: surge.minutes } : null,
    floor: bottom,
    top,
  }
}

/**
 * A run of points as a smooth path that never overshoots its minutes: a monotone
 * cubic (Fritsch–Butland tangents), so the curve between two minutes stays between
 * their values and a quiet minute beside a spike never dips below what was counted.
 * A lone minute has no length to draw; a hair's width with round caps shows it as a dot.
 */
function monotonePath(points: ActivityPoint[]): string {
  const first = points[0]!
  if (points.length === 1) return `M${first.x},${first.y}h0.01`
  const slopes = points.slice(1).map((point, index) => (point.y - points[index]!.y) / (point.x - points[index]!.x))
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0]!
    if (index === points.length - 1) return slopes[index - 1]!
    const before = slopes[index - 1]!
    const after = slopes[index]!
    return before * after <= 0 ? 0 : 2 * before * after / (before + after)
  })
  let path = `M${first.x},${first.y}`
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!
    const to = points[index + 1]!
    const third = (to.x - from.x) / 3
    path += `C${fixed(from.x + third)},${fixed(from.y + tangents[index]! * third)} ${fixed(to.x - third)},${fixed(to.y - tangents[index + 1]! * third)} ${to.x},${to.y}`
  }
  return path
}

/** The measured minutes up to and including the moment that ran at the surge level, unbroken. */
function surgeBefore(slots: MomentMinuteSlot[], usual: number, series: ActivitySeries): { from: number; minutes: number } | null {
  let from = 1
  for (let relative = 0; relative >= -ACTIVITY_MINUTES_BEFORE; relative -= 1) {
    const slot = slots.find(item => item.relative === relative)
    if (!measured(slot, series) || valueOf(slot, series)! < ACTIVITY_SURGE_X * usual) break
    from = relative
  }
  const minutes = 1 - from
  return minutes >= 2 ? { from, minutes } : null
}

/**
 * A card's headline: the moment's × in the project's one wording, and how long
 * the line ran at its surge level up to it, when the line is the series the ×
 * is about. "2.7× more chat · 4 min surge".
 */
export function momentActivityHeadline(words: string, surgeMinutes?: number | null): string {
  return surgeMinutes != null && surgeMinutes >= 2 ? `${words} · ${surgeMinutes} min surge` : words
}
