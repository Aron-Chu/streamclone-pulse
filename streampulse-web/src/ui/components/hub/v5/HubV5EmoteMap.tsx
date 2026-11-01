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
 * The engine (A and M1, 10-31 board): the map is laid out once per answer and
 * one camera moves over it by CSS transitions the compositor runs, so zooming
 * and panning never re-render the tiles; once the camera rests, the tiles near
 * the view take the face their size on screen allows, and the 8 most used
 * pictures on screen move while the rest show a still. A poll keeps the rows
 * and glides what moved on a spring; another window, or a poll that would move
 * most tiles far, fades to the new layout instead.
 * Under the map, the ten most used emotes with the last hour against their own
 * pace as a change chip. A click on a tile or a row selects the emote (C1,
 * 10-30 board): the list turns into its uses per interval with the busiest one
 * marked, the streams in that interval that had it in their top 3 (one
 * hub/moments read, cached), then the hub's live moments it led; each row
 * opens its minute in Moments. Hover (or focus) shows an emote's numbers;
 * arrow keys move to the nearest tile, Home and End to the ends, with one tab
 * stop. The window chips (W1, 10-30 board) re-cut the tiles from the same
 * answer; Taller map gives 1.8 times the height.
 */
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent as ReactFocusEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { sanitizeEmoteImageUrl } from '../../../../lib/emoteAssetUrl'
import { loadHubIntervalMoments, readHubIntervalMoments, type HubIntervalMomentsState, type HubIntervalRequest } from '../../../../lib/hubIntervalMoments'
import type { HubApiWindow } from '../../../../lib/hubWindows'
import type { HubActivityPoint, HubEmote, HubLivePulseMoment } from '../../../../lib/publicHub'
import { useMatchMedia } from '../../../hooks/useMatchMedia'
import { HubToggletip } from '../d3/HubToggletip'
import { HubV5Avatar } from './HubV5Avatar'
import {
  EMOTE_ZOOM_MAX,
  MAP_VIEW_1X,
  NO_TILE_FITS,
  clampMapView,
  emoteChange,
  emoteDrivers,
  emoteFlagKey,
  emoteImageAt,
  emoteInWindow,
  emoteIntervalLabel,
  emoteMapChips,
  emoteMapData,
  emoteMapHeight,
  emoteMapMeta,
  emoteMapNext,
  emoteMapTip,
  emoteMapValue,
  emoteMomentRows,
  emoteSharePct,
  emotePerMinute,
  emoteSpike,
  emoteWindowLabel,
  emoteWindowWords,
  fieldMapView,
  mapViewShowing,
  nearestTile,
  paceHeat,
  playingTiles,
  providerName,
  springCurve,
  tileFits,
  tilePicUrl,
  zoomMapAt,
  type EmoteChange,
  type EmoteDriver,
  type EmoteSpike,
  type HubEmoteAgg,
  type HubEmoteMapData,
  type HubEmoteWindow,
  type MapField,
  type MapLayer,
  type MapLayout,
  type MapShown,
  type MapTile,
  type MapView,
  type Rect,
  type TileFit,
} from './hubV5EmoteMapModel'
import { feedAgo } from './hubV5FeedModel'
import { formatHubInt, formatHubMultiplier, hubClock, momentHref, momentRowAria, momentRowKey, momentRowsV5 } from './hubV5Model'
import { isFocusVisible, placeHubV5Card } from './hubV5HoverCard'

const H_ID = 'hv5-te-h'
const META_ID = 'hv5-em-meta'
const HELP_ID = 'hv5-em-help'
const px = (n: number) => `${n.toFixed(1)}px`
/** Map units: the camera scales them up to 8×, so they keep two decimals. */
const mpx = (n: number) => `${n.toFixed(2)}px`
/** Z1: the field labels sit on the frames' top line, so the tiles start this far down. */
const LABEL_TOP = 12
const MINI_W = 96
/** A (10-31): how long the camera takes, by what moved it; a drag, a pinch, the keyboard and reduced motion follow at once. */
const WHEEL_MS = 160
const BUTTON_MS = 260
const FLY_MS = 420
const CAM_EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)'
/** The camera rests this long after its glide ends; then the tiles near the view re-fit. */
const SETTLE_MS = 120
/** M1 (10-31): a glide on its spring and a newcomer's rise; a dropped tile and an old layer fade as long as the CSS says. */
const GLIDE_MS = 460
const ENTER_MS = 340
const GONE_MS = 180
const FADE_MS = 200
const NO_TILES: readonly MapTile[] = []
const NO_LAYERS: readonly MapLayer[] = []
const NO_IDS: ReadonlySet<string> = new Set()

const cssEscape = (s: string) => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'))

let springEasing: string | null = null
/** M1's spring as a CSS linear() easing; the hub's ease where a browser has no linear(). */
function springEase(): string {
  if (springEasing == null) {
    const ok = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('animation-timing-function', 'linear(0, 1)')
    springEasing = ok ? `linear(${springCurve().map((p) => Number(p.toFixed(4))).join(', ')})` : CAM_EASE
  }
  return springEasing
}

/** The camera's transform: none at 1×, so the whole map draws as it does unzoomed. */
const camTransform = (v: MapView) => (v.k === 1 && v.tx === 0 && v.ty === 0 ? 'none' : `translate(${v.tx}px, ${v.ty}px) scale(${v.k})`)

/** A tile or a frame in map units, 1 px in on every side at the resting zoom (--iz is 1 / zoom), so the seams stay 2 px on screen. */
function cellStyle(r: Rect): CSSProperties {
  return {
    left: `calc(${mpx(r.x)} + 1px * var(--iz, 1))`,
    top: `calc(${mpx(r.y)} + 1px * var(--iz, 1))`,
    width: `max(1px * var(--iz, 1), ${mpx(r.w)} - 2px * var(--iz, 1))`,
    height: `max(1px * var(--iz, 1), ${mpx(r.h)} - 2px * var(--iz, 1))`,
  }
}

