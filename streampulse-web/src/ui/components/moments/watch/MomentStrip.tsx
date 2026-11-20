import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { WindowClip } from '../../../../lib/momentFeedback'
import type { DiscoveryMoment } from '../../../../lib/discoveryMoments'
import { MomentMinuteChart } from '../MomentMinuteChart'
// The chart's own rules live here; a shared link opens this page without the Moments page's styles.
import '../moments-workspace.css'
import './moment-watch.css'

const STEP_MS = 1000
const MINUTE_MS = 60_000
/** Pins whose centres are closer than this (px) at the rendered width become one. */
const PIN_MERGE_PX = 24

/** "Comment at 40:22", or "Comments at 40:22 and 40:30" for a merged pin. */
function pinName(times: string[]): string {
  if (times.length === 1) return `Comment at ${times[0]}`
  return `Comments at ${times.slice(0, -1).join(', ')} and ${times[times.length - 1]}`
}

/** The chart's loading look, for a strip whose Moment is not known yet. Decoration: the page says it is loading. */
function MinuteChartHold() {
  return (
    <figure className="moment-minutes" data-state="loading" aria-hidden="true">
      <figcaption><strong>Chat per minute around this moment</strong></figcaption>
      <div className="moment-minutes__plot moment-minutes__plot--loading"><span /></div>
    </figure>
  )
}

/**
 * The strip's shape while the Moment is on its way: its title, the chart's box, the track and the times
 * row, with nothing in them, so the strip lands without moving what is under it. `pickable` holds the
 * hint line a build with ratings and comments shows.
 */
export function MomentStripPlaceholder({ pickable = false }: { pickable?: boolean }) {
  return (
    <section className="mw-strip" aria-hidden="true">
      <h2 className="nc-section-title">The minutes around it</h2>
      {pickable ? <p className="nc-hint">&nbsp;</p> : null}
      <div className="mw-chart"><MinuteChartHold /></div>
      <div className="mw-track"><div className="mw-rail" /></div>
      <div className="mw-strip-times"><span>&nbsp;</span></div>
    </section>
  )
}

/**
 * "The minutes around it": the chat-per-minute chart and a track over the
 * page's window. The track shows the clips, the Moment's minute and the
 * comment pins; one range input picks the second `at`. Every time is in ms.
 * The range runs in ms with a 1000 ms step, so Arrow keys move one second.
 * Without `pickable` (no ratings and comments in this build) there is no range
 * input and no hint: the strip only shows the minute.
 */
export function MomentStrip({ window: span, minuteStart, clips, pins, at, onAt, signedIn, label, moment, pickable = true }: {
  window: { from: number; to: number }
  minuteStart: number
  clips: WindowClip[]
  /** The comment `at`s in view. */
  pins: number[]
  at: number
  onAt: (ms: number) => void
  signedIn: boolean
  /** The "40:42" for a time. */
  label: (ms: number) => string
  moment: Pick<DiscoveryMoment, 'key' | 'login' | 'streamId' | 'offsetSeconds' | 'at' | 'comparison'> | null
  /** False on the read-only page: no second can be picked. */
  pickable?: boolean
}) {
  const length = Math.max(1, span.to - span.from)
  const track = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number | null>(null)
  useEffect(() => {
    const node = track.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const read = () => { const w = node.getBoundingClientRect().width; if (w > 0) setWidth(w) }
    read()
    const observer = new ResizeObserver(read)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const pct = (ms: number) => `${(Math.min(span.to, Math.max(span.from, ms)) - span.from) / length * 100}%`
  const clamp = (ms: number) => Math.min(span.to, Math.max(span.from, span.from + Math.round((ms - span.from) / STEP_MS) * STEP_MS))
  const move = (ms: number) => { if (Number.isFinite(ms)) onAt(clamp(ms)) }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    move(at + (event.key === 'ArrowRight' ? STEP_MS : -STEP_MS))
  }
  // Pins once each, then grouped when their centres sit under PIN_MERGE_PX apart. A pin outside the span
  // (a comment before the stream began, or at the window's exclusive end) sits on the nearest edge.
  const sorted = [...new Set(pins)].sort((a, b) => a - b)
  const groups: number[][] = []
  for (const p of sorted) {
    const group = groups[groups.length - 1]
    // Until the track is measured, nothing is merged.
    if (group && width !== null && (p - group[0]!) / length * width < PIN_MERGE_PX) group.push(p)
    else groups.push([p])
  }
  const box = (from: number, to: number) => ({ left: pct(from), width: `calc(${pct(to)} - ${pct(from)})` })

  return (
    <section className="mw-strip" aria-labelledby="mw-strip-title">
      <h2 id="mw-strip-title" className="nc-section-title">The minutes around it</h2>
      {pickable ? <p className="nc-hint">{signedIn ? 'Tap a second to watch from there or pin your comment to it.' : 'Tap a second to watch from there.'}</p> : null}
      {/* One box for the chart from the first paint, whatever it comes to (drawn, still loading, or not available). */}
      <div className="mw-chart">{moment ? <MomentMinuteChart moment={moment} /> : <MinuteChartHold />}</div>
      <div className="mw-track" ref={track}>
        <div className="mw-rail" aria-hidden="true" />
        {clips.map(c => {
          const from = Date.parse(c.from)
          const to = Date.parse(c.to)
          if (!Number.isFinite(from) || !Number.isFinite(to) || to <= span.from || from >= span.to) return null
          return <span key={c.id} className="mw-clip" role="img" aria-label={`Twitch clip, ${label(from)} to ${label(to)}`} style={box(from, to)} />
        })}
        <span className="mw-minute" role="img" aria-label="The Moment’s minute" style={box(minuteStart, minuteStart + MINUTE_MS)} />
        <span className="mw-at" aria-hidden="true" style={{ left: pct(at) }} />
        {groups.map(group => {
          const first = group[0]!
          const on = group.includes(at)
          return (
            <button key={first} type="button" className={`mw-pin${on ? ' is-on' : ''}`} style={{ left: pct(first) }}
              aria-label={pinName(group.map(label))} aria-current={on ? 'true' : undefined} onClick={() => move(first)} />
          )
        })}
        {pickable ? (
          <input id="mw-second" className="mw-range" type="range" aria-label="Second in the stream" aria-valuetext={label(at)}
            min={span.from} max={span.to} step={STEP_MS} value={clamp(at)}
            onChange={event => move(Number(event.target.value))} onKeyDown={onKeyDown} />
        ) : null}
      </div>
      <div className="mw-strip-times" aria-hidden="true">
        <span>{label(span.from)}</span>
        <strong>{label(at)}</strong>
        <span>{label(span.to)}</span>
      </div>
    </section>
  )
}
