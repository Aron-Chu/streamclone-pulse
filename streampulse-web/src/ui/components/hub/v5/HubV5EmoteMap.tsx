/**
 * Top emotes as the emote map (R5-13, refined R5-17; mockup d3-v5 hub-emap.js
 * and hub-r5c.css). A treemap like a stock-market heat map: the segments are
 * the providers, a tile's size is its uses over the window and its colour the
 * last hour against its own pace. The biggest tiles are captioned like a poster
 * (share, "of uses", name) and the top 3 wear a rank chip; emotes too small for
 * a picture are cells in each segment's "more" block. Hover (or focus, or a
 * click) shows an emote's numbers; arrow keys move to the nearest tile, Home
 * and End to the ends, with one tab stop. 24 h | Last hour switches the window;
 * Taller map gives it 1.8 times the height.
 * The mockup's click also drew the emote on the Activity chart (E4). That needs
 * the shared chart's overlay panel, so a click here shows the card instead.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent as ReactFocusEvent, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { HubActivityPoint } from '../../../../lib/publicHub'
import { HubToggletip } from '../d3/HubToggletip'
import { useMedia } from './HubV5LiveFeed'
import {
  EMOTE_TONES,
  emoteImageAt,
  emoteMapData,
  emoteMapHeight,
  emoteMapLayout,
  emoteMapMeta,
  emoteMapTip,
  emotePaceText,
  emoteSharePct,
  emoteTone,
  nearestTile,
  providerName,
  type HubEmoteAgg,
  type HubEmoteMapData,
  type HubEmoteWindow,
  type MapTile,
} from './hubV5EmoteMapModel'
import { formatHubInt, hubClockRange } from './hubV5Model'
import { isFocusVisible, placeHubV5Card } from './hubV5HoverCard'

const H_ID = 'hv5-te-h'
const META_ID = 'hv5-em-meta'
const HELP_ID = 'hv5-em-help'
const px = (n: number) => `${n.toFixed(1)}px`

function tileStyle(t: { x: number; y: number; w: number; h: number }, extra?: CSSProperties): CSSProperties {
  return {
    left: px(t.x + 1),
    top: px(t.y + 1),
    width: px(Math.max(1, t.w - 2)),
    height: px(Math.max(1, t.h - 2)),
    ...(Math.min(t.w, t.h) < 22 ? { borderRadius: 2 } : null),
    ...extra,
  }
}

function EmoteCard({ a, data, win, total }: { a: HubEmoteAgg; data: HubEmoteMapData; win: HubEmoteWindow; total: number }) {
  const v = win === 'all' ? a.c24 : a.c1h
  const src = emoteImageAt(a.e.imageUrl, 48)
  const tone = data.paceOk ? emoteTone(a) : 3
  const slot = data.bucketMinutes * 60_000
  return (
    <>
      <div className="hv5-ec-h">
        <span className="hv5-ec-im">{src ? <img src={src} alt="" width={40} height={40} referrerPolicy="no-referrer" /> : null}</span>
        <span className="hv5-ec-tx"><b>{a.e.name}</b><span>{providerName(a.prov)}</span></span>
      </div>
      <dl className="hv5-ec-dl">
        <dt>{win === 'all' ? `Uses, ${data.windowLabel}` : 'Uses, last hour'}</dt>
        <dd>{formatHubInt(v)} <span>· {emoteSharePct(total > 0 ? (v / total) * 100 : 0)} of the map</span></dd>
        <dt>In a top 10</dt>
        <dd>{a.n} of {data.intervals} intervals</dd>
        {data.paceOk ? (
          <>
            <dt>Last hour</dt>
            <dd data-tone={tone}><i />{a.c1h ? <>{formatHubInt(a.c1h)} <span>· {emotePaceText(a, data.windowLabel)}</span></> : emotePaceText(a, data.windowLabel)}</dd>
          </>
        ) : null}
        <dt>Busiest</dt>
        <dd>{formatHubInt(Math.round(a.peak / data.bucketMinutes))}/min <span>· {hubClockRange(a.peakT, a.peakT + slot)}</span></dd>
      </dl>
    </>
  )
}

export function HubV5EmoteMap({ points, bucketMinutes, loading }: { points: readonly HubActivityPoint[]; bucketMinutes: number; loading?: boolean }) {
  const data = useMemo(() => emoteMapData(points, bucketMinutes), [points, bucketMinutes])
  const phone = useMedia('(max-width: 719px)')
  const [win, setWin] = useState<HubEmoteWindow>('all')
  const [tall, setTall] = useState<{ on: boolean; from: number }>({ on: false, from: 0 })
  const mapRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [focusId, setFocusId] = useState<string | null>(null)
  const [on, setOn] = useState<{ id: string; el: HTMLElement; byClick: boolean } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const hourOk = Boolean(data?.paceOk)
  const view: HubEmoteWindow = hourOk ? win : 'all'
  // min-height: the map grows to fill a taller grid row
  const prefH = size.w ? emoteMapHeight(size.w, phone, tall.on, tall.from) : (phone ? 340 : 380)

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

  const layout = useMemo(
    () => (data && size.w > 0 && size.h > 0 ? emoteMapLayout(data, view, size.w, size.h, phone) : null),
    [data, view, size.w, size.h, phone],
  )

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
    const onDown = (event: globalThis.PointerEvent) => { if (!(event.target instanceof Node) || !mapRef.current?.contains(event.target)) hide() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    document.addEventListener('pointerdown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, { capture: true })
      document.removeEventListener('pointerdown', onDown)
    }
  }, [on, hide])
  useLayoutEffect(() => {
    if (on && on.el.isConnected && cardRef.current) placeHubV5Card(cardRef.current, on.el)
  }, [on, layout])

  const itemOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('button.hv5-em-t, .hv5-em-u') : null)
  const onPointerOver = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    const el = itemOf(event.target)
    if (!el || el === on?.el) return
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      if (el.isConnected) setOn({ id: el.dataset.eid!, el, byClick: false })
    }, on ? 0 : 90)
  }
  // touch fires a leave after every tap
  const onPointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => { if (event.pointerType !== 'touch') hide() }
  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const el = itemOf(event.target)
    if (!el) return
    window.clearTimeout(timer.current)
    if (on?.el === el && on.byClick) hide()
    else setOn({ id: el.dataset.eid!, el, byClick: true })
  }
  const onFocus = (event: ReactFocusEvent<HTMLDivElement>) => {
    const el = event.target instanceof Element ? event.target.closest<HTMLElement>('button.hv5-em-t') : null
    if (el && isFocusVisible(el)) setOn({ id: el.dataset.eid!, el, byClick: false })
  }
  const onBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (!(event.relatedTarget instanceof Node) || !mapRef.current?.contains(event.relatedTarget)) hide()
  }
  const tiles = layout?.tiles ?? []
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
    target.focus()
  }

  const tabId = layout && tiles.some((t) => t.a.id === focusId) ? focusId : tiles[0]?.a.id ?? null
  const toneOf = (a: HubEmoteAgg) => (hourOk ? emoteTone(a) : 3)
  const onAgg = on ? data?.byId.get(on.id) : undefined
  const meta = data && layout ? emoteMapMeta(data, layout, view) : ''

  return (
    <section id="emotes" className="hv5-sec hv5-emotes" aria-labelledby={H_ID} aria-busy={loading || undefined}>
      <div className="hv5-rh hv5-em-rh">
        <h2 id={H_ID}>Top emotes</h2>
        {data ? <HubToggletip tip={emoteMapTip(data)} label="About the emote map" /> : null}
        {hourOk ? (
          <span className="hv5-end">
            <span className="hv5-seg" role="group" aria-label="Emote map window">
              <button type="button" aria-pressed={win === 'all'} onClick={() => { hide(); setWin('all') }}>{data?.windowLabel ?? '24 h'}</button>
              <button type="button" aria-pressed={win === '1h'} onClick={() => { hide(); setWin('1h') }}>Last hour</button>
            </span>
          </span>
        ) : null}
        {data ? <span className="hv5-meta hv5-em-meta" id={META_ID}>{meta}</span> : null}
      </div>
      {data ? (
        <>
          <div
            ref={mapRef}
            className="hv5-em-map"
            role="group"
            aria-labelledby={`${H_ID} ${META_ID}`}
            aria-describedby={HELP_ID}
            style={{ '--em-h': `${prefH}px` } as CSSProperties}
            onPointerOver={onPointerOver}
            onPointerLeave={onPointerLeave}
            onClick={onClick}
            onFocus={onFocus}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
          >
            {layout?.segs.map((s) => (
              <div key={s.prov} className="hv5-em-seg" data-prov={s.prov} style={{ left: s.x, top: s.y, width: s.w, height: s.h }} aria-hidden="true">
                {s.share ? <span className="hv5-em-sh"><b>{s.name}</b> {s.share}</span> : null}
              </div>
            ))}
            {layout?.mores.map((m) => (
              <div key={`more-${m.prov}`} className="hv5-em-t hv5-em-more" role="img" style={tileStyle(m)} aria-label={`${m.n} more ${providerName(m.prov)} emotes, ${m.share} of the map together, each too small for a picture`}>
                {m.cells.map((c) => (
                  <i key={c.a.id} className="hv5-em-u" data-eid={c.a.id} data-tone={toneOf(c.a)} style={{ left: px(c.x), top: px(c.y), width: px(c.w), height: px(c.h) }} />
                ))}
                {m.label ? <span className="hv5-em-ml"><b>{m.label.n}</b>{m.label.rest}</span> : null}
              </div>
            ))}
            {tiles.map((t) => {
              const a = t.a
              const src = t.img ? emoteImageAt(a.e.imageUrl, t.img) : ''
              const aria = `#${t.rank} ${a.e.name}, ${providerName(a.prov)}, ${formatHubInt(t.v)} uses ${view === 'all' ? `in the last ${data.windowLabel}` : 'in the last hour'}, ${t.share} of the map${hourOk ? `, ${emotePaceText(a, data.windowLabel)}` : ''}.`
              return (
                <button
                  key={a.id}
                  type="button"
                  className={`hv5-em-t${t.cap ? ' hv5-em-cap' : ''}`}
                  data-eid={a.id}
                  data-tone={toneOf(a)}
                  style={tileStyle(t, { '--fs': `${t.fs}px` } as CSSProperties)}
                  tabIndex={a.id === tabId ? 0 : -1}
                  aria-label={aria}
                >
                  {t.chip ? <span className="hv5-em-rk">{t.rank}</span> : null}
                  {src ? (
                    <img
                      src={src}
                      alt=""
                      width={t.img}
                      height={t.img}
                      style={{ width: t.img, height: t.img }}
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      onError={(event) => { event.currentTarget.style.visibility = 'hidden' }}
                    />
                  ) : null}
                  {t.cap ? (
                    <span className="hv5-em-cp"><b>{t.share}</b><span>of uses</span><span className="hv5-em-nm">{a.e.name}</span></span>
                  ) : (
                    <>
                      {t.name ? <span className="hv5-em-nm">{a.e.name}</span> : null}
                      {t.val ? <span className="hv5-em-v">{t.share}</span> : null}
                    </>
                  )}
                </button>
              )
            })}
          </div>
          <p className="hv5-vh" id={HELP_ID}>Arrow keys move between emotes. Enter shows an emote’s numbers.</p>
          <div className="hv5-em-foot">
            {hourOk ? (
              <span
                className="hv5-em-key"
                role="img"
                aria-label={`Colour: the last hour against the emote’s own ${data.windowLabel} pace, from quieter (red) through as usual (grey) to busier (green); dark made no top 10 in the last hour.`}
              >
                <span className="hv5-em-kt">Last hour:</span>
                <span className="hv5-em-kw">quieter</span>
                <span className="hv5-em-sw">{EMOTE_TONES.slice(1).map((x, i) => <i key={x.t} data-tone={i + 1} title={`${x.t}: ${x.d}`} />)}</span>
                <span className="hv5-em-kw">busier</span>
                <span className="hv5-em-kn" title={EMOTE_TONES[0]!.d}><i data-tone={0} />none</span>
              </span>
            ) : null}
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
          {on && onAgg && layout && typeof document !== 'undefined'
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
        <p className="hv5-none">No emote counts in this window yet.</p>
      )}
    </section>
  )
}