/** K1: the rising or cooling colour mixed into the tile's dark fill (and its hover fill). */
function heatStyle(a: HubEmoteAgg): CSSProperties | null {
  const h = paceHeat(a)
  if (!h) return null
  const c = h.dir === 'up' ? 'var(--hv5-rise)' : 'var(--hv5-cool)'
  return { '--bg': `color-mix(in oklab, ${c} ${h.mix}%, #17171a)`, '--bgh': `color-mix(in oklab, ${c} ${h.mix + 8}%, #1e1e22)` } as CSSProperties
}

/** 7TV has a still frame only for an animated emote: the hub's top list says which are. */
function animatedFlags(top: readonly HubEmote[] | undefined): ReadonlySet<string> {
  const out = new Set<string>()
  for (const e of top ?? []) if (e.animated) out.add(emoteFlagKey(e.provider, e.name))
  return out
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

/** Stills that failed to load: their emote shows its moving file from then on. */
const noStill = new Set<string>()

/**
 * A map picture (A, 10-31): the file for the tile's size on screen, a still
 * unless it is one of the pictures that move. A new file is decoded before it
 * replaces the one on show, so nothing blinks; a still that fails falls back
 * to the moving file.
 */
const TilePic = memo(function TilePic({ url, size, play, animated }: { url?: string; size: number; play: boolean; animated: boolean }) {
  const dpr = Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
  const moving = sanitizeEmoteImageUrl(tilePicUrl(url, size, true, animated, dpr))
  const still = play ? moving : sanitizeEmoteImageUrl(tilePicUrl(url, size, false, animated, dpr))
  const want = still && noStill.has(still) ? moving : still
  const [src, setSrc] = useState(want)
  useEffect(() => {
    if (!want || want === src) return undefined
    let live = true
    const next = new Image()
    next.referrerPolicy = 'no-referrer'
    next.src = want
    const swap = () => { if (live) setSrc(want) }
    if (typeof next.decode === 'function') next.decode().then(swap, swap)
    else next.onload = swap
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
      onLoad={(event) => { event.currentTarget.style.visibility = '' }}
      onError={(event) => {
        if (src === moving) {
          event.currentTarget.style.visibility = 'hidden'
          return
        }
        noStill.add(src)
        setSrc(moving)
      }}
    />
  ) : null
})

interface TileProps {
  t: MapTile
  fit: TileFit | undefined
  heat: boolean
  play: boolean
  animated: boolean
  tab: boolean
  pressed: boolean
  label: string
  /** Dropped by a glide: it fades where it was. */
  gone?: boolean
}

/** A tile: its plate (the fill and the rings) and its content, which the resting zoom counter-scales to screen pixels. */
const Tile = memo(function Tile({ t, fit, heat, play, animated, tab, pressed, label, gone }: TileProps) {
  const face = fit?.face ?? t
  return (
    <button
      type="button"
      className={`hv5-em-t hv5-em-${face.size}`}
      data-eid={t.a.id}
      data-field={t.field}
      data-out={gone || undefined}
      style={heat ? { ...cellStyle(t), ...heatStyle(t.a) } : cellStyle(t)}
      tabIndex={tab ? 0 : -1}
      aria-pressed={pressed}
      aria-label={label}
      aria-hidden={gone || undefined}
    >
      <span className="hv5-em-pl" />
      {/* most tiles are bare dots: no content box, so a layer builds about 40% fewer elements */}
      {face.pic || face.name || face.val ? (
        <span className="hv5-em-c" style={fit?.pad ? { padding: fit.pad } : undefined}>
          {face.pic ? <TilePic url={t.a.e.imageUrl} size={face.pic} play={play} animated={animated} /> : null}
          {face.name || face.val ? (
            <span className="hv5-em-ft">
              {face.name ? <span className="hv5-em-nm">{t.a.e.name}</span> : null}
              {face.val ? <span className="hv5-em-v">{t.share}</span> : null}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  )
})

interface TileLayerProps {
  gen: number
  layout: MapLayout
  gone: readonly MapTile[]
  out: boolean
  fits: ReadonlyMap<string, TileFit>
  playing: ReadonlySet<string>
  hoverId: string | null
  tabId: string | null
  selId: string | null
  heat: boolean
  animatedSet: ReadonlySet<string>
  words: string
  hourOk: boolean
  windowLabel: string
}

/**
 * One layout's frames and tiles. A layer that fades out keeps what it showed,
 * since the live map's faces and pictures are for the new layout.
 */
const TileLayer = memo(function TileLayer(props: TileLayerProps) {
  const kept = useRef(props)
  if (!props.out) kept.current = props
  const { gen, layout, gone, fits, playing, hoverId, tabId, selId, heat, animatedSet, words, hourOk, windowLabel } = props.out ? kept.current : props
  const out = props.out
  const labels = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of [...layout.tiles, ...gone]) {
      const a = t.a
      m.set(a.id, `#${t.rank} ${a.e.name}, ${providerName(a.prov)}, ${formatHubInt(t.v)} uses in the ${words}, ${t.share} of the map${hourOk ? `, ${emoteChange(a, windowLabel).words}` : ''}.`)
    }
    return m
  }, [layout, gone, words, hourOk, windowLabel])
  const tile = (t: MapTile, isGone: boolean) => (
    <Tile
      key={t.a.id}
      t={t}
      fit={isGone ? undefined : fits.get(t.a.id)}
      heat={heat}
      play={!isGone && (playing.has(t.a.id) || hoverId === t.a.id)}
      animated={animatedSet.has(emoteFlagKey(t.a.prov, t.a.e.name))}
      tab={!out && !isGone && tabId === t.a.id}
      pressed={!isGone && selId === t.a.id}
      label={labels.get(t.a.id) ?? ''}
      gone={isGone}
    />
  )
  return (
    <div className="hv5-em-ly" data-gen={gen} data-out={out || undefined} aria-hidden={out || undefined}>
      {layout.fields.map((f) => (
        <div key={f.field} className="hv5-em-ff" data-field={f.field} style={cellStyle(f)} aria-hidden="true" />
      ))}
      {gone.map((t) => tile(t, true))}
      {layout.tiles.map((t) => tile(t, false))}
    </div>
  )
})

/**
 * M1's glide, FLIP style: each tile already sits in its new place and starts
 * from its old one. The plate morphs (a move and a scale) while the content
 * only slides, so text never stretches; a newcomer rises in, and the frames
 * morph like plates. A tile too small to see, or off screen before and after,
 * just jumps.
 */
function glideLayer(cam: HTMLElement, from: MapLayout, to: MapLayer, v: MapView, iz: number, W: number, H: number): Animation[] {
  const layer = cam.querySelector<HTMLElement>(`.hv5-em-ly[data-gen="${to.gen}"]`)
  if (!layer || typeof layer.animate !== 'function') return []
  const ease = springEase()
  const out: Animation[] = []
  const zoomed = v.k > 1 + 1e-3
  const x0 = -v.tx / v.k
  const y0 = -v.ty / v.k
  const x1 = (W - v.tx) / v.k
  const y1 = (H - v.ty) / v.k
  const onView = (r: Rect) => r.x + r.w > x0 && r.x < x1 && r.y + r.h > y0 && r.y < y1
  const moved = (a: Rect, b: Rect) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.w - b.w), Math.abs(a.h - b.h)) * v.k >= 1
  // from the old box to the new one, both 1 px in at the resting zoom
  const morph = (a: Rect, b: Rect) => `translate(${a.x - b.x}px, ${a.y - b.y}px) scale(${Math.max(0.01, (a.w - 2 * iz) / Math.max(iz, b.w - 2 * iz))}, ${Math.max(0.01, (a.h - 2 * iz) / Math.max(iz, b.h - 2 * iz))})`
  const tiles = new Map<string, HTMLElement>()
  const frames = new Map<string, HTMLElement>()
  for (const el of layer.children) {
    if (!(el instanceof HTMLElement) || el.dataset.out != null) continue
    if (el.dataset.eid) tiles.set(el.dataset.eid, el)
    else if (el.dataset.field) frames.set(el.dataset.field, el)
  }
  const was = new Map(from.tiles.map((t) => [t.a.id, t]))
  to.layout.tiles.forEach((b, i) => {
    const el = tiles.get(b.a.id)
    const plate = el?.firstElementChild
    // a bare dot has no content box
    const content = el?.children[1]
    if (!(plate instanceof HTMLElement) || Math.max(b.w, b.h) * v.k < 10) return
    const a = was.get(b.a.id)
    if (!a) {
      if (zoomed && !onView(b)) return
      const delay = Math.min(240, i * 1.5)
      out.push(plate.animate([{ opacity: 0, transform: 'translate(4%, 4%) scale(0.92)' }, { opacity: 1, transform: 'none' }], { duration: ENTER_MS, delay, easing: ease, fill: 'backwards' }))
      if (content instanceof HTMLElement) out.push(content.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, delay: delay + 60, fill: 'backwards' }))
      return
    }
    if (!moved(a, b) || (zoomed && !onView(a) && !onView(b))) return
    out.push(plate.animate([{ transform: morph(a, b) }, { transform: 'none' }], { duration: GLIDE_MS, easing: ease }))
    if (content instanceof HTMLElement) out.push(content.animate([{ translate: `${a.x - b.x + (a.w - b.w) / 2}px ${a.y - b.y + (a.h - b.h) / 2}px` }, { translate: '0px 0px' }], { duration: GLIDE_MS, easing: ease }))
  })
  const wasField = new Map(from.fields.map((f) => [f.field, f]))
  for (const f of to.layout.fields) {
    const el = frames.get(f.field)
    const a = wasField.get(f.field)
    if (el && a && moved(a, f)) out.push(el.animate([{ transform: morph(a, f) }, { transform: 'none' }], { duration: GLIDE_MS, easing: ease }))
  }
  return out
}

