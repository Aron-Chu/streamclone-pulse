import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, MutableRefObject } from 'react'
import {
  actOf, clk, emoteImage, fx, HOLD_FLOOR, int, LEAD_S, offAt, RISE_OK, SERIES_BEFORE, stc, streamTime, streamTip, streamWhere, usualAt, VERDICT_WORD,
  type CheckedMoment, type MinuteSeries, type MomentVod,
} from '../../../../lib/momentsChecked'
import type { MomentMetricKind } from '../../../../lib/momentsFeed'
import { atRel, chartSvg, compared, relAt, tAt, tweenBars, type ChartGeo } from './momentChartSvg'
import { GtGlyph, LtGlyph, PlayGlyph, VdMark, XGlyph } from './glyphs'

interface ChartProps {
  m: CheckedMoment
  series: MinuteSeries
  metric: MomentMetricKind
  /** The held minute, counted from the moment; null when none is held. */
  lk: number | null
  hold: (rel: number | null) => void
  /** A one-shot animation for the next draw ('grow' for a new moment, 'morph' for Chat ↔ Emotes); the draw clears it. */
  animRef: MutableRefObject<'grow' | 'morph' | null>
  motion: boolean
  phone: boolean
  vod: MomentVod | null
  pool: CheckedMoment[]
  onPlayAt: (rel: number) => void
  onGoto: (key: string) => void
  say: (text: string) => void
}

/**
 * The minutes around it (moments-r2 R2-3): the chart, the line under it, and
 * the held minute's card. The chart is drawn as one SVG string, like the
 * mockup, so a hover or a held minute changes it in place without a redraw.
 */
export function MomentChart({ m, series, metric, lk, hold, animRef, motion, phone, vod, pool, onPlayAt, onGoto, say }: ChartProps) {
  const box = useRef<HTMLDivElement>(null)
  const geo = useRef<ChartGeo | null>(null)
  const lkRef = useRef(lk)
  lkRef.current = lk
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    setWidth(Math.round(el.getBoundingClientRect().width))
    let timer = 0
    const observer = new ResizeObserver(entries => {
      window.clearTimeout(timer)
      const w = Math.round(entries[0].contentRect.width)
      timer = window.setTimeout(() => setWidth(prev => (Math.abs(prev - w) > 1 ? w : prev)), 120)
    })
    observer.observe(el)
    return () => { observer.disconnect(); window.clearTimeout(timer) }
  }, [])

  useLayoutEffect(() => {
    const el = box.current
    if (!el || !width) return
    const prev = new Map([...el.querySelectorAll<SVGRectElement>('rect.mk-cb')].map(b => [b.dataset.i ?? '', [Number(b.getAttribute('y')), Number(b.getAttribute('height'))] as [number, number]]))
    const hadFocus = !!el.firstElementChild && document.activeElement === el.firstElementChild
    const drawn = chartSvg(m, series, metric, width, phone, lkRef.current, true)
    el.innerHTML = drawn.html
    geo.current = drawn.geo
    const svg = el.firstElementChild as SVGSVGElement | null
    if (hadFocus) svg?.focus({ preventScroll: true })
    if (svg && motion && animRef.current) tweenBars(svg, animRef.current, prev, drawn.geo.T + drawn.geo.ph)
    animRef.current = null
    // A redraw follows the moment's data, not the object: the page rebuilds its moments every minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.key, m.item, series, metric, width, phone, motion])

  // the held minute moves in place: the chart keeps its focus and hover, and the held column slides from the minute it left
  const wasLk = useRef(lk)
  useEffect(() => {
    const svg = box.current?.firstElementChild as SVGSVGElement | null, g = geo.current, was = wasLk.current
    wasLk.current = lk
    if (!svg || !g) return
    svg.querySelectorAll('.mk-cb.lk').forEach(b => b.classList.remove('lk'))
    let lb = svg.querySelector<SVGRectElement>('[data-lk]')
    if (lk == null) { lb?.remove(); return }
    if (!lb) {
      lb = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      lb.setAttribute('class', 'mk-lk-b')
      lb.setAttribute('data-lk', '')
      lb.setAttribute('rx', '2')
      lb.setAttribute('y', String(g.T - 6))
      lb.setAttribute('height', String(g.ph + 6))
      lb.setAttribute('width', Math.max(1, g.bw - 1).toFixed(1))
      svg.insertBefore(lb, svg.querySelector('rect.mk-cb') ?? svg.querySelector('[data-cur]'))
    } else if (motion && was != null && was !== lk && typeof lb.animate === 'function') {
      lb.animate([{ transform: `translateX(${((was - lk) * g.bw).toFixed(1)}px)` }, { transform: 'none' }], { duration: 160, easing: 'cubic-bezier(.2,0,0,1)' })
    }
    lb.setAttribute('x', ((lk - g.lo) * g.bw + 0.5).toFixed(1))
    svg.querySelector(`.mk-cb[data-i="${lk}"]`)?.classList.add('lk')
  }, [lk, motion])

  const pointAt = (rel: number | null) => {
    const svg = box.current?.firstElementChild as SVGSVGElement | null, g = geo.current
    if (!svg || !g) return
    svg.querySelectorAll('.mk-cb.hv').forEach(b => b.classList.remove('hv'))
    const cur = svg.querySelector('[data-cur]')
    if (rel == null) { cur?.setAttribute('visibility', 'hidden'); setHover(null); return }
    svg.querySelector(`.mk-cb[data-i="${rel}"]`)?.classList.add('hv')
    const cx = ((rel - g.lo) * g.bw + g.bw / 2).toFixed(1)
    cur?.setAttribute('x1', cx)
    cur?.setAttribute('x2', cx)
    cur?.setAttribute('visibility', 'visible')
    setHover(rel)
  }
  const holdAt = (rel: number | null, point?: number | null) => {
    const g = geo.current
    const next = rel == null || !g ? null : Math.max(g.lo, Math.min(g.hi, rel))
    hold(next)
    if (next == null) say('Let go')
    else say(`${streamTime(m, vod, next)}, ${clk(tAt(m, next))}: ${int(atRel(series.c, next))} chat, ${int(atRel(series.e, next))} emotes`)
    const pt = point === undefined ? next : point
    if (pt != null) pointAt(pt)
  }
  const svgFrom = (event: { target: EventTarget }) => (event.target as Element).closest?.('svg') as SVGSVGElement | null

  const onMove = (event: ReactMouseEvent) => {
    const svg = svgFrom(event), g = geo.current
    if (svg && g) { const rel = relAt(svg, g, event.clientX); if (rel !== hover) pointAt(rel) }
  }
  const onClick = (event: ReactMouseEvent) => {
    const svg = svgFrom(event), g = geo.current
    if (!svg || !g) return
    const rel = relAt(svg, g, event.clientX)
    holdAt(lk === rel ? null : rel, rel)
  }
  const onKeyDown = (event: ReactKeyboardEvent) => {
    const g = geo.current
    if (!g || !(event.target as Element).matches?.('svg') || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); holdAt(lk == null ? 0 : lk + (event.key === 'ArrowRight' ? 1 : -1)) }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); holdAt(event.key === 'Home' ? g.lo : g.hi) }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); holdAt(lk == null ? 0 : null, lk == null ? 0 : null) }
    else if (event.key === 'Escape' && lk != null) { event.preventDefault(); holdAt(null, null) }
  }
  const focusChart = () => (box.current?.firstElementChild as SVGSVGElement | null)?.focus({ preventScroll: true })

  return <>
    <div className="mk-ch-box" ref={box} onMouseMove={onMove} onMouseLeave={() => pointAt(null)} onClick={onClick} onKeyDown={onKeyDown} />
    <ChartRead m={m} series={series} vod={vod} lk={lk} at={hover} />
    {lk != null && geo.current
      ? <HoldCard m={m} series={series} vod={vod} lk={lk} geo={geo.current} motion={motion} pool={pool}
        onStep={(d) => { holdAt(lk + d); if ((d < 0 ? lk + d <= geo.current!.lo : lk + d >= geo.current!.hi)) focusChart() }}
        onUnhold={() => { holdAt(null, null); focusChart() }} onPlayAt={onPlayAt} onGoto={onGoto} />
      : null}
  </>
}

