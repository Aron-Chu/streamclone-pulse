import { useEffect, useId, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { DiscoveryMoment } from '../../../lib/discoveryMoments'
import type { LiveWireMomentComparison } from '../../../lib/liveWire'
import {
  loadMomentMinuteWindow,
  MOMENT_MINUTES_AFTER,
  MOMENT_MINUTES_BEFORE,
  peekMomentMinuteWindow,
  type MomentMinuteSlot,
  type MomentMinuteWindow,
} from '../../../lib/momentMinuteWindow'

const W = 800
const H = 120
const GAP = 3
const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 })
const times = (value: number) => `${value.toFixed(value >= 10 ? 0 : 1)}×`
const measured = (value?: number): value is number => value != null && Number.isFinite(value) && value >= 0

/**
 * The same earlier average "How unusual was this reaction?" draws against:
 * the server's chat baseline for this stream, only when it marked the
 * comparison usable. Nothing here computes a baseline of its own.
 */
export function momentChatBaseline(comparison?: LiveWireMomentComparison): { baseline: number; multiplier: number | null } | null {
  const chat = comparison?.chat
  if (!chat || !['ready', 'new_activity'].includes(chat.state) || !measured(chat.baselinePerMin) || chat.baselinePerMin <= 0) return null
  const multiplier = measured(chat.multiplier) ? chat.multiplier
    : measured(chat.currentPerMin) ? chat.currentPerMin / chat.baselinePerMin : null
  return { baseline: chat.baselinePerMin, multiplier }
}

function minuteName(relative: number): string {
  return relative === 0 ? 'This minute' : relative < 0 ? `${-relative} min before` : `${relative} min after`
}

