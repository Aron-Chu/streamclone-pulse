/**
 * Session chart toolbar (d3-v2 session-original .cb-tool, 2026-10-15): the
 * series seg, the range seg, Expand and Show on chart in one row above the
 * plot, wrapping on narrow parts (Show on chart keeps the row's end). The
 * readout is its own text line above Games played.
 *
 * The readout subscribes to the chart's hover store, so a hover commits only
 * that line. Every value it shows is a measured value or the chart core's bar
 * average; nothing is scored here.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { minuteEmoteTotal, viewerReadoutValue } from '@streampulse/pulse-charts'
import { topEmotesFromRollup } from '@streampulse/pulse-core'
import type { SpBar, SpHit, SpHoverStore, SpViewportStore } from '@streampulse/pulse-charts/spchart'
import type { AnalyticsMinuteRollup, AnalyticsTopEmote } from '../../api.ts'
import { getEmoteImageUrl } from '../../utils/consoleFormat.ts'
import { ConsoleEmoteImg } from './ConsoleEmoteImg.tsx'
import type { AnalyticsViewMode } from './AnalyticsChart.tsx'
import {
  fullInt,
  hms,
  presetPressed,
  presetRange,
  sessionRangePresets,
  type SessionChartModel,
} from './sessionSpChartModel.ts'

// ---- phone media query (the mock's matchMedia('(max-width:719px)')) ----

const PHONE_QUERY = '(max-width: 719px)'

function subscribePhone(cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(PHONE_QUERY)
  mq.addEventListener?.('change', cb)
  return () => mq.removeEventListener?.('change', cb)
}

function readPhone(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches
}

export function useSessionPhone(): boolean {
  return useSyncExternalStore(subscribePhone, readPhone, () => false)
}

// ---- series seg ----

export type SessionSeriesKey = 'all' | 'viewers' | 'chat' | 'emotes'

/** The seg's pressed button for a console view mode (Spikes and series focus are gone: All). */
export function sessionSeriesKey(viewMode: AnalyticsViewMode): SessionSeriesKey {
  return viewMode === 'viewers' || viewMode === 'chat' || viewMode === 'emotes' ? viewMode : 'all'
}

/** Series the chart draws for a seg key (session.js setSeries). */
export function sessionSeriesVisibility(key: SessionSeriesKey, overlayOn: boolean) {
  const all = key === 'all'
  return {
    chat: all || key === 'chat',
    emotes: all || key === 'emotes',
    viewers: all || key === 'viewers',
    overlay: overlayOn && key !== 'viewers',
  }
}

const SERIES: readonly { key: SessionSeriesKey; label: string; unit?: string; swatch?: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'viewers', label: 'Viewers', swatch: 'viewers' },
  { key: 'chat', label: 'Chat', unit: '/min', swatch: 'chat' },
  { key: 'emotes', label: 'Emotes', unit: '/min', swatch: 'emotes' },
]

export function SessionSeriesSeg({
  viewMode,
  onViewModeChange,
}: {
  viewMode: AnalyticsViewMode
  onViewModeChange: (mode: AnalyticsViewMode) => void
}) {
  const pressed = sessionSeriesKey(viewMode)
  return (
    <div className="ssc-seg" role="group" aria-label="Series" data-session-series-seg="">
      {SERIES.map(item => (
        <button
          key={item.key}
          type="button"
          aria-pressed={pressed === item.key}
          data-series={item.key}
          onClick={() => onViewModeChange(item.key === 'all' ? 'overview' : item.key)}
        >
          {item.swatch ? <i className={`ssc-sw ssc-sw-${item.swatch}`} aria-hidden="true" /> : null}
          {item.label}
          {/* session-original: the lane captions carry the unit, so it is
              visually hidden here and still read */}
          {item.unit ? <span className="sr-only">{item.unit}</span> : null}
        </button>
      ))}
    </div>
  )
}

// ---- readout ----

/**
 * The readout's figures (session-original `count` / `rcount`): "22.4K",
 * "1.3M", "173"; a missing value reads "—".
 */
export function readoutCount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value >= 1e6) return (value / 1e6).toFixed(1) + 'M'
  if (value >= 1e3) return (value / 1e3).toFixed(1) + 'K'
  return Math.round(value).toLocaleString('en-US')
}

interface LineValues { viewers: number | null; chat: number | null; emotes: number | null }

/** "viewers 22.4K · chat 173/min · emotes 151/min" (session-original `vals`). */
export function readoutValues(values: LineValues): string {
  return `viewers ${readoutCount(values.viewers)} · chat ${readoutCount(values.chat)}/min · emotes ${readoutCount(values.emotes)}/min`
}

const finite = (v: number | null | undefined): number | null => (v != null && Number.isFinite(v) ? v : null)

export function rollupLineValues(rollup: AnalyticsMinuteRollup | null | undefined): LineValues {
  if (!rollup) return { viewers: null, chat: null, emotes: null }
  return { viewers: finite(viewerReadoutValue(rollup)), chat: finite(rollup.chatCount), emotes: finite(minuteEmoteTotal(rollup)) }
}

