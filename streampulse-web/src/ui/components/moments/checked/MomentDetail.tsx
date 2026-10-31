import { useEffect, useId, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import { Link } from 'react-router-dom'
import {
  actOf, boxArtImage, checkLines, clk, emoteImage, fx, hms, int, LEAD_S, liveFrameImage, offAt, sameDay, seriesFromSpark, sortedChecks,
  streamTime, streamTip, VERDICT_WORD, type CheckedMoment, type MinuteSeries, type MomentVod,
} from '../../../../lib/momentsChecked'
import type { MomentMetricKind } from '../../../../lib/momentsFeed'
import { loadMomentMinuteSeries } from '../../../../lib/momentMinuteSeries'
import { broadcastTimelineHref } from '../../../../lib/momentsNavigation'
import { vodEmbedSrc, vodSeconds, type MomentVodCache } from '../../../../lib/momentsFeedVod'
import { MomentChart } from './MomentChart'
import { MomentAct } from './MomentAct'
import { BookGlyph, ExtGlyph, InfoGlyph, LinkGlyph, PlayGlyph, VdMark, VerdictGlyph, XGlyph } from './glyphs'
import { headerClear } from './headerClear'

/** The detail's reads wait this long for the selection to settle: J held down reads only where it stops. */
const READ_DELAY_MS = 200
/** "More from this stream" shows this many until its "Show all" (10-22). */
export const MORE_SHOWN = 5

export interface DetailProps {
  m: CheckedMoment
  /** Every loaded moment: the held minute's "a moment here". */
  pool: CheckedMoment[]
  now: number
  metric: MomentMetricKind | null
  setMetric: (metric: MomentMetricKind) => void
  lk: number | null
  setLk: (rel: number | null) => void
  saved: boolean
  onSave: () => void
  /** Why the last Save didn't go through (the 200 limit), under the buttons (Q3b, 10-31). */
  saveNote?: string | null
  onCopy: () => Promise<void>
  onOpen: (key: string) => void
  onClose: () => void
  motion: boolean
  phone: boolean
  say: (text: string) => void
  /** The page's P key plays the open moment (or its held minute) through this. */
  playRef: MutableRefObject<((rel: number | null) => void) | null>
  /** The page's VODs, by stream. */
  vods: MomentVodCache
  /** The stream whose "More from this stream" shows all: the page's, so it stays open from one of its moments to the next. */
  moreAll: string | null
  setMoreAll: (sid: string | null) => void
  /** The picked game's category id (?game=), and the page's pick: the moment's game shows that game's moments (C1, 10-22). */
  game: string | null
  onGame: (id: string) => void
}

/**
 * The open moment (moments-r2 detail, moments-r4 B2 order, C1 trims): the
 * frame and Play, who (to the stream's page) and what happened, the × with
 * why it counts behind its (i), when and the game (to its moments), the
 * verdict as a chip only where it doesn't simply hold up, the minutes around it with a held minute, and what chat sent. Two
 * reads, for this moment only, once the selection has settled: its stream
 * record (the VOD; none when the page already knows the stream's) and its
 * minutes (the chart). Until the minutes answer, or if they don't, the chart
 * draws the feed's 25-minute sparkline.
 */
export function MomentDetail(props: DetailProps) {
  const { m, pool, now, metric, setMetric, lk, setLk, saved, onSave, saveNote, onCopy, onOpen, onClose, motion, phone, say, playRef, vods, moreAll, setMoreAll, game, onGame } = props
  const item = m.item
  const [vod, setVod] = useState<MomentVod | null>(() => vods.peek(item) ?? null)
  const [minutes, setMinutes] = useState<MinuteSeries | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [frameFailed, setFrameFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [why, setWhy] = useState(false)
  const media = useRef<HTMLDivElement>(null)
  const whyRef = useRef<HTMLDivElement>(null)
  const chipRef = useRef<HTMLButtonElement>(null)
  const anim = useRef<'grow' | 'morph' | null>('grow')
  const popId = useId()

  useEffect(() => {
    const controller = new AbortController()
    const moment = { login: item.login.toLowerCase(), streamId: item.streamId, offsetSeconds: item.offsetSeconds, minuteStart: item.minuteStart }
    const timer = window.setTimeout(() => {
      if (vods.peek(item) === undefined) vods.read(item).then(v => { if (!controller.signal.aborted) setVod(v) }, () => undefined)
      loadMomentMinuteSeries(moment, controller.signal).then(series => { if (series) { anim.current = 'morph'; setMinutes(series) } }, () => undefined)
    }, READ_DELAY_MS)
    return () => { window.clearTimeout(timer); controller.abort() }
    // One moment, one pair of reads: a poll that sends the same moment again does not read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.key])

  // "Why it counts" closes on Esc (before the page's Esc closes the moment) or a press outside it
  useEffect(() => {
    if (!why) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (whyRef.current?.contains(document.activeElement)) chipRef.current?.focus({ preventScroll: true })
      setWhy(false)
    }
    const onDown = (e: PointerEvent) => { if (!whyRef.current?.contains(e.target as Node | null)) setWhy(false) }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onDown, true) }
  }, [why])

  const spark = useRef<{ key: string; series: MinuteSeries } | null>(null)
  if (!spark.current || spark.current.key !== m.key) spark.current = { key: m.key, series: seriesFromSpark(m) }
  const series = minutes ?? spark.current.series
  const kind = metric ?? m.kind
  const live = item.streamLive
  const frame = live && !frameFailed ? liveFrameImage(item) : undefined
  const boxArt = boxArtImage(item)

  const play = (rel: number | null) => {
    if (!vod) return
    const t = vodSeconds(vod, rel != null ? offAt(m, rel) : item.offsetSeconds, LEAD_S)
    const host = window.location.hostname
    if (!host) { window.open(`https://www.twitch.tv/videos/${vod.vodId}?t=${hms(t)}`, '_blank', 'noopener'); return }
    setPlaying(vodEmbedSrc(vod.vodId, t, host))
    const el = media.current
    if (rel != null && el) {
      const r = el.getBoundingClientRect()
      if (r.top < headerClear() || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'nearest', behavior: motion ? 'smooth' : 'auto' })
    }
  }
  playRef.current = play

  const checks = sortedChecks(m.checks.length ? m.checks : checkLines(item))
  const emTot = item.emotes.perMin ?? 0
  const vodT = vod ? vodSeconds(vod, item.offsetSeconds, LEAD_S) : 0
  const act = actOf(item, true)
  // the × the feed sent, where the rise check passed or partly did
  const x = m.rowX ?? (item.checks.rise?.code === 'partly' ? m.x : null)
  const word = VERDICT_WORD[item.verdict]
  const whyTitle = item.verdict === 'bad' ? 'Why it doesn’t count' : 'Why it counts'
  // most moments hold up, so the chip only shows where it says something; else why it counts is the ×'s (i) (C1, 10-22)
  const chip = item.verdict !== 'ok' || x == null
  const whyProps = { 'aria-expanded': why, 'aria-controls': popId, 'aria-label': `${word}: ${whyTitle.toLowerCase()}`, onClick: () => setWhy(v => !v) }
  const page = /^\d{1,30}$/.test(item.streamId)
    ? broadcastTimelineHref(item.login.toLowerCase(), item.streamId, `/analytics/moments?${new URLSearchParams({ m: m.key })}`, item.offsetSeconds) : null
  const cat = item.category
  const gameIn = cat ? <>{boxArt ? <img src={boxArt} alt="" /> : null}{cat.name}</> : null
  // the stream's other moments that hold up or partly do, newest first: the list's "N earlier" until M1 (10-22)
  const more = pool.filter(o => o.sid === m.sid && o.key !== m.key && o.item.verdict !== 'bad').sort((a, b) => b.at - a.at)
  const moreOpen = moreAll === m.sid || more.length <= MORE_SHOWN
  const moreId = useId()

  return <article className="mk-d" data-key={m.key} data-vd={item.verdict}>
    <div className={`mk-d-media${playing ? ' on' : ''}`} ref={media}>
      {playing
        ? <iframe title={`Twitch VOD of ${m.name}`} src={playing} allow="autoplay; fullscreen" allowFullScreen />
        : <>
          {frame ? <img src={frame} alt="" onError={() => setFrameFailed(true)} />
            : boxArt ? <img className="mk-d-bx" src={boxArt} alt="" /> : <span className="mk-d-noframe">No live frame</span>}
          {vod ? <button className="mk-d-play" type="button" onClick={() => play(null)}><PlayGlyph />Play from 10 s before</button> : null}
          {/* the name is right under the picture (C1, 10-22) */}
          <span className="mk-d-lv">{live ? <><i />Live now</> : 'Offline'}</span>
        </>}
      <button className="mk-d-x" type="button" aria-label="Close" onClick={onClose}><XGlyph /></button>
    </div>
    <div className="mk-d-head">
      <h2 className="mk-d-l1">{page ? <Link className="mk-d-nm" to={page} title="Open the stream’s page">{m.name}</Link> : <span>{m.name}</span>}<MomentAct act={act} /></h2>
      {/* × on line 1 in the rows' words, then when · in · game · viewers on line 2 (T1, 10-21; C1, 10-22) */}
      <div className="mk-hold-w" ref={whyRef}>
        <p className="mk-d-meta">
          {x != null ? <span className="mk-d-mx"><b>{fx(x)}</b> <span className="mk-d-xk">more {m.kind === 'chat' ? 'chat' : 'emotes'}</span> than the 15 minutes before
            {chip ? null : <button ref={chipRef} className="mk-d-why" type="button" {...whyProps}><InfoGlyph /></button>}</span> : null}
          <span className="mk-d-m2">{clk(m.at)}{sameDay(m.at, now) ? '' : ' yesterday'} · <b className="mk-d-st-c" title={streamTip(m, vod)}>{streamTime(m, vod)}</b> in
            {cat ? <> · {game === cat.id ? <span className="mk-d-gm">{gameIn}</span>
              : <button className="mk-d-gm" type="button" aria-label={`Show ${cat.name} moments`} title={`Show ${cat.name} moments`} onClick={() => onGame(cat.id)}>{gameIn}</button>}</> : null}
            {item.viewers != null ? ` · ${int(item.viewers)} viewers` : ''}</span>
        </p>
        {chip ? <button ref={chipRef} className="mk-hold" type="button" data-vd={item.verdict} {...whyProps}>
          <VdMark v={item.verdict} /><span>{word}</span><InfoGlyph />
        </button> : null}
        <div className="mk-pop" id={popId} hidden={!why}>
          <h3>{whyTitle}</h3>
          <ul className="mk-d-ck">{checks.map(c => <li key={c.id} data-lv={c.lv}>
            {c.lv === 'note' ? <span className="mk-nt" title="Corrected label"><VerdictGlyph level="note" /></span> : <VdMark v={c.lv} />}
            <span>{c.long}</span></li>)}</ul>
        </div>
      </div>
    </div>
    {/* under the verdict, above the minutes (A1, 10-22): on a 900 px window they were below the fold */}
    <div className="mk-d-acts">
      <a className="mk-btn pri" href={vod ? `https://www.twitch.tv/videos/${vod.vodId}?t=${hms(vodT)}` : `https://www.twitch.tv/${encodeURIComponent(item.login.toLowerCase())}`}
        target="_blank" rel="noopener noreferrer">Watch on Twitch<ExtGlyph /></a>
      <button className="mk-btn" type="button" aria-pressed={saved} onClick={onSave}><BookGlyph />{saved ? 'Saved' : 'Save'}</button>
      <button className="mk-btn" type="button" onClick={() => { void onCopy().finally(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600) }) }}><LinkGlyph />{copied ? 'Copied ✓' : 'Copy link'}</button>
    </div>
    {saveNote ? <p className="mk-note mk-d-note">{saveNote}</p> : null}
    <figure className="mk-ch" data-k={kind}>
      <div className="mk-ch-top"><h3>The minutes around it</h3>
        <div className="mk-seg" role="group" aria-label="Chart shows">
          {(['chat', 'emotes'] as const).map(k => <button key={k} type="button" aria-pressed={kind === k}
            onClick={() => { if (k !== kind) { anim.current = 'morph'; setMetric(k) } }}>{k === 'chat' ? 'Chat' : 'Emotes'}</button>)}
        </div>
      </div>
      <MomentChart m={m} series={series} metric={kind} lk={lk} hold={setLk} animRef={anim} motion={motion} phone={phone}
        vod={vod} pool={pool} onPlayAt={play} onGoto={onOpen} say={say} />
    </figure>
    {item.topEmotes.length ? <section className="mk-d-sec"><h3>What chat sent</h3>
      <div className="mk-d-em">{item.topEmotes.map(e => {
        const src = emoteImage(e)
        return <div className="mk-d-em-r" key={e.name}>{src ? <img src={src} alt="" /> : <span />}<b>{e.name}</b>
          <span className="mk-bt"><i style={{ width: `${(emTot ? Math.min(100, (e.count / emTot) * 100) : 0).toFixed(1)}%` }} /></span>
          <span className="mk-n">{int(e.count)}</span></div>
      })}</div>
      <p className="mk-d-em-f">{int(emTot)} emotes in {int(item.chat.perMin)} messages</p>
    </section> : null}
    {more.length ? <section className="mk-d-sec"><h3>More from this stream</h3>
      <ul className="mk-d-more" id={moreId}>{(moreOpen ? more : more.slice(0, MORE_SHOWN)).map(o => <li key={o.key}>
        <button type="button" onClick={() => onOpen(o.key)}>
          <time dateTime={new Date(o.at).toISOString()}>{clk(o.at)}</time>
          <MomentAct act={actOf(o.item)} />
          {o.rowX != null ? <span className="mk-r-x"><b>{fx(o.rowX)}</b> more {o.kind === 'chat' ? 'chat' : 'emotes'}</span> : null}
        </button>
      </li>)}</ul>
      {more.length > MORE_SHOWN ? <button className="mk-d-more-all" type="button" aria-expanded={moreOpen} aria-controls={moreId}
        onClick={() => setMoreAll(moreOpen ? null : m.sid)}>{moreOpen ? 'Show fewer' : `Show all ${more.length}`}</button> : null}
    </section> : null}
  </article>
}