function EmoteCard({ a, data, win, total }: { a: HubEmoteAgg; data: HubEmoteMapData; win: HubEmoteWindow; total: number }) {
  const w = emoteInWindow(data, a, win)
  const src = sanitizeEmoteImageUrl(emoteImageAt(a.e.imageUrl, 48))
  return (
    <>
      <div className="hv5-ec-h">
        <span className="hv5-ec-im">{src ? <img src={src} alt="" width={40} height={40} referrerPolicy="no-referrer" /> : null}</span>
        <span className="hv5-ec-tx"><b>{a.e.name}</b><span>{providerName(a.prov)}</span></span>
      </div>
      <dl className="hv5-ec-dl">
        <dt>Uses, {emoteWindowWords(data, win)}</dt>
        <dd>{formatHubInt(w.v)} <span>· {emoteSharePct(total > 0 ? (w.v / total) * 100 : 0)} of the map</span></dd>
        {data.paceOk ? (
          <>
            <dt>Last hour</dt>
            <dd>{formatHubInt(a.c1h)} <Chg c={emoteChange(a, data.windowLabel)} /> <span>vs its pace</span></dd>
          </>
        ) : null}
        <dt>Busiest</dt>
        <dd>{emotePerMinute(w.peak, data.bucketMinutes)}/min <span>· {emoteIntervalLabel(data, win, w.peakT)}</span></dd>
        <dt>In a top 10</dt>
        <dd>{w.n} <span>of {w.intervals} intervals</span></dd>
      </dl>
    </>
  )
}

const BARS_H = 40

/**
 * C1's timeline: a bar per interval of the window, the busiest marked, a faint
 * tick where it made no top 10, nothing where the hub sent no list.
 */
function SpikeBars({ spike, label }: { spike: EmoteSpike; label: string }) {
  const n = spike.bars.length
  const pad = n > 120 ? 0.08 : 0.14
  return (
    <svg className="hv5-es-bars" viewBox={`0 0 ${n} ${BARS_H}`} preserveAspectRatio="none" role="img" aria-label={label}>
      {spike.bars.map((c, i) => {
        if (c === undefined) return null
        if (c === null) return <rect key={i} className="hv5-es-gap" x={i + pad} y={BARS_H - 1} width={1 - 2 * pad} height={1} />
        const h = spike.peakCount > 0 ? Math.max(2, (c / spike.peakCount) * BARS_H) : 2
        return <rect key={i} className={i === spike.peak ? 'hv5-es-hi' : undefined} x={i + pad} y={BARS_H - h} width={1 - 2 * pad} height={h} />
      })}
    </svg>
  )
}