export interface ReadoutToken { key: string; name: string; count: number; src?: string }

/** Emote hits of the measured minutes in [from, to): summed counts, top three. */
export function groupEmoteTokens(
  model: SessionChartModel,
  fromIndex: number,
  toIndex: number,
  catalog: AnalyticsTopEmote[] | undefined,
): ReadoutToken[] {
  const sums: Record<string, number> = {}
  let first: AnalyticsMinuteRollup | null = null
  for (let i = Math.max(0, fromIndex); i < Math.min(model.n, toIndex); i += 1) {
    const row = model.rows[i]
    if (!row?.emotes) continue
    first ??= row
    for (const [key, value] of Object.entries(row.emotes)) sums[key] = (sums[key] ?? 0) + (Number(value) || 0)
  }
  if (!first) return []
  return topEmotesFromRollup({ minuteTs: first.minuteTs, emotes: sums }, 3, catalog).map(hit => ({
    key: hit.key,
    name: hit.name,
    count: hit.count,
    src: getEmoteImageUrl({ provider: hit.provider, image_url: hit.image_url, key: hit.key }),
  }))
}

export interface SessionReadoutSelection {
  /** A pinned strip moment. */
  moment: { offsetSeconds: number; rollup: AnalyticsMinuteRollup | null; tokens: ReadoutToken[] } | null
  /** Any other pinned minute. */
  pinned: { offsetSeconds: number; rollup: AnalyticsMinuteRollup } | null
  /** F23: the locked bar; above 1-minute bars it reads "Pinned bar …" ahead of the moment. */
  bar?: { bar: SpBar; levelMinutes: number } | null
}

/** "0:40:00–0:50:00 · 10-min avg · viewers … · chat …/min · emotes …/min[ · 7 of 10 min measured]" */
function barReadoutText(bar: SpBar, levelMinutes: number, offsetOf: (ms: number) => number): string {
  const values = { viewers: finite(bar.viewers), chat: bar.observed ? finite(bar.chat) : null, emotes: finite(bar.emotes) }
  const measured = bar.partial ? ` · ${bar.observed} of ${bar.expected} min measured` : ''
  return `${hms(offsetOf(bar.startMs))}–${hms(offsetOf(bar.endMs))} · ${levelMinutes}-min avg · ${readoutValues(values)}${measured}`
}

/**
 * The readout line as text (d3-v2 session-original `readout()`, 2026-10-14/15),
 * in order:
 * - the hovered bar above 1-minute bars: "0:40:00–0:50:00 · 10-min avg · …";
 * - the hovered minute: "7:07:54 · viewers … · chat …/min · emotes …/min";
 * - the locked bar above 1-minute bars: "Pinned bar 0:40:00–0:50:00 · …";
 * - the pinned moment or minute: "Pinned 7:07:54 · …";
 * - else the latest minute: "Latest · 11:13:54 · …".
 * `tip` is true when the line should end in "· click for details".
 */
export function sessionReadoutText(
  hit: SpHit | null,
  model: SessionChartModel,
  resting: AnalyticsMinuteRollup | null,
  selection: SessionReadoutSelection,
): { text: string; tip: boolean } {
  const offsetOf = (ms: number) => (ms - model.originMs) / 1000
  const lockedBar = selection.bar && selection.bar.levelMinutes > 1 ? selection.bar : null
  const pinned = selection.moment != null || selection.pinned != null || lockedBar != null
  if (hit && hit.index < model.firstMeasured && model.untrackedLeadSeconds) {
    const s = Math.round(model.untrackedLeadSeconds)
    return { text: `First ${Math.floor(s / 60)}m ${s % 60}s weren't tracked`, tip: false }
  }
  if (hit) {
    const tip = hit.source === 'pointer' && !pinned
    const bar = !hit.fine && hit.bar && hit.levelMinutes > 1 ? hit.bar : null
    if (bar) return { text: barReadoutText(bar, hit.levelMinutes, offsetOf), tip }
    const values = hit.sample.coverage === 2
      ? { viewers: null, chat: null, emotes: null }
      : { viewers: finite(hit.sample.viewers), chat: finite(hit.sample.chat), emotes: finite(hit.sample.emotes) }
    return { text: `${hms(offsetOf(hit.ms))} · ${readoutValues(values)}`, tip }
  }
  if (lockedBar) return { text: `Pinned bar ${barReadoutText(lockedBar.bar, lockedBar.levelMinutes, offsetOf)}`, tip: false }
  if (selection.moment) {
    const m = selection.moment
    return { text: `Pinned ${hms(m.offsetSeconds)}${m.rollup ? ' · ' + readoutValues(rollupLineValues(m.rollup)) : ''}`, tip: false }
  }
  if (selection.pinned) {
    return { text: `Pinned ${hms(selection.pinned.offsetSeconds)} · ${readoutValues(rollupLineValues(selection.pinned.rollup))}`, tip: false }
  }
  if (resting) {
    // "Latest", live or not (session-original): the newest measured minute.
    return { text: `Latest · ${hms(offsetOf(Date.parse(resting.minuteTs)))} · ${readoutValues(rollupLineValues(resting))}`, tip: false }
  }
  return { text: '', tip: false }
}