/** The line under the chart: the minute pointed at, or how to move the held one. */
function ChartRead({ m, series, vod, lk, at }: { m: CheckedMoment; series: MinuteSeries; vod: MomentVod | null; lk: number | null; at: number | null }) {
  if ((at == null || at === lk) && lk != null) {
    return <p className="mk-d-read" aria-live="off"><span className="mk-hint">Holding <b>{streamTime(m, vod, lk)}</b> ({clk(tAt(m, lk))})<span className="mk-kb"> · ← → move it · Esc lets go</span></span></p>
  }
  const rel = at ?? 0, win = compared(m)
  const tag = rel === 0 ? 'the moment' : win && rel >= win[0] && rel <= win[1] ? 'compared' : ''
  const top = series.t3[rel + SERIES_BEFORE]?.[0], v = atRel(series.v, rel)
  return <p className="mk-d-read" aria-live="off">
    <b>{streamTime(m, vod, rel)}</b> · {clk(tAt(m, rel))}{tag ? ` (${tag})` : ''}: {int(atRel(series.c, rel))} chat · {int(atRel(series.e, rel))} emotes
    {top ? ` · top ${top.name} ×${int(top.count)}` : ''}{v != null ? ` · ${int(v)} watching` : ''}
    {at != null ? <span className="mk-hint"> · click to hold</span> : null}
  </p>
}

interface HoldProps {
  m: CheckedMoment; series: MinuteSeries; vod: MomentVod | null; lk: number; geo: ChartGeo; motion: boolean; pool: CheckedMoment[]
  onStep: (d: number) => void; onUnhold: () => void; onPlayAt: (rel: number) => void; onGoto: (key: string) => void
}

/**
 * Hold a minute: that minute's chat, emotes and viewers, each against its own
 * 15 minutes before (the moment's rule, read off the drawn minutes; display
 * only), its top three emotes, the moment it is if it is one, and Play from it.
 */
