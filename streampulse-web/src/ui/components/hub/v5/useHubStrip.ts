/**
 * A strip of tiles (Busiest now, Your follows; moved from HubV5Busiest, 11-01):
 * about 5.5 tiles in view, ‹ › paging to fixed starts, edge fades and one roving
 * tab stop (arrow keys, Home, End). An up/down wheel over the strip moves it one
 * tile per notch; at either end the page scrolls as usual. A read that re-ranks
 * the tiles keeps the strip on the same ranks. The track is the `.hv5-bzc-track`
 * list of `.hv5-bzc-it` items, each holding one `.hv5-bzc-c` link.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

const reduced = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** `order`: the tiles' keys in rank order, so a re-ranked list is told from a re-render. */
export function useHubStrip(N: number, order: string) {
  const trackRef = useRef<HTMLOListElement>(null)
  // Where the reader left the track: its offset at the last scroll, for the <ol> it was read from.
  const place = useRef<{ track: HTMLOListElement | null; left: number; moving: boolean }>({ track: null, left: 0, moving: false })
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
    place.current = { track, left: track.scrollLeft, moving: false }
    const settle = () => {
      place.current.moving = false
      update(true)
    }
    const onScroll = () => {
      place.current = { track, left: track.scrollLeft, moving: true }
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(false) })
      window.clearTimeout(quiet)
      quiet = window.setTimeout(settle, 200) // where scrollend is missing
    }
    const onScrollEnd = () => { window.clearTimeout(quiet); settle() }
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
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(quiet)
      track.removeEventListener('scroll', onScroll)
      track.removeEventListener('scrollend', onScrollEnd)
      track.removeEventListener('wheel', onWheel)
      ro?.disconnect()
    }
  }, [N, update])

  // A read that re-ranks the tiles moves them within the list, and the browser's snapping follows the tile it had
  // snapped: a strip on 1–5 would slide to wherever the old first tile went, hiding the new leaders. The strip goes
  // back to the reader's offset instead (unless it is still moving). A focused tile keeps the tab stop and stays in
  // view by moving the strip alone: scrollIntoView would also scroll the page back up to a strip the reader has
  // scrolled past. All before paint, with the pager's measure, so a strip that fits never shows ‹ › for a frame.
  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return
    const left = place.current
    if (left.track === track) {
      if (!left.moving && Math.abs(track.scrollLeft - left.left) > 1) track.scrollLeft = left.left
      const focused = document.activeElement
      const tile = focused instanceof HTMLElement && track.contains(focused) ? focused.closest<HTMLElement>('.hv5-bzc-it') : null
      if (tile) {
        const i = [...track.children].indexOf(tile)
        const g = geo()
        const f = firstOf(g)
        if (i < f) track.scrollLeft = i * g.step
        else if (i >= f + g.whole) track.scrollLeft = (i - g.whole + 1) * g.step
        setRove(i)
      }
    }
    update(!left.moving)
  }, [order, geo, firstOf, update])

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

  return { trackRef, pos, prevOff, nextOff, more, rove, page, onTrackKeyDown }
}
