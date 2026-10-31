/**
 * Top emotes as the emote map (R5-13; re-done as r4 A2 on 2026-10-21, mockup
 * emotemap-moments-r4, then restyled as r5 C1 quiet tiles and r6 D2 field
 * frames, mockups emotemap-r5 and emotemap-r6). A treemap in three provider
 * fields (Twitch, 7TV, BTTV & FFZ), each in one thin frame in its legend colour
 * around neutral dark tiles with 2 px seams, so colour marks the group and not
 * every tile; a tile's size is its uses over the window and it shows its picture, then its
 * name and share as room allows (wide, short tiles on one line). Every emote has
 * a tile (Z1, 10-22): the wheel, a pinch, a double-click or −/+ zoom up to 8×, a
 * drag pans, and a field's label or legend item flies into it; what a tile shows
 * follows its size on screen. With a pace to compare (K1), a tile's fill is its
 * last hour against its own pace and the frames go grey.
 * Under the map, the ten most used emotes with the last hour against their own
 * pace as a change chip. A click on a tile or a row selects the emote: the list
 * turns into the hub's live moments it led, and each
 * row opens the moment in Moments. Hover (or focus) shows an emote's numbers;
 * arrow keys move to the nearest tile, Home and End to the ends, with one tab
 * stop. 24 h | Last hour re-flows the tiles; Taller map gives 1.8 times the
 * height.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent as ReactFocusEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { sanitizeEmoteImageUrl } from '../../../../lib/emoteAssetUrl'
import type { HubActivityPoint, HubLivePulseMoment } from '../../../../lib/publicHub'
import { useMatchMedia } from '../../../hooks/useMatchMedia'
import { HubToggletip } from '../d3/HubToggletip'
import { HubV5Avatar } from './HubV5Avatar'
import {
  EMOTE_ZOOM_MAX,
  MAP_VIEW_1X,
  clampMapView,
  emoteChange,
  emoteImageAt,
  emoteMapData,
  emoteMapHeight,
  emoteMapLayout,
  emoteMapMeta,
  emoteMapTip,
  emoteMapValue,
  emoteMomentRows,
  emoteSharePct,
  fieldMapView,
  mapRectOnScreen,
  mapViewShowing,
  nearestTile,
  paceHeat,
  providerName,
  tileFace,
  zoomMapAt,
  type EmoteChange,
  type HubEmoteAgg,
  type HubEmoteMapData,
  type HubEmoteWindow,
  type MapField,
  type MapLayout,
  type MapTile,
  type MapView,
} from './hubV5EmoteMapModel'
import { feedAgo } from './hubV5FeedModel'
import { formatHubInt, formatHubMultiplier, hubClockRange, momentRowAria, momentRowsV5 } from './hubV5Model'
import { isFocusVisible, placeHubV5Card } from './hubV5HoverCard'

const H_ID = 'hv5-te-h'
const META_ID = 'hv5-em-meta'
const HELP_ID = 'hv5-em-help'
const px = (n: number) => `${n.toFixed(1)}px`
/** Z1: the field labels sit on the frames' top line, so the tiles start this far down. */
const LABEL_TOP = 12
const MINI_W = 96

/** A tile or a frame as drawn: 1 px in on every side, so the seams stay 2 px at any zoom. */
function tileStyle(t: { x: number; y: number; w: number; h: number }): CSSProperties {
  return {
    left: px(t.x + 1),
    top: px(t.y + 1),
    width: px(Math.max(1, t.w - 2)),
    height: px(Math.max(1, t.h - 2)),
  }
}

/** K1: the rising or cooling colour mixed into the tile's dark fill (and its hover fill). */
function heatStyle(a: HubEmoteAgg): CSSProperties | null {
  const h = paceHeat(a)
  if (!h) return null
  const c = h.dir === 'up' ? 'var(--hv5-rise)' : 'var(--hv5-cool)'
  return { '--bg': `color-mix(in oklab, ${c} ${h.mix}%, #17171a)`, '--bgh': `color-mix(in oklab, ${c} ${h.mix + 8}%, #1e1e22)` } as CSSProperties
}