function driverAria(d: EmoteDriver, emote: string): string {
  const name = d.m.displayName || d.m.login
  const when = d.m.at != null ? ` at ${hubClock(d.m.at)}` : ''
  return `${name}, ${d.m.category || 'game not sent'}, ${formatHubInt(d.uses)} ${emote} uses in its busiest minute${when}. Opens that minute in Moments.`
}

/**
 * C1's "Who drove it": one hub/moments read for the busiest interval, through
 * the tab cache the chart's interval list shares (30 min), keeping the
 * streams that had the emote in their top 3. Rows carry no ×: they come with no
 * comparison. One status line says each state, so a screen reader hears the
 * rows land or the read fail.
 */
function EmoteDrivers({ a, peakT, bucketMinutes, intervalWindow, behind, avatars }: {
  a: HubEmoteAgg
  peakT: number
  bucketMinutes: number
  intervalWindow: HubApiWindow
  /** The backend serves its live-pool fallback: an empty read means the interval isn't in yet. */
  behind?: boolean
  avatars?: ReadonlyMap<string, string>
}) {
  const request = useMemo<HubIntervalRequest>(() => ({ t: peakT, activityWindow: intervalWindow, bucketMinutes }), [peakT, intervalWindow, bucketMinutes])
  const key = `${intervalWindow}|${bucketMinutes}|${peakT}`
  // the cache first, so a read from the last 30 minutes shows on the first frame
  const cached = useMemo(() => readHubIntervalMoments(request), [request])
  const [got, setGot] = useState<{ key: string; s: HubIntervalMomentsState } | null>(null)
  const state = got?.key === key ? got.s : cached
  useEffect(() => {
    if (readHubIntervalMoments(request)) return undefined
    const ctrl = new AbortController()
    const put = (s: HubIntervalMomentsState) => { if (!ctrl.signal.aborted) setGot({ key, s }) }
    loadHubIntervalMoments(request, { signal: ctrl.signal, onProgress: put })
      .then(put, (error: unknown) => put({ status: 'error', error, retryAfterMs: null, bucketsRead: 0, bucketsTotal: 1 }))
    return () => ctrl.abort()
  }, [request, key])

  const loading = !state || state.status === 'loading'
  const drivers = state?.status === 'ready' ? emoteDrivers(state.rows, a) : []
  // the page's own window decides the read: a chip can't make it shorter
  const note = !state || state.status === 'loading' ? null
    : state.status === 'zoom-in' ? 'Set the time window to 7 days or less to see streams.'
      : state.status === 'error' || state.status === 'unavailable' ? 'Couldn’t load the streams for that interval.'
        : state.status === 'empty' ? (behind ? 'The streams for that interval aren’t in yet.' : 'No streams were listed for that interval.')
          : drivers.length ? null : `None of the busiest chats in that interval had ${a.e.name} in their top 3.`
  const say = loading
    ? 'Loading the streams for that interval.'
    : note ?? `${drivers.length} ${drivers.length === 1 ? 'stream' : 'streams'} in that interval had ${a.e.name} in their top 3.`
  return (
    <div aria-busy={loading || undefined}>
      <p className={note ? 'hv5-el-none' : 'hv5-vh'} role="status">{say}</p>
      {loading ? (
        <ol className="hv5-el-cols hv5-es-rows" aria-hidden="true">
          {[0, 1, 2].map((i) => <li key={i} className="hv5-es-ph" />)}
        </ol>
      ) : drivers.length ? (
        <ol className="hv5-el-cols hv5-es-rows" key={key}>
          {drivers.map((d, i) => (
            <li key={momentRowKey(d.m)} style={{ animationDelay: `${i * 18}ms` }}>
              <Link to={momentHref(d.m)} className="hv5-el-r" aria-label={driverAria(d, a.e.name)}>
                <span className="hv5-el-i">{i + 1}</span>
                <HubV5Avatar login={d.m.login!} name={d.m.displayName || d.m.login!} src={d.m.profileImageUrl || avatars?.get(d.m.login!)} size={24} />
                <span className="hv5-el-n">{d.m.displayName || d.m.login}<small>{d.m.category || 'No category'}</small></span>
                <span className="hv5-el-v hv5-es-uses">{formatHubInt(d.uses)} uses</span>
                <span className="hv5-el-v hv5-es-at">{d.m.at != null ? `▶ ${hubClock(d.m.at)}` : ''}</span>
              </Link>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
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
  intervalWindow,
  historyBehind,
  topEmotes,
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
  /** The window whose bucket grid the answer uses (30m on the live-pool fallback): C1 reads its busiest interval on it. No read without one. */
  intervalWindow?: HubApiWindow
  /** "24-hour history is behind right now" while the backend serves its live-pool fallback (the chart's IRC-2 pick A words). */
  historyBehind?: string | null
  /** The hub's top emotes: which are animated, so a 7TV still is asked for only those (A). */
  topEmotes?: readonly HubEmote[]
}) {
  const data = useMemo(() => emoteMapData(points, bucketMinutes), [points, bucketMinutes])
  const phone = useMatchMedia('(max-width: 719px)')
  const reduce = useMatchMedia('(prefers-reduced-motion: reduce)')
  const [win, setWin] = useState<HubEmoteWindow>('all')
  const chips = useMemo(() => (data ? emoteMapChips(data) : []), [data])
  // n counts the clicks, so the resize each one causes glides (M1)
  const [tall, setTall] = useState<{ on: boolean; from: number; n: number }>({ on: false, from: 0, n: 0 })
  const [tallGlided, setTallGlided] = useState(0)
  const mapRef = useRef<HTMLDivElement>(null)
  const vpRef = useRef<HTMLDivElement>(null)
  const camRef = useRef<HTMLDivElement>(null)
  const readRef = useRef<HTMLSpanElement>(null)
  const miniBoxRef = useRef<HTMLElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [focusId, setFocusId] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [on, setOn] = useState<{ id: string; el: HTMLElement } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  // A: the camera. The goal is where it is going (the handlers start from it); settled is where it last rested (the tiles' faces follow that)
  const goalRef = useRef<MapView>(MAP_VIEW_1X)
  const settledRef = useRef<MapView>(MAP_VIEW_1X)
  const [settled, setSettled] = useState<MapView>(MAP_VIEW_1X)
  const [edge, setEdge] = useState({ zoomed: false, max: false })
  const movingRef = useRef(false)
  const settleT = useRef<number | undefined>(undefined)
  const vpBox = useRef<DOMRect | null>(null)
  const [panning, setPanning] = useState(false)
  const drag = useRef<{ id: number; x: number; y: number; v: MapView; moved: boolean } | null>(null)
  const fingers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<number | null>(null)
  const dragged = useRef(false)
  const selBefore = useRef<{ id: string | null; at: number } | null>(null)
  const anims = useRef<Animation[]>([])
  const fitsRef = useRef<ReadonlyMap<string, TileFit>>(NO_TILE_FITS)
  const [shown, setShown] = useState<MapShown | null>(null)

  const hourOk = Boolean(data?.paceOk)
  const heat = hourOk
  // a chip this answer no longer has (another page window) falls back to the whole answer
  const pressed: HubEmoteWindow = chips.some((c) => c.win === win) ? win : 'all'
  // the chip shows pressed in the click's own frame; the map's new layer (over a thousand fresh elements to style) follows in the next
  const mapWin = useDeferredValue(win)
  const view: HubEmoteWindow = chips.some((c) => c.win === mapWin) ? mapWin : 'all'
  // min-height: the map grows to fill a taller grid row
  const prefH = size.w ? emoteMapHeight(size.w, phone, tall.on, tall.from) : (phone ? 320 : 340)
  const W = size.w
  const VH = Math.max(0, size.h - LABEL_TOP)
  const dims = useRef({ W, VH })
  const reduceRef = useRef(reduce)
  useLayoutEffect(() => {
    dims.current = { W, VH }
    reduceRef.current = reduce
  })
  const zoomed = settled.k > 1 + 1e-3

  // M1: a new answer, window or size works out the next layout and how the map gets there
  let cur = shown
  if (!data) {
    if (cur) {
      cur = null
      setShown(null)
    }
  } else if (!cur || cur.data !== data || cur.win !== view || cur.W !== W || cur.H !== VH) {
    const glideResize = cur != null && (cur.W !== W || cur.H !== VH) && tall.n !== tallGlided
    cur = emoteMapNext(cur, data, view, W, VH, { reduce, glideResize })
    setShown(cur)
    if (glideResize) setTallGlided(tall.n)
  }
  const layers = cur?.layers ?? NO_LAYERS
  const goneTiles = cur?.gone ?? NO_TILES
  const layout: MapLayout | null = layers.length ? layers[layers.length - 1]!.layout : null

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
  const selected = selAgg && data && emoteMapValue(selAgg, view, data) > 0 ? selAgg : null
  const spammed = useMemo(() => (selected ? emoteMomentRows(momentRows, selected) : []), [selected, momentRows])
  const spike = useMemo(() => (selected && data ? emoteSpike(data, selected, view) : null), [data, selected, view])

  // A: once the camera rests, the tiles near the view take the face their size on screen allows, and 8 pictures move
  const fits = useMemo(
    () => (layout ? tileFits(layout.tiles, settled, W, VH, fitsRef.current) : NO_TILE_FITS),
    [layout, settled, W, VH],
  )
  useLayoutEffect(() => {
    fitsRef.current = fits
  }, [fits])
  const playing = useMemo(() => (layout ? playingTiles(layout.tiles, settled, W, VH, fits) : NO_IDS), [layout, settled, W, VH, fits])
  const animatedSet = useMemo(() => animatedFlags(topEmotes), [topEmotes])

  const hide = useCallback(() => {
    window.clearTimeout(timer.current)
    setOn(null)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  // a poll or a resize keeps the card on its emote while the emote is still drawn; a fade hands it to the same tile in the new layer
  useEffect(() => {
    if (!on) return
    if (!data?.byId.has(on.id)) {
      hide()
      return
    }
    if (on.el.isConnected && !on.el.closest('[data-out]')) return
    const el = camRef.current?.querySelector<HTMLElement>(`.hv5-em-ly:not([data-out]) > .hv5-em-t[data-eid="${cssEscape(on.id)}"]:not([data-out])`)
    if (el) setOn({ id: on.id, el })
    else hide()
  }, [cur, data, on, hide])
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
  // the card waits for the camera to rest, then sits by its tile
  useLayoutEffect(() => {
    if (on && on.el.isConnected && cardRef.current && !movingRef.current) placeHubV5Card(cardRef.current, on.el, vpRef.current)
  }, [on, layout, settled])

  /* ---------- A: one camera, moved by CSS transitions; the readout, mini map and buttons follow it ---------- */
  const paintZoom = useCallback((v: MapView, ms: number) => {
    if (readRef.current) readRef.current.textContent = `${v.k.toFixed(1)}×`
    const box = miniBoxRef.current
    const { W: w, VH: h } = dims.current
    if (box && w > 0 && h > 0) {
      const tr = ms > 0 ? `left ${ms}ms ${CAM_EASE}, top ${ms}ms ${CAM_EASE}, width ${ms}ms ${CAM_EASE}, height ${ms}ms ${CAM_EASE}` : 'none'
      if (box.style.transition !== tr) box.style.transition = tr
      box.style.left = px((-v.tx / v.k / w) * MINI_W)
      box.style.top = px((-v.ty / v.k / w) * MINI_W)
      box.style.width = px(MINI_W / v.k)
      box.style.height = px((MINI_W * h) / w / v.k)
    }
    const z = v.k > 1 + 1e-3
    const max = v.k >= EMOTE_ZOOM_MAX - 1e-3
    setEdge((prev) => (prev.zoomed === z && prev.max === max ? prev : { zoomed: z, max }))
  }, [])
  const settleCam = useCallback(() => {
    movingRef.current = false
    vpBox.current = null
    if (camRef.current) camRef.current.style.willChange = ''
    mapRef.current?.removeAttribute('data-moving')
    settledRef.current = goalRef.current
    setSettled(goalRef.current)
  }, [])
  /**
   * Retargets the camera's transition: the compositor runs it, so nothing
   * re-renders while it moves (a transform written every frame from script
   * rebuilt the layer list each frame: about 13 fps at 4× CPU).
   */
  const moveCam = useCallback((to: MapView, ms: number) => {
    const { W: w, VH: h } = dims.current
    const goal = clampMapView(to, w, h)
    goalRef.current = goal
    const cam = camRef.current
    if (!cam) return
    if (!movingRef.current) {
      movingRef.current = true
      mapRef.current?.setAttribute('data-moving', '')
      cam.style.willChange = 'transform'
      if (cardRef.current) cardRef.current.style.visibility = 'hidden'
    }
    const quick = reduceRef.current || ms <= 1
    const tr = quick ? 'transform 1ms linear' : `transform ${ms}ms ${CAM_EASE}`
    if (cam.style.transition !== tr) cam.style.transition = tr
    cam.style.transform = camTransform(goal)
    paintZoom(goal, quick ? 0 : ms)
    window.clearTimeout(settleT.current)
    // a drag rests when the pointer lets go
    if (!drag.current?.moved) settleT.current = window.setTimeout(settleCam, (quick ? 1 : ms) + SETTLE_MS)
  }, [paintZoom, settleCam])
  /** Straight back to the whole map, with no glide. */
  const jumpCam = useCallback(() => {
    window.clearTimeout(settleT.current)
    movingRef.current = false
    vpBox.current = null
    goalRef.current = MAP_VIEW_1X
    settledRef.current = MAP_VIEW_1X
    const cam = camRef.current
    if (cam) {
      cam.style.transition = ''
      cam.style.willChange = ''
      cam.style.transform = 'none'
    }
    mapRef.current?.removeAttribute('data-moving')
    paintZoom(MAP_VIEW_1X, 0)
    setSettled(MAP_VIEW_1X)
  }, [paintZoom])
  useEffect(() => () => {
    window.clearTimeout(settleT.current)
    for (const a of anims.current) a.cancel()
  }, [])
  // a new size or window lays the map out again: start from the whole map
  const hasMap = data != null
  useLayoutEffect(() => {
    jumpCam()
  }, [W, VH, view, hasMap, jumpCam])

  // M1: glide what moved, fade what went, and hand focus from a layer that fades out to the new one
  const tid = cur?.tid ?? 0
  useLayoutEffect(() => {
    for (const a of anims.current) a.cancel()
    anims.current = []
    const s = shown
    const cam = camRef.current
    if (!s || !cam || s.tid !== tid) return undefined
    const timers: number[] = []
    const liveLayer = s.layers[s.layers.length - 1]!
    if (s.move === 'glide' && s.from) {
      const { W: w, VH: h } = dims.current
      anims.current = glideLayer(cam, s.from, liveLayer, goalRef.current, 1 / settledRef.current.k, w, h)
    }
    if (s.gone.length) timers.push(window.setTimeout(() => setShown((p) => (p && p.tid === s.tid ? { ...p, gone: [] } : p)), GONE_MS))
    if (s.layers.length > 1) {
      // the layer fading out is already aria-hidden, out of the tab order and lets pointers through; inert would restyle all of it inside the click
      const active = document.activeElement
      for (const ly of cam.querySelectorAll<HTMLElement>('.hv5-em-ly[data-out]')) {
        if (active instanceof HTMLElement && ly.contains(active)) {
          const id = active.dataset.eid
          const next = (id ? cam.querySelector<HTMLElement>(`.hv5-em-ly:not([data-out]) > .hv5-em-t[data-eid="${cssEscape(id)}"]:not([data-out])`) : null)
            ?? cam.querySelector<HTMLElement>('.hv5-em-ly:not([data-out]) > .hv5-em-t[tabindex="0"]')
          next?.focus({ preventScroll: true })
        }
      }
      timers.push(window.setTimeout(() => setShown((p) => (p ? { ...p, layers: p.layers.filter((l) => !l.out) } : p)), FADE_MS))
    }
    return () => {
      for (const t of timers) window.clearTimeout(t)
    }
  }, [tid])

  const flyTo = (f: MapField) => {
    hide()
    moveCam(fieldMapView(f, W, VH), FLY_MS)
  }
  const zoomBy = (factor: number) => {
    hide()
    const v = goalRef.current
    moveCam(zoomMapAt(v, W / 2, VH / 2, v.k * factor, W, VH), BUTTON_MS)
  }
  const resetZoom = () => {
    hide()
    moveCam(MAP_VIEW_1X, FLY_MS)
  }
  /** A pointer's place in the view (the tiles' box, under the label strip); the box is read once a gesture. */
  const vpPoint = useCallback((x: number, y: number): [number, number] => {
    if (!movingRef.current || !vpBox.current) vpBox.current = vpRef.current?.getBoundingClientRect() ?? null
    const r = vpBox.current
    return r ? [x - r.left, y - r.top] : [0, 0]
  }, [])
  /** Where the camera is mid-glide: a drag that starts then takes it from there. */
  const liveView = (): MapView => {
    const cam = camRef.current
    if (!cam || typeof DOMMatrixReadOnly !== 'function') return goalRef.current
    const s = getComputedStyle(cam).transform
    if (!s || s === 'none') return MAP_VIEW_1X
    const m = new DOMMatrixReadOnly(s)
    return { k: m.a, tx: m.e, ty: m.f }
  }
  // the wheel zooms anywhere over the map; at either end of the range it goes back to the page
  useEffect(() => {
    const map = mapRef.current
    if (!map) return undefined
    const onWheel = (event: WheelEvent) => {
      const { W: w, VH: h } = dims.current
      const v = goalRef.current
      if (!event.cancelable || !w || !h || !event.deltaY || (event.deltaY < 0 ? v.k >= EMOTE_ZOOM_MAX - 1e-3 : v.k <= 1 + 1e-3)) {
        vpBox.current = null
        return
      }
      event.preventDefault()
      hide()
      const [x, y] = vpPoint(event.clientX, event.clientY)
      const dy = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * h : event.deltaY
      moveCam(zoomMapAt(v, x, y, v.k * Math.exp(-dy * 0.0022), w, h), WHEEL_MS)
    }
    map.addEventListener('wheel', onWheel, { passive: false })
    return () => map.removeEventListener('wheel', onWheel)
  }, [hasMap, hide, moveCam, vpPoint])
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
    if (goalRef.current.k <= 1 + 1e-3) return
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, v: goalRef.current, moved: false }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (fingers.current.has(event.pointerId)) fingers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pinch.current != null && fingers.current.size === 2) {
      const [p, q] = [...fingers.current.values()]
      const d = Math.hypot(p!.x - q!.x, p!.y - q!.y)
      if (pinch.current > 0 && d > 0) {
        const [x, y] = vpPoint((p!.x + q!.x) / 2, (p!.y + q!.y) / 2)
        const v = goalRef.current
        hide()
        moveCam(zoomMapAt(v, x, y, v.k * (d / pinch.current), W, VH), 1)
      }
      pinch.current = d
      dragged.current = true
      return
    }
    const d = drag.current
    if (!d || d.id !== event.pointerId) return
    if (!d.moved) {
      if (Math.hypot(event.clientX - d.x, event.clientY - d.y) < 4) return
      d.moved = true
      dragged.current = true
      mapRef.current?.setPointerCapture(event.pointerId)
      hide()
      setPanning(true)
      // mid-glide, the pan starts where the camera is, not where it was going
      if (movingRef.current) {
        d.v = liveView()
        d.x = event.clientX
        d.y = event.clientY
      }
    }
    moveCam({ k: d.v.k, tx: d.v.tx + event.clientX - d.x, ty: d.v.ty + event.clientY - d.y }, 1)
  }
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    fingers.current.delete(event.pointerId)
    if (fingers.current.size < 2) pinch.current = null
    if (drag.current?.id === event.pointerId) {
      const moved = drag.current.moved
      drag.current = null
      setPanning(false)
      if (moved) {
        window.clearTimeout(settleT.current)
        settleT.current = window.setTimeout(settleCam, SETTLE_MS)
      }
    }
  }
  // a drag or a pinch ends without a click on the tile under it
  const onClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!dragged.current) return
    dragged.current = false
    event.stopPropagation()
    event.preventDefault()
  }
  const select = (id: string) => setSel((prev) => (prev === id ? null : id))
  // one click handler for every tile
  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const el = event.target instanceof Element ? event.target.closest<HTMLElement>('button.hv5-em-t') : null
    const id = el?.dataset.eid
    if (!el || !id || el.closest('[data-out]') || event.detail > 1) return
    selBefore.current = { id: sel, at: event.timeStamp }
    select(id)
  }
  // a double-click zooms 3× at the point, or back out; its two clicks leave the selection as it was
  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('.hv5-em-fl')) return
    const before = selBefore.current
    if (before && event.timeStamp - before.at < 800) setSel(before.id)
    selBefore.current = null
    hide()
    const v = goalRef.current
    if (v.k > 1.01) {
      moveCam(MAP_VIEW_1X, FLY_MS)
      return
    }
    const [x, y] = vpPoint(event.clientX, event.clientY)
    moveCam(zoomMapAt(v, x, y, 3, W, VH), FLY_MS)
  }

  const itemOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('.hv5-em-t') : null)
  const onPointerOver = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' || drag.current?.moved || movingRef.current) return
    const el = itemOf(event.target)
    if (!el || el === on?.el || el.closest('[data-out]')) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      if (el.isConnected) setOn({ id: el.dataset.eid!, el })
    }, on ? 0 : 90)
  }
  // touch fires a leave after every tap
  const onPointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => { if (event.pointerType !== 'touch') hide() }
  const tiles = layout?.tiles ?? NO_TILES
  /** Zoomed in, the keyboard brings its tile into view. */
  const showTile = (t: MapTile) => {
    const to = mapViewShowing(goalRef.current, t, W, VH)
    if (to !== goalRef.current) moveCam(to, 1)
  }
  const onFocus = (event: ReactFocusEvent<HTMLDivElement>) => {
    const el = event.target instanceof Element ? event.target.closest<HTMLElement>('button.hv5-em-t') : null
    if (!el || !isFocusVisible(el)) return
    const t = tiles.find((x) => x.a.id === el.dataset.eid)
    if (t) showTile(t)
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
    const target = camRef.current?.querySelector<HTMLElement>(`.hv5-em-ly:not([data-out]) > button.hv5-em-t[data-eid="${cssEscape(next.a.id)}"]:not([data-out])`)
    if (!target) return
    setFocusId(next.a.id)
    showTile(next)
    // the view moves itself; the browser must not scroll the clipped map
    target.focus({ preventScroll: true })
  }

  const tabId = layout && tiles.some((t) => t.a.id === focusId) ? focusId : tiles[0]?.a.id ?? null
  const onAgg = on ? data?.byId.get(on.id) : undefined
  const meta = data && layout ? emoteMapMeta(data, layout, view, historyBehind) : ''
  const windowWords = data ? emoteWindowWords(data, view) : 'last 24 h'
  const shareOf = (v: number) => emoteSharePct(layout && layout.total > 0 ? (v / layout.total) * 100 : 0)
  const slot = (data?.bucketMinutes ?? 0) * 60_000
  const busiest = data && spike && spike.peak >= 0 ? emoteIntervalLabel(data, view, spike.peakT) : null
  const busiestRate = data && spike ? emotePerMinute(spike.peakCount, data.bucketMinutes) : ''
  // the timeline ends at the last closed interval: "now" only while that is recent, as on a saved copy it is not
  const fresh = data ? nowMs - data.t1 <= 2 * slot + 60_000 : false

  return (
    <section id="emotes" className="hv5-sec hv5-emotes" aria-labelledby={H_ID} aria-busy={loading || undefined}>
      <div className="hv5-rh hv5-em-rh">
        <h2 id={H_ID}>Top emotes</h2>
        {data ? <HubToggletip tip={emoteMapTip(data)} label="About the emote map" /> : null}
        {data ? (
          <span className="hv5-end">
            <span className="hv5-em-zoom" role="group" aria-label="Map zoom">
              {/* written as the camera moves, never by a render (A) */}
              <span ref={readRef} className="hv5-em-zr">1.0×</span>
              <button type="button" className="hv5-em-zb" aria-label="Zoom out" disabled={!edge.zoomed} onClick={() => zoomBy(1 / 1.6)}>−</button>
              <button type="button" className="hv5-em-zb" aria-label="Zoom in" disabled={edge.max} onClick={() => zoomBy(1.6)}>+</button>
              <button type="button" className="hv5-em-zb" disabled={!edge.zoomed} onClick={resetZoom}>Reset</button>
            </span>
            {chips.length ? (
              <span className="hv5-seg" role="group" aria-label="Emote map window">
                {chips.map((c) => (
                  <button key={String(c.win)} type="button" aria-pressed={pressed === c.win} onClick={() => { hide(); setWin(c.win) }}>{c.label}</button>
                ))}
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
            className={`hv5-em-map${panning ? ' hv5-em-pan' : ''}`}
            role="group"
            aria-labelledby={`${H_ID} ${META_ID}`}
            aria-describedby={HELP_ID}
            data-heat={heat || undefined}
            data-zoomed={zoomed || undefined}
            // at 1× one finger scrolls the page and two pinch the map; zoomed in, one finger pans
            style={{ '--em-h': `${prefH}px`, touchAction: edge.zoomed ? 'none' : 'pan-x pan-y' } as CSSProperties}
            onPointerOver={onPointerOver}
            onPointerLeave={onPointerLeave}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onClickCapture={onClickCapture}
            onClick={onClick}
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
              <div ref={camRef} className="hv5-em-cam" style={{ width: W, height: VH, '--iz': String(1 / settled.k) } as CSSProperties}>
                {layers.map((l, i) => {
                  const live = i === layers.length - 1
                  return (
                    <TileLayer
                      key={l.gen}
                      gen={l.gen}
                      layout={l.layout}
                      gone={live ? goneTiles : NO_TILES}
                      out={Boolean(l.out)}
                      fits={live ? fits : NO_TILE_FITS}
                      playing={live ? playing : NO_IDS}
                      hoverId={live ? on?.id ?? null : null}
                      tabId={live ? tabId : null}
                      selId={live ? selected?.id ?? null : null}
                      heat={heat}
                      animatedSet={animatedSet}
                      words={windowWords}
                      hourOk={hourOk}
                      windowLabel={data.windowLabel}
                    />
                  )
                })}
              </div>
            </div>
            {layout && W > 0 && VH > 0 ? (
              <div className="hv5-em-mini" aria-hidden="true" data-on={edge.zoomed || undefined} style={{ height: px((MINI_W * VH) / W) }}>
                {layout.fields.map((f) => (
                  <i key={f.field} style={{ left: px((f.x / W) * MINI_W), top: px((f.y / W) * MINI_W), width: px((f.w / W) * MINI_W), height: px((f.h / W) * MINI_W) }} />
                ))}
                {/* where the view is: written as the camera moves (A) */}
                <b ref={miniBoxRef} />
              </div>
            ) : null}
          </div>
          <p className="hv5-vh" id={HELP_ID}>Arrow keys move between emotes. Enter selects one and shows its busiest interval and the streams behind it.</p>
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
                setTall((prev) => ({ on: !prev.on, from: prev.on ? 0 : Math.round(mapRef.current?.clientHeight ?? 0), n: prev.n + 1 }))
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
                    <span>{shareOf(emoteMapValue(selected, view, data))} of all uses · {providerName(selected.prov)}</span>
                  </span>
                  {hourOk ? <Chg c={emoteChange(selected, data.windowLabel)} /> : null}
                  <button type="button" className="hv5-el-clear" onClick={() => setSel(null)}>Clear ✕</button>
                </div>
                {spike ? (
                  <div className="hv5-es">
                    <SpikeBars
                      spike={spike}
                      label={`${selected.e.name} uses per interval, ${windowWords}${busiest ? `, busiest ${busiest} at ${busiestRate} a minute` : ''}`}
                    />
                    <div className="hv5-es-ax" aria-hidden="true">
                      <span>{emoteWindowLabel(data, view)} {fresh ? 'ago' : 'earlier'}</span>
                      {busiest ? <span className="hv5-es-pk">Busiest {busiest} · {busiestRate} a minute</span> : null}
                      <span>{fresh ? 'now' : hubClock(data.t1)}</span>
                    </div>
                  </div>
                ) : null}
                {spike && busiest && intervalWindow ? (
                  <>
                    <p className="hv5-el-sub"><b>Who drove it</b> · streams in that interval with {selected.e.name} in their top 3</p>
                    <EmoteDrivers
                      key={`${selected.id}|${spike.peakT}`}
                      a={selected}
                      peakT={spike.peakT}
                      bucketMinutes={data.bucketMinutes}
                      intervalWindow={intervalWindow}
                      behind={Boolean(historyBehind)}
                      avatars={avatars}
                    />
                  </>
                ) : null}
                {/* the live moments it led stay, under the streams, when there are any (C1) */}
                {spammed.length ? (
                  <>
                    <p className="hv5-el-sub hv5-es-live">Where {selected.e.name} led chat on streams live now · × is emotes against the 15 minutes before</p>
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
                  </>
                ) : null}
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
                        aria-label={`#${i + 1} ${x.a.e.name}, ${providerName(x.a.prov)}, ${shareOf(x.v)} of uses${hourOk ? `, ${emoteChange(x.a, data.windowLabel).words}` : ''}. Shows its busiest interval and the streams behind it.`}
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
