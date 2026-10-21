/**
 * Top emotes as the emote map (R5-13; re-done as r4 A2 on 2026-10-21, mockup
 * emotemap-moments-r4). A treemap in three flat provider fields (Twitch, 7TV,
 * BTTV & FFZ) with 2 px seams; a tile's size is its uses over the window and it
 * shows its picture, then its name and share as room allows. Emotes under 0.9%
 * fold into their field's "+N" tile. The legend gives each field's share.
 * Under the map, the ten most used emotes with the last hour against their own
 * pace as a change chip. A click on a tile or a row selects the emote: the list
 * turns into where chat spammed it (the hub's live moments it led), and each
 * row opens the moment in Moments. Hover (or focus) shows an emote's numbers;
 * arrow keys move to the nearest tile, Home and End to the ends, with one tab
 * stop. 24 h | Last hour re-flows the tiles; Taller map gives 1.8 times the
 * height.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent as ReactFocusEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import type { HubActivityPoint, HubLivePulseMoment } from '../../../../lib/publicHub'
import { HubToggletip } from '../d3/HubToggletip'
import { HubV5Avatar } from './HubV5Avatar'
import { useMedia } from './HubV5LiveFeed'
import {
  FIELD_NAMES,
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
  nearestTile,
  providerName,
  type EmoteChange,
  type HubEmoteAgg,
  type HubEmoteMapData,
  type HubEmoteWindow,
  type MapLayout,
  type MapMore,
  type MapTile,
} from './hubV5EmoteMapModel'
import { feedAgo } from './hubV5FeedModel'
import { formatHubInt, formatHubMultiplier, hubClockRange, momentRowAria, momentRowsV5 } from './hubV5Model'
import { isFocusVisible, placeHubV5Card } from './hubV5HoverCard'

const H_ID = 'hv5-te-h'
const META_ID = 'hv5-em-meta'
const HELP_ID = 'hv5-em-help'
const px = (n: number) => `${n.toFixed(1)}px`
const MORE = 'more:'

function tileStyle(t: { x: number; y: number; w: number; h: number }): CSSProperties {
  return {
    left: px(t.x + 1),
    top: px(t.y + 1),
    width: px(Math.max(1, t.w - 2)),
    height: px(Math.max(1, t.h - 2)),
  }
}

function Chg({ c }: { c: EmoteChange }) {
  return <span className="hv5-chg" data-dir={c.dir} title={c.words}>{c.text}</span>
}

function EmotePic({ a, size }: { a: HubEmoteAgg; size: number }) {
  const src = emoteImageAt(a.e.imageUrl, 32)
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
  const src = emoteImageAt(a.e.imageUrl, 48)
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

function MoreCard({ m, total }: { m: MapMore; total: number }) {
  const names = m.emotes.slice(0, 8).map((a) => a.e.name).join(', ')
  return (
    <>
      <div className="hv5-ec-h">
        <span className="hv5-ec-tx"><b>{formatHubInt(m.n)} more {FIELD_NAMES[m.field]} emotes</b><span>{names}{m.n > 8 ? ', …' : ''}</span></span>
      </div>
      <dl className="hv5-ec-dl">
        <dt>Uses together</dt>
        <dd>{formatHubInt(m.v)} <span>· {emoteSharePct(total > 0 ? (m.v / total) * 100 : 0)} of the map</span></dd>
      </dl>
    </>
  )
}

export function HubV5EmoteMap({
  points,
  bucketMinutes,
  loading,
  moments = [],
  avatars,
  nowMs,
}: {
  points: readonly HubActivityPoint[]
  bucketMinutes: number
  loading?: boolean
  /** The hub's live moments: where chat spammed a selected emote. */
  moments?: readonly HubLivePulseMoment[]
  avatars?: ReadonlyMap<string, string>
  nowMs: number
}) {
  const data = useMemo(() => emoteMapData(points, bucketMinutes), [points, bucketMinutes])
  const phone = useMedia('(max-width: 719px)')
  const [win, setWin] = useState<HubEmoteWindow>('all')
  const [tall, setTall] = useState<{ on: boolean; from: number }>({ on: false, from: 0 })
  const mapRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [focusId, setFocusId] = useState<string | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [on, setOn] = useState<{ id: string; el: HTMLElement } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const hourOk = Boolean(data?.paceOk)
  const view: HubEmoteWindow = hourOk ? win : 'all'
  // min-height: the map grows to fill a taller grid row
  const prefH = size.w ? emoteMapHeight(size.w, phone, tall.on, tall.from) : (phone ? 320 : 340)

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

  const layout: MapLayout | null = useMemo(() => (data ? emoteMapLayout(data, view, size.w, size.h) : null), [data, view, size.w, size.h])
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
    if (on && (!on.el.isConnected || !(on.id.startsWith(MORE) || data?.byId.has(on.id)))) hide()
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
    if (on && on.el.isConnected && cardRef.current) placeHubV5Card(cardRef.current, on.el)
  }, [on, layout])

  const itemOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('.hv5-em-t') : null)
  const onPointerOver = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
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
  const onFocus = (event: ReactFocusEvent<HTMLDivElement>) => {
    const el = event.target instanceof Element ? event.target.closest<HTMLElement>('button.hv5-em-t') : null
    if (el && isFocusVisible(el)) setOn({ id: el.dataset.eid!, el })
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
  const onAgg = on && !on.id.startsWith(MORE) ? data?.byId.get(on.id) : undefined
  const onMore = on?.id.startsWith(MORE) ? layout?.mores.find((m) => `${MORE}${m.field}` === on.id) : undefined
  const meta = data && layout ? emoteMapMeta(data, layout, view) : ''
  const windowWords = view === 'all' ? `last ${data?.windowLabel ?? '24 h'}` : 'last hour'
  const shareOf = (v: number) => emoteSharePct(layout && layout.total > 0 ? (v / layout.total) * 100 : 0)

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
            onFocus={onFocus}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
          >
            {layout?.mores.map((m) => (
              <div
                key={`${MORE}${m.field}`}
                className="hv5-em-t hv5-em-more"
                data-eid={`${MORE}${m.field}`}
                data-field={m.field}
                role="img"
                style={tileStyle(m)}
                aria-label={`${m.n} more ${FIELD_NAMES[m.field]} emotes, ${m.share} of the map together, each under 0.9%`}
              >
                {m.label ? <span className="hv5-em-ml">+{formatHubInt(m.n)}</span> : null}
              </div>
            ))}
            {tiles.map((t) => {
              const a = t.a
              const aria = `#${t.rank} ${a.e.name}, ${providerName(a.prov)}, ${formatHubInt(t.v)} uses in the ${windowWords}, ${t.share} of the map${hourOk ? `, ${emoteChange(a, data.windowLabel).words}` : ''}.`
              return (
                <button
                  key={a.id}
                  type="button"
                  className={`hv5-em-t hv5-em-${t.size}`}
                  data-eid={a.id}
                  data-field={t.field}
                  style={tileStyle(t)}
                  tabIndex={a.id === tabId ? 0 : -1}
                  aria-pressed={selected?.id === a.id}
                  aria-label={aria}
                  onClick={() => select(a.id)}
                >
                  {t.chip ? <span className="hv5-em-chip" style={{ width: t.chip, height: t.chip }}><EmotePic a={a} size={Math.round(t.chip * 0.72)} /></span> : null}
                  {t.name || t.val ? (
                    <span className="hv5-em-ft">
                      {t.name ? <span className="hv5-em-nm">{a.e.name}</span> : null}
                      {t.val ? <span className="hv5-em-v">{t.share}</span> : null}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
          <p className="hv5-vh" id={HELP_ID}>Arrow keys move between emotes. Enter selects one and lists where chat spammed it.</p>
          <div className="hv5-em-foot">
            <span className="hv5-em-lg">
              {layout?.fields.map((f) => (
                <span key={f.field} data-field={f.field}><i aria-hidden="true" />{f.name}<b>{f.share}</b></span>
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
                <p className="hv5-el-sub">Where chat spammed {selected.e.name} on streams live now · × is emotes against the 15 minutes before</p>
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
                        aria-label={`#${i + 1} ${x.a.e.name}, ${providerName(x.a.prov)}, ${shareOf(x.v)} of uses${hourOk ? `, ${emoteChange(x.a, data.windowLabel).words}` : ''}. Shows where chat spammed it.`}
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
          {(onAgg || onMore) && layout && typeof document !== 'undefined'
            ? createPortal(
              <div ref={cardRef} className="hub-d3-layer hv5-layer hv5-em-card" aria-hidden="true" style={{ left: 0, top: 0, visibility: 'hidden' }}>
                {onAgg ? <EmoteCard a={onAgg} data={data} win={view} total={layout.total} /> : <MoreCard m={onMore!} total={layout.total} />}
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