function Chg({ c }: { c: EmoteChange }) {
  return <span className="hv5-chg" data-dir={c.dir} title={c.words}>{c.text}</span>
}

/** The picture at its size; a sharper file is loaded before it replaces the one on show, so nothing blinks. */
function EmotePic({ a, size }: { a: HubEmoteAgg; size: number }) {
  const want = sanitizeEmoteImageUrl(emoteImageAt(a.e.imageUrl, size))
  const [src, setSrc] = useState(want)
  useEffect(() => {
    if (!want || want === src) return undefined
    let live = true
    const next = new Image()
    next.referrerPolicy = 'no-referrer'
    next.onload = () => { if (live) setSrc(want) }
    next.src = want
    return () => { live = false }
  }, [want, src])
  return src ? (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={(event) => { event.currentTarget.style.visibility = 'hidden' }}
    />
  ) : null
}

function EmoteCard({ a, data, win, total }: { a: HubEmoteAgg; data: HubEmoteMapData; win: HubEmoteWindow; total: number }) {
  const v = emoteMapValue(a, win)
  const src = sanitizeEmoteImageUrl(emoteImageAt(a.e.imageUrl, 48))
  const slot = data.bucketMinutes * 60_000
  return (
    <>
      <div className="hv5-ec-h">
        <span className="hv5-ec-im">{src ? <img src={src} alt="" width={40} height={40} referrerPolicy="no-referrer" /> : null}</span>
        <span className="hv5-ec-tx"><b>{a.e.name}</b><span>{providerName(a.prov)}</span></span>
      </div>
      <dl className="hv5-ec-dl">
        <dt>{win === 'all' ? `Uses, last ${data.windowLabel}` : 'Uses, last hour'}</dt>
        <dd>{formatHubInt(v)} <span>· {emoteSharePct(total > 0 ? (v / total) * 100 : 0)} of the map</span></dd>
        {data.paceOk ? (
          <>
            <dt>Last hour</dt>
            <dd>{formatHubInt(a.c1h)} <Chg c={emoteChange(a, data.windowLabel)} /> <span>vs its pace</span></dd>
          </>
        ) : null}
        <dt>Busiest</dt>
        <dd>{formatHubInt(Math.round(a.peak / data.bucketMinutes))}/min <span>· {hubClockRange(a.peakT, a.peakT + slot)}</span></dd>
        <dt>In a top 10</dt>
        <dd>{a.n} <span>of {data.intervals} intervals</span></dd>
      </dl>
    </>
  )
}