export function SessionReadout({
  hover,
  model,
  resting,
  selection,
}: {
  hover: SpHoverStore
  model: SessionChartModel
  /** Kept for callers; the resting line says "Latest" either way. */
  isLive?: boolean
  resting: AnalyticsMinuteRollup | null
  selection: SessionReadoutSelection
  /** Kept for callers; the line names no emotes (session-original). */
  topEmotesCatalog?: AnalyticsTopEmote[]
}) {
  const hit = useSyncExternalStore(hover.subscribe, hover.get, hover.get)
  const { text, tip } = sessionReadoutText(hit, model, resting, selection)
  return (
    <p
      className="ssc-ro"
      data-session-readout=""
      data-chart-selection-hint=""
      title="Values at the hovered minute on the chart"
      aria-live="polite"
      aria-atomic="true"
    >
      {text}
      {tip ? <span className="ssc-ro-tip" aria-hidden="true" data-session-readout-tip=""> · click for details</span> : null}
    </p>
  )
}

// ---- range seg ----

export function SessionRangeSeg({
  store,
  model,
  phone,
}: {
  store: SpViewportStore
  model: SessionChartModel
  phone: boolean
}) {
  const target = useSyncExternalStore(store.subscribeTarget, store.getTarget, store.getTarget)
  const streamSeconds = ((model.n - 1) * model.data.stepMs) / 1000
  const presets = sessionRangePresets(streamSeconds, phone)
  return (
    <div className="ssc-seg" role="group" aria-label="Range" data-session-range-seg="">
      {presets.map(p => (
        <button
          key={p.label}
          type="button"
          aria-pressed={presetPressed(p, target, model.n, model.data.stepMs)}
          onClick={() => store.setTarget(presetRange(model.n, model.data.stepMs, p.seconds), { animate: true })}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

// ---- expand ----

export function SessionExpandButton({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    // session-original #expand: the word only, no icon
    <button type="button" className="ssc-qb" aria-pressed={expanded} data-session-expand="" onClick={onToggle}>
      Expand
    </button>
  )
}

// ---- overlay control ----

export function SessionOverlayControl({
  topEmotes,
  overlayKey,
  onToggle,
  onChoose,
}: {
  topEmotes: AnalyticsTopEmote[]
  /** The emote drawn as the teal line, or null when the overlay is off. */
  overlayKey: string | null
  onToggle: () => void
  onChoose: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const editRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const items = topEmotes.slice(0, 6)
  const close = useCallback((focus: boolean) => {
    setOpen(false)
    if (focus) editRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }
    const onDown = (event: PointerEvent) => {
      const t = event.target as Node | null
      if (t && (menuRef.current?.contains(t) || editRef.current?.contains(t))) return
      close(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [close, open])

  useLayoutEffect(() => {
    if (!open) return
    const menu = menuRef.current
    const first = menu?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu?.querySelector<HTMLElement>('button')
    first?.focus()
  }, [open])

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const buttons = [...(menuRef.current?.querySelectorAll<HTMLElement>('button') ?? [])]
    const at = buttons.indexOf(document.activeElement as HTMLElement)
    const next = buttons[(at + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]
    next?.focus()
  }

  const on = overlayKey != null
  return (
    <span className="ssc-ovl">
      <button type="button" className="ssc-qb" aria-pressed={on} data-session-overlay-toggle="" onClick={onToggle}>
        <span className="ssc-ln" aria-hidden="true" />
        <span>Emotes on chart · {on ? 1 : 0}</span>
      </button>
      {items.length ? (
        <button
          ref={editRef}
          type="button"
          className="ssc-qb"
          aria-haspopup="menu"
          aria-expanded={open}
          data-session-overlay-edit=""
          onClick={() => (open ? close(false) : setOpen(true))}
        >
          Edit
        </button>
      ) : null}
      {open ? (
        <div ref={menuRef} className="ssc-pop" role="menu" aria-label="Emote on chart" data-chart-wheel-exempt="" onKeyDown={onMenuKey}>
          {items.map(emote => {
            const checked = emote.key === overlayKey
            return (
              <button
                key={emote.key}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                className={checked ? 'ssc-act' : undefined}
                onClick={() => {
                  onChoose(emote.key)
                  close(true)
                }}
              >
                <ConsoleEmoteImg src={getEmoteImageUrl(emote)} name={emote.name} width={20} height={20} className="ssc-img" fallbackClassName="ssc-img ssc-img-fb" />
                <span className="ssc-mt">{emote.name}</span>
                <span className="ssc-sub">{fullInt(emote.count)}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </span>
  )
}
