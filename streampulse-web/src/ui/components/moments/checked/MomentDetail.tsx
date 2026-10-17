import { useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import {
  actOf, checkLines, clk, emoteImage, hms, int, LEAD_S, offAt, sameDay, seriesFromSpark, sortedChecks, streamTime, streamTip, streamWhere,
  stripModel, twitchCdnImage, verdictLine, VERDICT_WORD, type CheckedMoment, type MinuteSeries, type MomentVod,
} from '../../../../lib/momentsChecked'
import type { MomentMetricKind } from '../../../../lib/momentsFeed'
import { loadMomentMinuteSeries } from '../../../../lib/momentMinuteSeries'
import { loadMomentVod, vodEmbedSrc, vodSeconds } from '../../../../lib/momentsFeedVod'
import { MomentChart } from './MomentChart'
import { MomentAct } from './MomentAct'
import { BookGlyph, ExtGlyph, LinkGlyph, PlayGlyph, VdMark, VerdictGlyph, XGlyph } from './glyphs'

export interface DetailProps {
  m: CheckedMoment
  /** Every loaded moment: the stream strip and the held minute's "a moment here". */
  pool: CheckedMoment[]
  now: number
  metric: MomentMetricKind | null
  setMetric: (metric: MomentMetricKind) => void
  lk: number | null
  setLk: (rel: number | null) => void
  saved: boolean
  onSave: () => void
  onCopy: () => Promise<void>
  onOpen: (key: string, how: 'tick' | 'goto') => void
  onClose: () => void
  motion: boolean
  phone: boolean
  say: (text: string) => void
  /** The page's P key plays the open moment (or its held minute) through this. */
  playRef: MutableRefObject<((rel: number | null) => void) | null>
}

/**
 * The open moment (moments-r2 detail): the frame and Play, what happened and
 * when (in the stream first, the clock beside it), the verdict, the minutes
 * around it with a held minute, the stream strip, why it counts, and what chat
 * sent. Two reads, for this moment only: its stream record (the VOD) and its
 * minutes (the chart). Until the minutes answer, or if they don't, the chart
 * draws the feed's 25-minute sparkline.
 */
export function MomentDetail(props: DetailProps) {
  const { m, pool, now, metric, setMetric, lk, setLk, saved, onSave, onCopy, onOpen, onClose, motion, phone, say, playRef } = props
  const item = m.item
  const [vod, setVod] = useState<MomentVod | null>(null)
  const [minutes, setMinutes] = useState<MinuteSeries | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [frameFailed, setFrameFailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const media = useRef<HTMLDivElement>(null)
  const anim = useRef<'grow' | 'morph' | null>('grow')

  useEffect(() => {
    const controller = new AbortController()
    const moment = { login: item.login.toLowerCase(), streamId: item.streamId, offsetSeconds: item.offsetSeconds, minuteStart: item.minuteStart }
    loadMomentVod(item, controller.signal).then(setVod, () => { if (!controller.signal.aborted) setVod(null) })
    loadMomentMinuteSeries(moment, controller.signal).then(series => { if (series) { anim.current = 'morph'; setMinutes(series) } }, () => undefined)
    return () => controller.abort()
    // One moment, one pair of reads: a poll that sends the same moment again does not read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.key])

  const spark = useRef<{ key: string; series: MinuteSeries } | null>(null)
  if (!spark.current || spark.current.key !== m.key) spark.current = { key: m.key, series: seriesFromSpark(m) }
  const series = minutes ?? spark.current.series
  const kind = metric ?? m.kind
  const live = item.streamLive
  const frame = live && !frameFailed ? twitchCdnImage(item.liveFrameUrl) : undefined
  const boxArt = twitchCdnImage(item.category?.boxArtUrl)
  const avatar = twitchCdnImage(item.profileImageUrl)

  const play = (rel: number | null) => {
    if (!vod) return
    const t = vodSeconds(vod, rel != null ? offAt(m, rel) : item.offsetSeconds, LEAD_S)
    const host = window.location.hostname
    if (!host) { window.open(`https://www.twitch.tv/videos/${vod.vodId}?t=${hms(t)}`, '_blank', 'noopener'); return }
    setPlaying(vodEmbedSrc(vod.vodId, t, host))
    const el = media.current
    if (rel != null && el) {
      const r = el.getBoundingClientRect()
      if (r.top < 64 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'nearest', behavior: motion ? 'smooth' : 'auto' })
    }
  }
  playRef.current = play

  const checks = sortedChecks(m.checks.length ? m.checks : checkLines(item))
  const emTot = item.emotes.perMin ?? 0
  const lead = item.topEmotes[0], noLead = item.label.kind === 'emotes' && !item.label.spammed && lead
  const vodT = vod ? vodSeconds(vod, item.offsetSeconds, LEAD_S) : 0
  const act = actOf(item, true)

  return <article className="mk-d" data-key={m.key}>
    <div className={`mk-d-media${playing ? ' on' : ''}`} ref={media}>
      {playing
        ? <iframe title={`Twitch VOD of ${m.name}`} src={playing} allow="autoplay; fullscreen" allowFullScreen />
        : <>
          {frame ? <img src={frame} alt="" onError={() => setFrameFailed(true)} />
            : boxArt ? <img className="mk-d-bx" src={boxArt} alt="" /> : <span className="mk-d-noframe">No live frame</span>}
          {vod ? <button className="mk-d-play" type="button" onClick={() => play(null)}><PlayGlyph />Play from 10 s before</button> : null}
          <div className="mk-d-who">
            {avatar ? <img src={avatar} alt="" /> : null}
            <span className="mk-d-who-t"><b>{m.name}</b><span className="mk-lv">{live ? <><i />Live now{item.viewers != null ? ` · ${int(item.viewers)} watching` : ''}</> : 'Offline'}</span></span>
          </div>
        </>}
      <button className="mk-d-x" type="button" aria-label="Close" onClick={onClose}><XGlyph /></button>
    </div>
    <div className="mk-d-head">
      <h2 className="mk-d-l1"><span>{m.name}</span><MomentAct act={act} /></h2>
      <p className="mk-d-meta"><b className="mk-d-st-c" title={streamTip(m, vod)}>{streamTime(m, vod)}</b> {streamWhere(vod)} · {clk(m.at)}{sameDay(m.at, now) ? '' : ' yesterday'}{item.category ? ` · ${item.category.name}` : ''}</p>
    </div>
    <div className="mk-d-vd" data-vd={item.verdict}><VdMark v={item.verdict} /><b>{VERDICT_WORD[item.verdict]}</b><span>{verdictLine(m)}</span></div>
    <figure className="mk-ch" data-k={kind}>
      <div className="mk-ch-top"><h3>The minutes around it</h3>
        <div className="mk-seg" role="group" aria-label="Chart shows">
          {(['chat', 'emotes'] as const).map(k => <button key={k} type="button" aria-pressed={kind === k}
            onClick={() => { if (k !== kind) { anim.current = 'morph'; setMetric(k) } }}>{k === 'chat' ? 'Chat' : 'Emotes'}</button>)}
        </div>
      </div>
      <MomentChart m={m} series={series} metric={kind} lk={lk} hold={setLk} animRef={anim} motion={motion} phone={phone}
        vod={vod} pool={pool} onPlayAt={play} onGoto={key => onOpen(key, 'goto')} say={say} />
    </figure>
    <StreamStrip m={m} pool={pool} now={now} vod={vod} onOpen={key => onOpen(key, 'tick')} />
    <section className="mk-d-sec"><h3>Why it counts</h3>
      <ul className="mk-d-ck">{checks.map(c => <li key={c.id} data-lv={c.lv}>
        {c.lv === 'note' ? <span className="mk-nt" title="Corrected label"><VerdictGlyph level="note" /></span> : <VdMark v={c.lv} />}
        <span>{c.long}</span></li>)}</ul>
    </section>
    {item.topEmotes.length ? <section className="mk-d-sec"><h3>What chat sent at {clk(m.at)}</h3>
      <div className="mk-d-em">{item.topEmotes.map(e => {
        const src = emoteImage(e)
        return <div className="mk-d-em-r" key={e.name}>{src ? <img src={src} alt="" /> : <span />}<b>{e.name}</b>
          <span className="mk-bt"><i style={{ width: `${(emTot ? Math.min(100, (e.count / emTot) * 100) : 0).toFixed(1)}%` }} /></span>
          <span className="mk-n">{int(e.count)}</span></div>
      })}</div>
      <p className="mk-d-em-f">{int(emTot)} emotes in {int(item.chat.perMin)} messages{noLead ? `. No single emote led (${lead.name} was ${int(lead.count)}), so it says “emote burst”.` : '.'}</p>
    </section> : null}
    <div className="mk-d-acts">
      {vod
        ? <><button className="mk-btn pri" type="button" onClick={() => play(null)}><PlayGlyph />Play from 10 s before</button>
          <a className="mk-btn" href={`https://www.twitch.tv/videos/${vod.vodId}?t=${hms(vodT)}`} target="_blank" rel="noopener noreferrer"><ExtGlyph />Open on Twitch</a></>
        : <a className="mk-btn pri" href={`https://www.twitch.tv/${encodeURIComponent(item.login.toLowerCase())}`} target="_blank" rel="noopener noreferrer"><ExtGlyph />Watch live on Twitch</a>}
      <button className="mk-btn" type="button" aria-pressed={saved} onClick={onSave}><BookGlyph />{saved ? 'Saved' : 'Save'}</button>
      <button className="mk-btn" type="button" onClick={() => { void onCopy().finally(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600) }) }}><LinkGlyph />{copied ? 'Copied' : 'Copy link'}</button>
    </div>
  </article>
}

/** The stream strip (R2-1): the channel's moments on the stream's own timeline; a stem opens that moment. */
function StreamStrip({ m, pool, now, vod, onOpen }: { m: CheckedMoment; pool: CheckedMoment[]; now: number; vod: MomentVod | null; onOpen: (key: string) => void }) {
  const strip = stripModel(m, pool, now)
  if (!strip) return null
  return <section className="mk-d-st">
    <div className="mk-d-st-top"><h3>This stream</h3><span>{strip.count} moments · {strip.since}</span></div>
    <div className="mk-d-st-p" role="group" aria-label={`${m.name}’s moments in this stream`}>
      {strip.stems.map(({ m: x, left, h }) => {
        const label = `${streamTime(x, vod)} (${clk(x.at)}), ${actOf(x.item).text}, ${VERDICT_WORD[x.item.verdict].toLowerCase()}`
        return <button key={x.key} type="button" className="mk-d-st-t" data-tick={x.key} data-vd={x.item.verdict} aria-current={x.key === m.key}
          style={{ left: `${left.toFixed(2)}%`, ['--h' as string]: `${h.toFixed(0)}px` }} title={label} aria-label={label}
          onClick={() => { if (x.key !== m.key) onOpen(x.key) }}><i /></button>
      })}
    </div>
    <div className="mk-d-st-x" aria-hidden="true"><span>{strip.from}</span>{strip.marks.map(k => <span key={k.left} style={{ left: `${k.left.toFixed(2)}%` }}>{k.text}</span>)}<span>{strip.to}</span></div>
  </section>
}