export function HubV5EmoteMap({
  points,
  bucketMinutes,
  loading,
  unavailable,
  moments = [],
  avatars,
  nowMs,
}: {
  points: readonly HubActivityPoint[]
  bucketMinutes: number
  loading?: boolean
  /** The hub request failed: the empty line says so (INT-02). */
  unavailable?: boolean
  /** The hub's live moments: where a selected emote led chat. */
  moments?: readonly HubLivePulseMoment[]
  avatars?: ReadonlyMap<string, string>
  nowMs: number
}) {
  const data = useMemo(() => emoteMapData(points, bucketMinutes), [points, bucketMinutes])
  const phone = useMatchMedia('(max-width: 719px)')
  const reduce = useMatchMedia('(prefers-reduced-motion: reduce)')
  const [win, setWin] = useState<HubEmoteWindow>('all')
  const [tall, setTall] = useState<{ on: boolean; from: number }>({ on: false, from: 0 })
  const mapRef = useRef<HTMLDivElement>(null)
  const vpRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [focusId, setFocusId] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [on, setOn] = useState<{ id: string; el: HTMLElement } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  // Z1 zoom: the view, a ref of it for the event handlers, and whether it is moving (tiles skip their re-flow easing then)
  const [zoom, setZoomState] = useState<MapView>(MAP_VIEW_1X)
  const zoomRef = useRef<MapView>(MAP_VIEW_1X)
  const [moving, setMoving] = useState(false)
  const [panning, setPanning] = useState(false)
  const anim = useRef(0)
  const settle = useRef<number | undefined>(undefined)
  const drag = useRef<{ id: number; x: number; y: number; v: MapView; moved: boolean } | null>(null)
  const fingers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<number | null>(null)
  const dragged = useRef(false)
  const selBefore = useRef<{ id: string | null; at: number } | null>(null)

  const hourOk = Boolean(data?.paceOk)
  const heat = hourOk
  const view: HubEmoteWindow = hourOk ? win : 'all'
  // min-height: the map grows to fill a taller grid row
  const prefH = size.w ? emoteMapHeight(size.w, phone, tall.on, tall.from) : (phone ? 320 : 340)
  const W = size.w
  const VH = Math.max(0, size.h - LABEL_TOP)
  const dims = useRef({ W, VH })
  useLayoutEffect(() => {
    dims.current = { W, VH }
  })
  const zoomed = zoom.k > 1 + 1e-3

  useLayoutEffect(() => {
    const map = mapRef.current
    if (!map) return undefined
    const read = () => setSize((prev) => {
      const w = Math.round(map.clientWidth)
      const h = Math.round(map.clientHeight)
      return prev.w === w && prev.h === h ? prev : { w, h }
    })
    read()
    if (typeof ResizeObserver === 'undefined') return undefined
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(read)
    })
    ro.observe(map)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [data != null])

  const layout: MapLayout | null = useMemo(() => (data ? emoteMapLayout(data, view, W, VH) : null), [data, view, W, VH])
  // a field label sits on its frame's top line only as far as the field goes: a narrow field drops the share, then the label
  const [labelFit, setLabelFit] = useState<Record<string, 'name' | 'none'>>({})
  useLayoutEffect(() => {
    const map = mapRef.current
    if (!map || !layout) return undefined
    const measure = () => {
      const next: Record<string, 'name' | 'none'> = {}
      for (const el of map.querySelectorAll<HTMLElement>('.hv5-em-fl')) {
        const f = layout.fields.find((x) => x.field === el.dataset.field)
        const name = el.querySelector('span')?.getBoundingClientRect().width ?? 0
        const share = el.querySelector('b')?.getBoundingClientRect().width ?? 0
        if (!f) continue
        // 7 px pads, the dot and its 6 px gap, the name, a 6 px gap, the share; 10 px in from the field and 6 px short of its end
        const bare = 14 + (el.querySelector('i') ? 13 : 0) + name
        const room = f.w - 16
        if (bare > room) next[f.field] = 'none'
        else if (bare + 6 + share > room) next[f.field] = 'name'
      }
      setLabelFit((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    measure()
    let live = true
    void document.fonts?.ready.then(() => { if (live) measure() })
    return () => { live = false }
  }, [layout, heat])
  const momentRows = useMemo(() => momentRowsV5(moments), [moments])
  const selAgg = sel ? data?.byId.get(sel) : undefined
  const selected = selAgg && emoteMapValue(selAgg, view) > 0 ? selAgg : null
  const spammed = useMemo(() => (selected ? emoteMomentRows(momentRows, selected) : []), [selected, momentRows])

  const hide = useCallback(() => {
    window.clearTimeout(timer.current)
    setOn(null)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  // a poll or a resize keeps the card on its emote while the emote is still drawn
  useEffect(() => {
    if (on && (!on.el.isConnected || !data?.byId.has(on.id))) hide()
  }, [layout, data, on, hide])
  useEffect(() => {
    if (!on) return undefined
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') hide() }
    const onScroll = () => { if (!mapRef.current?.contains(document.activeElement)) hide() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [on, hide])
  useLayoutEffect(() => {
    if (on && on.el.isConnected && cardRef.current) placeHubV5Card(cardRef.current, on.el, vpRef.current)
  }, [on, layout, zoom])

  /* ---------- Z1 zoom: the wheel and +/− about a point, a drag pans, two fingers pinch, a label or legend item flies in ---------- */
  const setZoom = useCallback((v: MapView) => {
    zoomRef.current = v
    setZoomState(v)
  }, [])
  // tiles ease when the map re-flows, not while the view moves
  const bump = useCallback(() => {
    setMoving(true)
    window.clearTimeout(settle.current)
    settle.current = window.setTimeout(() => setMoving(false), 320)
  }, [])
  useEffect(() => () => {
    cancelAnimationFrame(anim.current)
    window.clearTimeout(settle.current)
  }, [])
  // a new size or window lays the map out again: start from the whole map
  useEffect(() => {
    cancelAnimationFrame(anim.current)
    setZoom(MAP_VIEW_1X)
  }, [W, VH, view, setZoom])
  const animateTo = useCallback((to: MapView, ms = 420) => {
    cancelAnimationFrame(anim.current)
    const { W: w, VH: h } = dims.current
    const goal = clampMapView(to, w, h)
    const from = zoomRef.current
    bump()
    if (reduce) {
      setZoom(goal)
      return
    }
    const t0 = performance.now()
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms)
      const q = 1 - (1 - p) ** 3
      setZoom(clampMapView({ k: from.k * (goal.k / from.k) ** q, tx: from.tx + (goal.tx - from.tx) * q, ty: from.ty + (goal.ty - from.ty) * q }, w, h))
      bump()
      if (p < 1) anim.current = requestAnimationFrame(step)
    }
    anim.current = requestAnimationFrame(step)
  }, [bump, reduce, setZoom])
  const flyTo = (f: MapField) => {
    hide()
    animateTo(fieldMapView(f, W, VH))
  }
  const zoomBy = (factor: number) => {
    hide()
    const v = zoomRef.current
    animateTo(zoomMapAt(v, W / 2, VH / 2, v.k * factor, W, VH), 260)
  }
  const resetZoom = () => {
    hide()
    animateTo(MAP_VIEW_1X)
  }
  /** A pointer's place in the view (the tiles' box, under the label strip). */
  const vpPoint = (x: number, y: number): [number, number] => {
    const r = vpRef.current?.getBoundingClientRect()
    return r ? [x - r.left, y - r.top] : [0, 0]
  }
  // the wheel zooms anywhere over the map; at either end of the range it goes back to the page
  const hasMap = data != null
  useEffect(() => {
    const map = mapRef.current
    if (!map) return undefined
    const onWheel = (event: WheelEvent) => {
      const { W: w, VH: h } = dims.current
      const v = zoomRef.current
      if (!event.cancelable || !w || !h || !event.deltaY) return
      if (event.deltaY < 0 ? v.k >= EMOTE_ZOOM_MAX - 1e-3 : v.k <= 1 + 1e-3) return
      event.preventDefault()
      cancelAnimationFrame(anim.current)
      hide()
      bump()
      const r = vpRef.current?.getBoundingClientRect()
      const dy = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * h : event.deltaY
      setZoom(zoomMapAt(v, event.clientX - (r?.left ?? 0), event.clientY - (r?.top ?? 0), v.k * Math.exp(-dy * 0.0022), w, h))
    }
    map.addEventListener('wheel', onWheel, { passive: false })
    return () => map.removeEventListener('wheel', onWheel)
  }, [hasMap, hide, bump, setZoom])
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragged.current = false
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('.hv5-em-fl')) return
    if (event.pointerType === 'touch') {
      fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (fingers.current.size === 2) {
        const [p, q] = [...fingers.current.values()]
        pinch.current = Math.hypot(p!.x - q!.x, p!.y - q!.y)
        drag.current = null
        return
      }
    }
    // at 1× a drag is no pan, so a finger still scrolls the page
    if (zoomRef.current.k <= 1 + 1e-3) return
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, v: zoomRef.current, moved: false }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (fingers.current.has(event.pointerId)) fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pinch.current != null && fingers.current.size === 2) {
      const [p, q] = [...fingers.current.values()]
      const d = Math.hypot(p!.x - q!.x, p!.y - q!.y)
      if (pinch.current > 0 && d > 0) {
        const [x, y] = vpPoint((p!.x + q!.x) / 2, (p!.y + q!.y) / 2)
        const v = zoomRef.current
        cancelAnimationFrame(anim.current)
        hide()
        bump()
        setZoom(zoomMapAt(v, x, y, v.k * (d / pinch.current), W, VH))
      }
      pinch.current = d
      dragged.current = true
      return
    }
    const d = drag.current
    if (!d || d.id !== event.pointerId) return
    const dx = event.clientX - d.x
    const dy = event.clientY - d.y
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 4) return
      d.moved = true
      dragged.current = true
      mapRef.current?.setPointerCapture(event.pointerId)
      cancelAnimationFrame(anim.current)
      hide()
      setPanning(true)
    }
    bump()
    setZoom(clampMapView({ k: d.v.k, tx: d.v.tx + dx, ty: d.v.ty + dy }, W, VH))
  }
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    fingers.current.delete(event.pointerId)
    if (fingers.current.size < 2) pinch.current = null
    if (drag.current?.id === event.pointerId) {
      drag.current = null
      setPanning(false)
    }
  }
  // a drag or a pinch ends without a click on the tile under it
  const onClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!dragged.current) return
    dragged.current = false
    event.stopPropagation()
    event.preventDefault()
  }
  // a double-click zooms 3× at the point, or back out; its two clicks leave the selection as it was
  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('.hv5-em-fl')) return
    const before = selBefore.current
    if (before && event.timeStamp - before.at < 800) setSel(before.id)
    selBefore.current = null
    hide()
    const v = zoomRef.current
    if (v.k > 1.01) {
      animateTo(MAP_VIEW_1X)
      return
    }
    const [x, y] = vpPoint(event.clientX, event.clientY)
    animateTo(zoomMapAt(v, x, y, 3, W, VH))
  }

  const itemOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('.hv5-em-t') : null)
  const onPointerOver = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' || drag.current?.moved) return
    const el = itemOf(event.target)
    if (!el || el === on?.el) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      if (el.isConnected) setOn({ id: el.dataset.eid!, el })
    }, on ? 0 : 90)
  }
  // touch fires a leave after every tap
  const onPointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => { if (event.pointerType !== 'touch') hide() }
  const select = (id: string) => setSel((prev) => (prev === id ? null : id))
  const tiles = layout?.tiles ?? []
  const onFocus = (event: ReactFocusEvent<HTMLDivElement>) => {
    const el = event.target instanceof Element ? event.target.closest<HTMLElement>('button.hv5-em-t') : null
    if (!el || !isFocusVisible(el)) return
    // zoomed in, the keyboard brings its tile into view
    const t = tiles.find((x) => x.a.id === el.dataset.eid)
    if (t) setZoom(mapViewShowing(zoomRef.current, t, W, VH))
    setOn({ id: el.dataset.eid!, el })
  }
  const onBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (!(event.relatedTarget instanceof Node) || !mapRef.current?.contains(event.relatedTarget)) hide()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const el = event.target instanceof Element ? event.target.closest<HTMLElement>('button.hv5-em-t') : null
    if (!el) return
    const from = tiles.find((t) => t.a.id === el.dataset.eid)
    if (!from) return
    const dir = ({ ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] } as Record<string, [number, number]>)[event.key]
    let next: MapTile | null = null
    if (dir) next = nearestTile(tiles, from, dir[0], dir[1])
    else if (event.key === 'Home') next = tiles[0] ?? null
    else if (event.key === 'End') next = tiles[tiles.length - 1] ?? null
    else return
    event.preventDefault()
    if (!next) return
    const target = mapRef.current?.querySelector<HTMLElement>(`button.hv5-em-t[data-eid="${CSS.escape(next.a.id)}"]`)
    if (!target) return
    setFocusId(next.a.id)
    setZoom(mapViewShowing(zoomRef.current, next, W, VH))
    // the view moves itself; the browser must not scroll the clipped map
    target.focus({ preventScroll: true })
  }

  const tabId = layout && tiles.some((t) => t.a.id === focusId) ? focusId : tiles[0]?.a.id ?? null
  const onAgg = on ? data?.byId.get(on.id) : undefined
  const meta = data && layout ? emoteMapMeta(data, layout, view) : ''
  const windowWords = view === 'all' ? `last ${data?.windowLabel ?? '24 h'}` : 'last hour'
  const shareOf = (v: number) => emoteSharePct(layout && layout.total > 0 ? (v / layout.total) * 100 : 0)

  return (
    <section id="emotes" className="hv5-sec hv5-emotes" aria-labelledby={H_ID} aria-busy={loading || undefined}>
      <div className="hv5-rh hv5-em-rh">
        <h2 id={H_ID}>Top emotes</h2>
        {data ? <HubToggletip tip={emoteMapTip(data)} label="About the emote map" /> : null}
        {data ? (
          <span className="hv5-end">
            <span className="hv5-em-zoom" role="group" aria-label="Map zoom">
              <span className="hv5-em-zr">{zoom.k.toFixed(1)}×</span>
              <button type="button" className="hv5-em-zb" aria-label="Zoom out" disabled={!zoomed} onClick={() => zoomBy(1 / 1.6)}>−</button>
              <button type="button" className="hv5-em-zb" aria-label="Zoom in" disabled={zoom.k >= EMOTE_ZOOM_MAX - 1e-3} onClick={() => zoomBy(1.6)}>+</button>
              <button type="button" className="hv5-em-zb" disabled={!zoomed} onClick={resetZoom}>Reset</button>
            </span>
            {hourOk ? (
              <span className="hv5-seg" role="group" aria-label="Emote map window">
                <button type="button" aria-pressed={win === 'all'} onClick={() => { hide(); setWin('all') }}>{data.windowLabel}</button>
                <button type="button" aria-pressed={win === '1h'} onClick={() => { hide(); setWin('1h') }}>Last hour</button>
              </span>
            ) : null}
          </span>
        ) : null}
        {data ? <span className="hv5-meta hv5-em-meta" id={META_ID}>{meta}</span> : null}
      </div>
      {data ? (
        <>
          <div
            ref={mapRef}
            className={`hv5-em-map${zoomed || moving ? ' hv5-em-zm' : ''}${panning ? ' hv5-em-pan' : ''}`}
            role="group"
            aria-labelledby={`${H_ID} ${META_ID}`}
            aria-describedby={HELP_ID}
            data-heat={heat || undefined}
            data-zoomed={zoomed || undefined}
            // at 1× one finger scrolls the page and two pinch the map; zoomed in, one finger pans
            style={{ '--em-h': `${prefH}px`, touchAction: zoomed ? 'none' : 'pan-x pan-y' } as CSSProperties}
            onPointerOver={onPointerOver}
            onPointerLeave={onPointerLeave}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onClickCapture={onClickCapture}
            onDoubleClick={onDoubleClick}
            onFocus={onFocus}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
          >
            {/* each field's name on its frame's top line, at 1×; a click flies into the field */}
            {layout?.fields.filter((f) => f.h >= 40).map((f) => (
              <button
                key={`fl:${f.field}`}
                type="button"
                className="hv5-em-fl"
                data-field={f.field}
                data-fit={labelFit[f.field]}
                style={{ left: px(f.x + 10), top: px(LABEL_TOP + f.y - 9) }}
                tabIndex={zoomed || labelFit[f.field] === 'none' ? -1 : 0}
                aria-hidden={zoomed || labelFit[f.field] === 'none' || undefined}
                aria-label={`Zoom into ${f.name}, ${f.share} of uses`}
                onClick={() => flyTo(f)}
              >
                {heat ? null : <i aria-hidden="true" />}<span>{f.name}</span><b>{f.share}</b>
              </button>
            ))}
            <div ref={vpRef} className="hv5-em-vp" style={{ top: LABEL_TOP }}>
              {layout?.fields.map((f) => (
                <div key={`ff:${f.field}`} className="hv5-em-ff" data-field={f.field} style={tileStyle(mapRectOnScreen(f, zoom, W, VH))} aria-hidden="true" />
              ))}
              {tiles.map((t) => {
                const a = t.a
                const aria = `#${t.rank} ${a.e.name}, ${providerName(a.prov)}, ${formatHubInt(t.v)} uses in the ${windowWords}, ${t.share} of the map${hourOk ? `, ${emoteChange(a, data.windowLabel).words}` : ''}.`
                const s = mapRectOnScreen(t, zoom, W, VH)
                // what a tile shows follows its size on screen; one bigger than the view keeps its picture and name in the part on show
                const face = zoomed ? tileFace(Math.max(0, s.w - 2 - s.cl - s.cr), Math.max(0, s.h - 2 - s.ct - s.cb)) : t
                const clipped = s.cl + s.ct + s.cr + s.cb > 0 && face.size !== 's' && face.size !== 'xs'
                return (
                  <button
                    key={a.id}
                    type="button"
                    className={`hv5-em-t hv5-em-${face.size}`}
                    data-eid={a.id}
                    data-field={t.field}
                    style={{
                      ...tileStyle(s),
                      ...(heat ? heatStyle(a) : null),
                      ...(clipped ? { padding: `${8 + s.ct}px ${8 + s.cr}px ${8 + s.cb}px ${8 + s.cl}px` } : null),
                    }}
                    tabIndex={a.id === tabId ? 0 : -1}
                    aria-pressed={selected?.id === a.id}
                    aria-label={aria}
                    onClick={(event) => {
                      if (event.detail > 1) return
                      selBefore.current = { id: sel, at: event.timeStamp }
                      select(a.id)
                    }}
                  >
                    {face.pic ? <EmotePic a={a} size={face.pic} /> : null}
                    {face.name || face.val ? (
                      <span className="hv5-em-ft">
                        {face.name ? <span className="hv5-em-nm">{a.e.name}</span> : null}
                        {face.val ? <span className="hv5-em-v">{t.share}</span> : null}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
            {layout && W > 0 && VH > 0 ? (
              <div className="hv5-em-mini" aria-hidden="true" data-on={zoomed || undefined} style={{ height: px((MINI_W * VH) / W) }}>
                {layout.fields.map((f) => (
                  <i key={f.field} style={{ left: px((f.x / W) * MINI_W), top: px((f.y / W) * MINI_W), width: px((f.w / W) * MINI_W), height: px((f.h / W) * MINI_W) }} />
                ))}
                <b style={{ left: px((-zoom.tx / zoom.k / W) * MINI_W), top: px((-zoom.ty / zoom.k / W) * MINI_W), width: px(MINI_W / zoom.k), height: px((MINI_W * VH) / W / zoom.k) }} />
              </div>
            ) : null}
          </div>
          <p className="hv5-vh" id={HELP_ID}>Arrow keys move between emotes. Enter selects one and lists where it led chat.</p>
          <div className="hv5-em-foot">
            {heat ? (
              <span className="hv5-em-heat">
                Cooling<b aria-hidden="true" />Taking off<span>last hour vs its {data.windowLabel} pace</span>
              </span>
            ) : null}
            <span className="hv5-em-lg">
              {layout?.fields.map((f) => (
                <button key={f.field} type="button" data-field={f.field} aria-label={`Zoom into ${f.name}, ${f.share} of uses`} onClick={() => flyTo(f)}>
                  {heat ? null : <i aria-hidden="true" />}{f.name}<b>{f.share}</b>
                </button>
              ))}
            </span>
            <button
              type="button"
              className="hv5-qb hv5-em-tall"
              aria-expanded={tall.on}
              onClick={() => {
                hide()
                setTall((prev) => ({ on: !prev.on, from: prev.on ? 0 : Math.round(mapRef.current?.clientHeight ?? 0) }))
              }}
            >
              {tall.on ? 'Shorter map' : 'Taller map'}
            </button>
          </div>
          <div className="hv5-el">
            {selected ? (
              <>
                <div className="hv5-el-h">
                  <span className="hv5-el-ti">
                    <EmotePic a={selected} size={24} />
                    <b>{selected.e.name}</b>
                    <span>{shareOf(emoteMapValue(selected, view))} of all uses · {providerName(selected.prov)}</span>
                  </span>
                  {hourOk ? <Chg c={emoteChange(selected, data.windowLabel)} /> : null}
                  <button type="button" className="hv5-el-clear" onClick={() => setSel(null)}>Clear ✕</button>
                </div>
                <p className="hv5-el-sub">Where {selected.e.name} led chat on streams live now · × is emotes against the 15 minutes before</p>
                {spammed.length ? (
                  <ol className="hv5-el-cols" key={`m|${selected.id}`}>
                    {spammed.map((r, i) => (
                      <li key={r.key} style={{ animationDelay: `${i * 18}ms` }}>
                        <Link to={r.href} className="hv5-el-r" aria-label={momentRowAria(r)}>
                          <span className="hv5-el-i">{i + 1}</span>
                          <HubV5Avatar login={r.login} name={r.displayName} src={r.moment.profileImageUrl || avatars?.get(r.login)} size={24} />
                          <span className="hv5-el-n">{r.displayName}<small>{r.moment.category || 'No category'}</small></span>
                          {'x' in r.cmp ? <span className="hv5-el-v hv5-el-x">{formatHubMultiplier(r.cmp.x)}</span> : <span className="hv5-el-v" title={r.cmp.long}>{r.cmp.why}</span>}
                          <span className="hv5-el-v">{r.at != null ? feedAgo(r.at, nowMs) : ''}</span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="hv5-el-none">No live moment led with {selected.e.name} right now.</p>
                )}
                <div className="hv5-el-foot"><Link to="/analytics/moments">Open in Moments →</Link></div>
              </>
            ) : (
              <>
                <div className="hv5-el-h">
                  <b>Most used</b>
                  <span>share of uses, {windowWords}{hourOk ? ` · ↗↘ last hour vs its ${data.windowLabel} pace` : ''}</span>
                </div>
                <ol className="hv5-el-cols" key={`t|${view}`}>
                  {(layout?.ranked ?? []).slice(0, 10).map((x, i) => (
                    <li key={x.a.id} style={{ animationDelay: `${i * 18}ms` }}>
                      <button
                        type="button"
                        className="hv5-el-r"
                        aria-label={`#${i + 1} ${x.a.e.name}, ${providerName(x.a.prov)}, ${shareOf(x.v)} of uses${hourOk ? `, ${emoteChange(x.a, data.windowLabel).words}` : ''}. Shows where it led chat.`}
                        onClick={() => select(x.a.id)}
                      >
                        <span className="hv5-el-i">{i + 1}</span>
                        <span className="hv5-el-im"><EmotePic a={x.a} size={24} /></span>
                        <span className="hv5-el-n">{x.a.e.name}<small>{providerName(x.a.prov)}</small></span>
                        <span className="hv5-el-v">{shareOf(x.v)}</span>
                        {hourOk ? <Chg c={emoteChange(x.a, data.windowLabel)} /> : <span />}
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
          {onAgg && layout && typeof document !== 'undefined'
            ? createPortal(
              <div ref={cardRef} className="hub-d3-layer hv5-layer hv5-em-card" aria-hidden="true" style={{ left: 0, top: 0, visibility: 'hidden' }}>
                <EmoteCard a={onAgg} data={data} win={view} total={layout.total} />
              </div>,
              document.body,
            )
            : null}
        </>
      ) : loading ? (
        <div className="hv5-em-map hv5-em-skel" aria-hidden="true" />
      ) : (
        <p className="hv5-none">{unavailable ? 'Unavailable right now.' : 'No emote counts in this window yet.'}</p>
      )}
    </section>
  )
}