function slotText(slot: MomentMinuteSlot): string {
  if (slot.state === 'measured') return `${minuteName(slot.relative)} · ${number(slot.chatPerMin!)} chat / min`
  return `${minuteName(slot.relative)} · ${slot.state === 'unrecorded' ? 'no chat recorded' : slot.state === 'unmeasured' ? 'not measured' : 'no data'}`
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

type ChartState = { key: string; status: 'loading' | 'ready' | 'unavailable' | 'error'; window?: MomentMinuteWindow | null }

/**
 * "Chat per minute around this moment": measured minute rollups from 30 minutes
 * before to 10 minutes after, read lazily for the open moment only. While the read
 * is in flight it shows a quiet placeholder. A read that answered with no measured
 * minute says so in one line and draws nothing; a read that failed says it could
 * not be loaded, which is not a fact about the broadcast, and offers a retry.
 */
export function MomentMinuteChart({ moment }: { moment: Pick<DiscoveryMoment, 'key' | 'login' | 'streamId' | 'offsetSeconds' | 'at' | 'comparison'> }) {
  const key = moment.key
  const [state, setState] = useState<ChartState>(() => {
    const cached = peekMomentMinuteWindow(moment)
    return cached ? { key, status: cached.value ? 'ready' : 'unavailable', window: cached.value } : { key, status: 'loading' }
  })
  const [hovered, setHovered] = useState<number | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [reduced] = useState(prefersReducedMotion)
  const titleId = useId()
  useEffect(() => {
    const cached = peekMomentMinuteWindow(moment)
    if (cached) {
      setState({ key, status: cached.value ? 'ready' : 'unavailable', window: cached.value })
      return
    }
    const controller = new AbortController()
    setState({ key, status: 'loading' })
    void loadMomentMinuteWindow(moment, controller.signal)
      .then(result => { if (!controller.signal.aborted) setState({ key, status: result ? 'ready' : 'unavailable', window: result }) })
      // A timeout, 5xx or dropped connection: the read failed, the minutes may well exist.
      .catch(() => { if (!controller.signal.aborted) setState({ key, status: 'error' }) })
    return () => controller.abort()
    // The exact detection identity is the read's whole input; a retry reads it again.
    // `at` only places the window within that read, and the next open places it anew.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, moment.streamId, moment.offsetSeconds, attempt])
  const current = state.key === key ? state : { key, status: 'loading' as const }
  const title = <strong id={titleId}>Chat per minute around this moment</strong>
  if (current.status === 'error') {
    return <p className="moments-muted moment-minutes-note" data-state="error" role="status">Chat per minute couldn&rsquo;t be loaded. <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry chat per minute</button></p>
  }
  if (current.status === 'unavailable' || (current.status === 'ready' && !current.window)) {
    return <p className="moments-muted moment-minutes-note" data-state="unavailable">Chat per minute isn&rsquo;t available for this part of the broadcast.</p>
  }
  if (current.status === 'loading') {
    return <figure className="moment-minutes" data-state="loading" aria-busy="true" aria-labelledby={titleId}>
      <figcaption>{title}</figcaption>
      <div className="moment-minutes__plot moment-minutes__plot--loading" aria-hidden="true"><span /></div>
      <span className="sr-only">Loading chat per minute.</span>
    </figure>
  }
  const { slots, measuredMinutes, unrecordedMinutes } = current.window!
  const reference = momentChatBaseline(moment.comparison)
  const values = slots.map(slot => slot.chatPerMin ?? 0)
  const max = Math.max(1, ...values, reference?.baseline ?? 0) * 1.1
  const n = slots.length
  const barWidth = (W - GAP * (n - 1)) / n
  const momentSlot = slots[MOMENT_MINUTES_BEFORE]!
  const peak = slots.reduce<MomentMinuteSlot | null>((best, slot) => slot.state === 'measured' && (!best || slot.chatPerMin! > best.chatPerMin!) ? slot : best, null)
  const rest = reference?.multiplier != null ? `${times(reference.multiplier)} the earlier average` : ''
  const label = hovered != null ? slotText(slots[hovered]!) : rest
  // Minutes before the broadcast started, or past the latest one returned, are not
  // gaps in the data: the count leaves them out and names them instead.
  const inside = slots.filter(slot => slot.state !== 'outside').length
  const before = slots.findIndex(slot => slot.state !== 'outside')
  let after = 0
  while (after < n && slots[n - 1 - after]!.state === 'outside') after += 1
  const summary = [
    `Chat per minute from ${MOMENT_MINUTES_BEFORE} minutes before to ${MOMENT_MINUTES_AFTER} minutes after this moment.`,
    momentSlot.state === 'measured' ? `This minute: ${number(momentSlot.chatPerMin!)} chat per minute.` : 'This minute was not measured.',
    reference ? `Earlier average: ${number(reference.baseline)} per minute.` : '',
    peak ? `Highest: ${number(peak.chatPerMin!)} per minute, ${peak.relative === 0 ? 'at this minute' : minuteName(peak.relative)}.` : '',
    `${measuredMinutes} of ${inside} minutes measured.`,
    before > 0 ? `The first ${before === 1 ? 'minute' : `${before} minutes`} came before the broadcast started.` : '',
    after ? `The last ${after === 1 ? 'minute isn’t' : `${after} minutes aren’t`} available yet.` : '',
    unrecordedMinutes ? `${unrecordedMinutes} ${unrecordedMinutes === 1 ? 'minute has' : 'minutes have'} no chat recorded.` : '',
  ].filter(Boolean).join(' ')
  const baselineY = reference ? H - (reference.baseline / max) * H : null
  const momentCenter = ((MOMENT_MINUTES_BEFORE * (barWidth + GAP) + barWidth / 2) / W) * 100
  const track = (event: ReactPointerEvent<HTMLDivElement>) => {
    const svg = event.currentTarget.querySelector('svg')
    const bounds = svg?.getBoundingClientRect()
    const x = event.clientX - (bounds?.left ?? 0)
    if (!bounds || bounds.width <= 0 || !Number.isFinite(x)) return
    setHovered(x < 0 || x > bounds.width ? null : Math.min(n - 1, Math.max(0, Math.floor((x / bounds.width) * n))))
  }
  return <figure className="moment-minutes" data-state="ready" aria-labelledby={titleId}>
    <figcaption>{title}<span className={hovered != null ? 'is-hovered' : undefined}>{label}</span></figcaption>
    <div className="moment-minutes__plot" onPointerMove={track} onPointerDown={track} onPointerLeave={() => setHovered(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={summary} data-motion={reduced ? 'reduced' : undefined}>
        {baselineY != null ? <line className="moment-minutes__baseline" x1="0" x2={W} y1={baselineY} y2={baselineY} vectorEffect="non-scaling-stroke" /> : null}
        {slots.map((slot, index) => {
          // A rollup with no chat count: a neutral floor mark, never a measured zero bar.
          if (slot.state === 'unrecorded') {
            return <rect key={slot.relative} className="moment-minutes__unrecorded" x={index * (barWidth + GAP)} y={H - 2} width={barWidth} height={2} rx="1"
              data-relative={slot.relative} data-hovered={hovered === index ? 'true' : undefined} />
          }
          if (slot.state !== 'measured') return null
          const height = Math.max(2, (slot.chatPerMin! / max) * H)
          return <rect key={slot.relative} className="moment-minutes__bar" x={index * (barWidth + GAP)} y={H - height} width={barWidth} height={height} rx="2"
            data-relative={slot.relative} data-moment={slot.relative === 0 ? 'true' : undefined} data-hovered={hovered === index ? 'true' : undefined}
            // Bars grow outward from the moment; reduced motion draws them at once.
            style={reduced ? undefined : { animationDelay: `${Math.min(400, Math.abs(slot.relative) * 9)}ms` }} />
        })}
      </svg>
      <div className="moment-minutes__axis" aria-hidden="true">
        <span>{MOMENT_MINUTES_BEFORE} min before</span>
        <em style={{ left: `${momentCenter.toFixed(2)}%` }}>this moment</em>
        <span>{MOMENT_MINUTES_AFTER} min after</span>
      </div>
    </div>
    <div className="moment-minutes__legend" aria-hidden="true">
      <span><i className="moment-minutes__swatch" />This minute</span>
      {reference ? <span><i className="moment-minutes__swatch moment-minutes__swatch--baseline" />Earlier average {number(reference.baseline)}/min</span> : null}
      {unrecordedMinutes ? <span><i className="moment-minutes__swatch moment-minutes__swatch--unrecorded" />No chat recorded</span> : null}
    </div>
  </figure>
}
