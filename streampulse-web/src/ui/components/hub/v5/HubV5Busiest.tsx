/**
 * Busiest now (R5-1, the round-5 Strip; mockup busiest-variants.js Strip +
 * Carousel): the 12 chattiest channels of the shared 5-minute window, about
 * 5.5 tiles in view, ‹ › in the header, edge fades, no auto-advance and one
 * roving tab stop (arrow keys, Home, End). An up/down wheel over the strip
 * moves it one tile per notch; at either end the page scrolls as usual.
 * Prod saves no live previews, so every tile is the channel's face tile.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import type { HubLiveChannel } from '../../../../lib/publicHub'
import { HubToggletip } from '../d3/HubToggletip'
import { HubV5Icon } from './HubV5Icon'
import { busiestAria, busiestCue, busiestTip, hubAvatarTone, hubClock, hubMonogram, rankBusiest } from './hubV5Model'

const reduced = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const H_ID = 'hv5-busy-h'
const TRACK_ID = 'hv5-busy-track'

/** `unavailable`: the hub request failed, so an empty list says so rather than that no channel qualifies (INT-02). */
export function HubV5Busiest({ live, nowMs, loading = false, unavailable = false }: { live: readonly HubLiveChannel[]; nowMs: number; loading?: boolean; unavailable?: boolean }) {
  const set = useMemo(() => rankBusiest(live), [live])
  const cue = busiestCue(set, nowMs)
  const rows = set.rows
  const N = rows.length
  const trackRef = useRef<HTMLOListElement>(null)
  const [pos, setPos] = useState(() => `1–${Math.min(6, N)} of ${N}`)
  const [prevOff, setPrevOff] = useState(true)
  const [nextOff, setNextOff] = useState(false)
  const [more, setMore] = useState({ l: false, r: false })
  const [rove, setRove] = useState(0)

  const geo = useCallback(() => {
    const track = trackRef.current!
    const cs = getComputedStyle(track)
    const per = parseFloat(cs.getPropertyValue('--per')) || 6
    const gap = parseFloat(cs.columnGap) || 0
    const item = track.querySelector('.hv5-bzc-it')
    return { whole: Math.max(1, Math.floor(per + 1e-6)), step: (item ? item.getBoundingClientRect().width : 0) + gap, max: track.scrollWidth - track.clientWidth }
  }, [])

  const firstOf = useCallback((g: ReturnType<typeof geo>) => {
    const left = trackRef.current!.scrollLeft
    if (g.max <= 1) return 0
    if (left >= g.max - 1) return Math.max(0, N - g.whole)
    return Math.max(0, Math.min(N - 1, Math.round(left / (g.step || 1))))
  }, [N])

  // announce false (the per-frame scroll path): only the pager state and the roving tab stop; the aria-live
  // position text is written when the scroll settles, so one page announces one position.
  const update = useCallback((announce = true) => {
    const track = trackRef.current
    if (!track || !track.isConnected) return
    const g = geo()
    const f = firstOf(g)
    const left = track.scrollLeft
    if (announce) setPos(`${f + 1}–${Math.min(N, f + g.whole)} of ${N}`)
    setPrevOff(g.max <= 1 || left <= 1)
    setNextOff(g.max <= 1 || left >= g.max - 1)
    setMore((m) => {
      const l = g.max > 1 && left > 1
      const r = g.max > 1 && left < g.max - 1
      return m.l === l && m.r === r ? m : { l, r }
    })
    if (!track.contains(document.activeElement)) setRove(f)
  }, [N, firstOf, geo])

  useEffect(() => {
    const track = trackRef.current
    if (!track || !N) return undefined
    let raf = 0
    let quiet = 0
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(false) })
      window.clearTimeout(quiet)
      quiet = window.setTimeout(() => update(true), 200) // where scrollend is missing
    }
    const onScrollEnd = () => { window.clearTimeout(quiet); update(true) }
    // An up/down wheel moves the strip one tile per notch (the track snaps to tile starts). At either end the
    // page scrolls; sideways swipes and Shift+wheel stay native; Ctrl+wheel stays the browser's zoom.
    let acc = 0
    let until = 0
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
      const max = track.scrollWidth - track.clientWidth
      const dy = event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? track.clientWidth : 1)
      if (max <= 1 || (dy > 0 && track.scrollLeft >= max - 1) || (dy < 0 && track.scrollLeft <= 1)) { acc = 0; return }
      event.preventDefault()
      if (event.timeStamp < until) return // a trackpad's burst of small deltas counts once
      acc += dy
      if (Math.abs(acc) < 40) return
      const item = track.querySelector('.hv5-bzc-it')
      const step = (item ? item.getBoundingClientRect().width : 200) + (parseFloat(getComputedStyle(track).columnGap) || 0)
      track.scrollBy({ left: Math.sign(acc) * step, behavior: reduced() ? 'auto' : 'smooth' })
      acc = 0
      until = event.timeStamp + 160
    }
    track.addEventListener('scroll', onScroll, { passive: true })
    track.addEventListener('scrollend', onScrollEnd)
    track.addEventListener('wheel', onWheel, { passive: false })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => update(true))
    ro?.observe(track)
    update(true)
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(quiet)
      track.removeEventListener('scroll', onScroll)
      track.removeEventListener('scrollend', onScrollEnd)
      track.removeEventListener('wheel', onWheel)
      ro?.disconnect()
    }
  }, [N, update])

  // Pages snap to fixed starts (multiples of the whole tiles per page, the last one clamped), so forward and
  // back show the same sets: at 5 per page 1–5, 6–10, 8–12, then back 6–10, 1–5.
  const page = (dir: 1 | -1) => {
    if (dir < 0 ? prevOff : nextOff) return
    const track = trackRef.current
    if (!track) return
    const g = geo()
    const f = firstOf(g)
    const w = g.whole
    const target = Math.max(0, dir > 0 ? Math.min(N - w, (Math.floor(f / w) + 1) * w) : (Math.ceil(f / w) - 1) * w)
    track.scrollTo({ left: target * g.step, behavior: reduced() ? 'auto' : 'smooth' })
    if (reduced()) update(true)
  }

  const onTrackKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('.hv5-bzc-c')
    if (!link || event.altKey || event.ctrlKey || event.metaKey) return
    const links = [...(trackRef.current?.querySelectorAll<HTMLAnchorElement>('.hv5-bzc-c') ?? [])]
    const i = links.indexOf(link)
    const j = event.key === 'ArrowRight' ? Math.min(N - 1, i + 1)
      : event.key === 'ArrowLeft' ? Math.max(0, i - 1)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? N - 1
            : null
    if (j == null) return
    event.preventDefault()
    if (j === i) return
    setRove(j)
    links[j]!.focus({ preventScroll: true })
    links[j]!.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' })
  }

  const hasWindow = Number.isFinite(set.windowEnd)

  return (
    <section id="busiest" className="hv5-sec hv5-busiest" aria-labelledby={H_ID} data-cue={hasWindow ? cue : undefined}>
      <div className="hv5-bzv-in">
        <header className="hv5-bzv-rh">
          <h2 id={H_ID}>Busiest now</h2>
          {hasWindow ? <HubToggletip tip={<span className="hv5-pre">{busiestTip(set, cue)}</span>} label="About Busiest now" /> : null}
          {hasWindow ? (
            <span className="hv5-bzv-cue" data-cue={cue}>
              <i aria-hidden="true" />
              {cue === 'live' ? 'Live' : `Not updated since ${hubClock(set.windowEnd)}`}
            </span>
          ) : null}
          <p className="hv5-bzv-meta">Chat messages per minute · last 5 min</p>
          {N ? (
            <div className="hv5-bzc-pg">
              <span className="hv5-bzc-pos" aria-live="polite">{pos}</span>
              <button className="hv5-ib" type="button" aria-label="Previous channels" aria-controls={TRACK_ID} aria-disabled={prevOff} onClick={() => page(-1)}>
                <HubV5Icon name="left" />
              </button>
              <button className="hv5-ib" type="button" aria-label="Next channels" aria-controls={TRACK_ID} aria-disabled={nextOff} onClick={() => page(1)}>
                <HubV5Icon name="right" />
              </button>
            </div>
          ) : null}
        </header>
        {N ? (
          <div className={`hv5-bzc-vp hv5-bzs-vp${more.l ? ' more-l' : ''}${more.r ? ' more-r' : ''}`}>
            <ol ref={trackRef} id={TRACK_ID} className="hv5-bzc-track" aria-labelledby={H_ID} onKeyDown={onTrackKeyDown}>
              {rows.map((row, i) => (
                <li key={row.login} className="hv5-bzc-it" data-rank={row.rank} data-login={row.login}>
                  <Link className="hv5-bzt-t hv5-bzc-c" to={row.href} aria-label={busiestAria(row, N)} tabIndex={i === rove ? 0 : -1}>
                    <span className="hv5-bzv-face" style={{ background: `radial-gradient(120% 90% at 50% 40%, ${hubAvatarTone(row.login)} 0%, #101012 100%)` }}>
                      {row.avatar ? (
                        <img className="hv5-bzv-fa" src={row.avatar} alt="" decoding="async" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="hv5-bzv-fa hv5-bzv-fam" aria-hidden="true">{hubMonogram(row.displayName, row.login)}</span>
                      )}
                    </span>
                    <span className="hv5-bzt-fig"><b>{row.fig}</b> chat/min</span>
                    <span className="hv5-bzt-cap">
                      <span className="hv5-bzt-nm">{row.displayName}</span>
                      <span className="hv5-bzt-cat">{row.category || 'No category'}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        ) : loading ? (
          <div className="hv5-bzs-wait" aria-hidden="true" />
        ) : (
          <p className="hv5-bzv-none">{unavailable ? 'Unavailable right now.' : 'No synced channel has a full 5-minute window right now.'}</p>
        )}
      </div>
    </section>
  )
}