function HoldCard({ m, series, vod, lk, geo, motion, pool, onStep, onUnhold, onPlayAt, onGoto }: HoldProps) {
  const card = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const el = card.current
    if (!el) return
    if (motion) el.classList.add('enter')
    if (el.getBoundingClientRect().bottom > window.innerHeight - 8) el.scrollIntoView({ block: 'nearest', behavior: motion ? 'smooth' : 'auto' })
  }, [])
  const t = tAt(m, lk), win = compared(m)
  const away = `${Math.abs(lk)} min ${lk < 0 ? 'before' : 'after'}`
  const meta = win && lk >= win[0] && lk <= win[1] ? `one of the ${win[1] - win[0] + 1} compared` : ''
  const uc = usualAt(series.c, m, lk, HOLD_FLOOR.chat), ue = usualAt(series.e, m, lk, HOLD_FLOOR.emotes)
  const fig = (key: 'chat' | 'emotes' | 'viewers', label: string, v: number | null, u: ReturnType<typeof usualAt> | null) => {
    const x = u && 'x' in u ? u.x : null
    const third = !u ? '' : x != null ? `${fx(x)} usual` : 'why' in u ? u.why : ''
    const tip = u && 'fromRel' in u ? `Usual: ${int(u.b)} a minute, ${clk(tAt(m, u.fromRel))}–${clk(tAt(m, u.toRel))}` : undefined
    return <div className="mk-mc-fig" title={tip}>
      <span className="mk-mc-fl"><i className={`mk-sw ${key}`} aria-hidden="true" />{label}</span>
      <span className={`mk-mc-n${v == null ? ' na' : ''}`}>{int(v)}</span>
      <span className={`mk-mc-u${x != null && x >= RISE_OK ? ' hi' : ''}`}>{third || ' '}</span>
    </div>
  }
  const ems = series.t3[lk + SERIES_BEFORE] ?? [], emotes = atRel(series.e, lk)
  const other = lk === 0 ? null : pool.find(x => x.sid === m.sid && x.at === tAt(m, lk)) ?? null
  return <section className="mk-mc" ref={card} aria-label={`Minute held: ${streamTime(m, vod, lk)} ${streamWhere(vod)}, ${clk(t)}`}
    onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onUnhold() } }}>
    <div className="mk-mc-top">
      <p className="mk-mc-s">Minute held · {lk === 0 ? 'the moment' : <>{away}<span className="mk-mc-rx"> the moment</span></>}</p>
      <button className="mk-ib mk-mc-ib" type="button" aria-label="The minute before" disabled={lk <= geo.lo} onClick={() => onStep(-1)}><LtGlyph /></button>
      <button className="mk-ib mk-mc-ib" type="button" aria-label="The minute after" disabled={lk >= geo.hi} onClick={() => onStep(1)}><GtGlyph /></button>
      <button className="mk-ib mk-mc-ib" type="button" aria-label="Let go (Esc)" title="Let go (Esc)" onClick={onUnhold}><XGlyph /></button>
    </div>
    <div className="mk-mc-id">
      <h4 className="mk-mc-t" title={streamTip(m, vod, lk)}>{streamTime(m, vod, lk)}<span className="mk-mc-tc">{streamWhere(vod)} · {clk(t)}</span></h4>
      {meta ? <p className="mk-mc-m">{meta}</p> : null}
    </div>
    <div className="mk-mc-figs">
      {fig('chat', 'chat/min', atRel(series.c, lk), uc)}
      {fig('emotes', 'emotes/min', emotes, ue)}
      {fig('viewers', 'viewers', atRel(series.v, lk), null)}
    </div>
    <div className="mk-mc-low">
      <div className="mk-mc-emw"><p className="mk-mc-sl">Top emotes</p>
        {ems.length ? <ul className="mk-mc-em">{ems.map(e => {
          const src = emoteImage(e)
          return <li key={e.name}>{src ? <img src={src} alt="" width={24} height={24} /> : <span className="mk-mc-noimg" aria-hidden="true" />}
            <b>{e.name}</b><span>{int(e.count)}{emotes ? ` · ${Math.round((e.count / emotes) * 100)}%` : ''}</span></li>
        })}</ul> : <p className="mk-mc-none">none named in this minute</p>}
      </div>
      {other ? <p className="mk-mc-oth">A moment here: <b>{actOf(other.item).text}</b>, {VERDICT_WORD[other.item.verdict].toLowerCase()}</p> : null}
    </div>
    {vod || other ? <div className="mk-mc-acts">
      {vod ? <button className="mk-btn" type="button" title="10 s before the minute, like the moment’s Play" onClick={() => onPlayAt(lk)}><PlayGlyph />Play from {stc(offAt(m, lk) + vod.alignSeconds - LEAD_S)}</button> : null}
      {other ? <button className="mk-btn" type="button" onClick={() => onGoto(other.key)}><VdMark v={other.item.verdict} />Open that moment</button> : null}
    </div> : null}
  </section>
}
