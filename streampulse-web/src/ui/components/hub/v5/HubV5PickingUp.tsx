/**
 * Picking up now (M1 + P1, hub rail board 2026-11-02): the rail is only what is
 * heating up now; the day's moments are in Top moments today, the list under
 * the chart (HubV5TopList). Every live channel whose chat over the last 5
 * minutes ran at least 1.5× its own usual, strongest × first, with how many more
 * messages a minute beside it (hubV5FeedModel). Each row opens the stream page.
 *
 * Under 1536 px (desktop took the phone order, B1 11-11) the first 6 show and
 * "Show all N" opens the rest in place. From 1536 px it is the sticky column on
 * the right again (L1, 11-16, as on 11-08): the whole list is in it and scrolls
 * inside it, its bottom fading while more is below.
 *
 * H01 (11-13): once its data is over 15 minutes old (TOP_KEEP_MS), the old rows
 * go: in their place it says it
 * can't tell, with the time it last knew, and shows no count (nor "Show all N").
 * Z06 (11-13): the × reads in pulse-core's words, "6.0× more chat".
 *
 * Climbing (11-21): while the chat counts behind it did not load, under its
 * "can't tell" line it lists the backend's own surge picks from the same hub
 * answer (hubV5FeedModel feedClimbing: the last 5 minutes against the 5
 * before), so the column still says what is heating up. Not on a saved copy,
 * and gone once the answer is older than LIVE lasts.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatLiftRatio } from '@streampulse/pulse-core'
import { useMatchMedia } from '../../../hooks/useMatchMedia'
import { HubToggletip } from '../d3/HubToggletip'
import '../d3/hub-d3-tokens.css'
import { HubV5Avatar } from './HubV5Avatar'
import { GameArt } from './HubV5Rack'
import type { TopToday } from './HubV5TopMoments'
import { FEED_ADD_MIN, FEED_NOW_MIN, FEED_UP_MIN, feedClockFloor, feedFreshText, feedMore, feedPct, feedStale, type FeedClimbRow, type FeedUpRow } from './hubV5FeedModel'
import { channelHref, hubSavedClock } from './hubV5Model'
import { TOP_KEEP_MS } from './hubV5TopModel'

const H_ID = 'hv5-up-h'
const C_ID = 'hv5-up-climb-h'
/** Rows under 1536 px before "Show all N". */
export const UP_FIRST = 6
const SEP = <span className="hv5-fd-sep" aria-hidden="true">·</span>

export const UP_TIP = `Live channels whose chat over the last 5 minutes ran at least ${FEED_UP_MIN}× their own usual, `
  + `at least ${FEED_NOW_MIN} messages a minute and ${FEED_ADD_MIN} more than usual. Strongest × first; the figure beside it is how many more messages a minute.`
export const UP_NONE = 'Nothing is picking up right now.'
export const upSavedNone = (clock: string) => `Nothing was picking up as of ${clock}.`
export const UP_UNAVAILABLE = 'Unavailable right now.'
/** The chat counts behind the list did not load: never "nothing is picking up". */
export const UP_DOWN = "Can't tell right now — chat counts didn't load."
/** The data is older than LIVE lasts (15 min): the same line, with the time it last knew. */
export const upOld = (clock: string) => `Can't tell right now — last known at ${clock}.`

const upAria = (x: FeedUpRow) => `${x.name}, ${formatLiftRatio(x.x)} times more chat, ${feedMore(x.add)} more messages a minute${x.cat ? `, ${x.cat}` : ''}. Opens the stream page.`

export const CLIMB_TIP = 'While Picking up can’t tell: live channels whose chat and emotes over the last 5 minutes ran at least 60% above '
  + 'the 5 minutes before, with at least 30 chat messages (or 8 7TV emotes) a minute. Biggest rise first. A shorter, rougher '
  + 'comparison than Picking up’s, which measures each channel against its own usual.'
const climbAria = (x: FeedClimbRow) => `${x.name}, ${Math.round(x.pct)}% busier than the 5 minutes before${x.cat ? `, ${x.cat}` : ''}. Opens the stream page.`

function ClimbItem({ x, art }: { x: FeedClimbRow; art: string | null }) {
  return (
    <li>
      <Link className="hv5-fd" to={channelHref({ login: x.login, streamId: x.streamId })}>
        <span className="hv5-fd-av"><HubV5Avatar login={x.login} name={x.name} src={x.avatar} size={28} /></span>
        <span className="hv5-fd-tx" aria-hidden="true">
          <span className="hv5-fd-l1"><span className="hv5-fd-nm">{x.name}</span></span>
          <span className="hv5-fd-l2">
            <span className="hv5-f2-x"><b>{feedPct(x.pct)}</b> busier</span>
            {x.cat ? <>{SEP}<span className="hv5-fd-g">{x.cat}</span></> : null}
          </span>
        </span>
        {x.cat ? <span className="hv5-up-gm" aria-hidden="true"><GameArt url={art ?? undefined} name={x.cat} w={18} h={24} streamIds={[x.streamId]} /></span> : <span />}
        <span className="hv5-vh">{climbAria(x)}</span>
      </Link>
    </li>
  )
}

function UpItem({ x, art }: { x: FeedUpRow; art: string | null }) {
  return (
    <li>
      <Link className="hv5-fd" to={channelHref({ login: x.login, streamId: x.streamId })}>
        <span className="hv5-fd-av"><HubV5Avatar login={x.login} name={x.name} src={x.avatar} size={28} /></span>
        <span className="hv5-fd-tx" aria-hidden="true">
          <span className="hv5-fd-l1"><span className="hv5-fd-nm">{x.name}</span></span>
          <span className="hv5-fd-l2">
            <span className="hv5-f2-x"><b>{formatLiftRatio(x.x)}×</b> more chat</span>
            {SEP}
            <span className="hv5-up-add">+{feedMore(x.add)}/min</span>
            {x.cat ? <>{SEP}<span className="hv5-fd-g">{x.cat}</span></> : null}
          </span>
        </span>
        {x.cat ? <span className="hv5-up-gm" aria-hidden="true"><GameArt url={art ?? undefined} name={x.cat} w={18} h={24} streamIds={[x.streamId]} /></span> : <span />}
        {/* Its words for screen readers; an aria-label would not match the row's own text (WCAG 2.5.3). */}
        <span className="hv5-vh">{upAria(x)}</span>
      </Link>
    </li>
  )
}

export interface HubV5PickingUpProps {
  top: Pick<TopToday, 'shown' | 'up' | 'upAsOf' | 'upSaved' | 'art'> & Partial<Pick<TopToday, 'upDown'>>
  nowMs: number
  /** The backend's surge picks from the hub answer on screen, and when it was made; none on a saved copy (Climbing, 11-21). */
  climbing?: { rows: readonly FeedClimbRow[]; asOf: number | null }
}

const NO_CLIMB: readonly FeedClimbRow[] = []

/**
 * Climbing's rows as the rail shows them: only in place of an empty "can't tell" (counts down, no rows kept), from
 * an answer younger than LIVE lasts. Channels marks only these, so the table never points at a list that isn't there.
 */
export function climbOnScreen(top: HubV5PickingUpProps['top'], climbing: HubV5PickingUpProps['climbing'], nowMs: number): readonly FeedClimbRow[] {
  const old = top.upAsOf != null && nowMs - top.upAsOf > TOP_KEEP_MS
  const asOf = climbing?.asOf ?? null
  return top.upDown === true && !old && !top.up.up.length && asOf != null && nowMs - asOf <= TOP_KEEP_MS ? climbing?.rows ?? NO_CLIMB : NO_CLIMB
}

export function HubV5PickingUp({ top, nowMs, climbing }: HubV5PickingUpProps) {
  const { up, upAsOf, upSaved, art } = top
  const rows = up.up
  const n = rows.length
  // from 1536 px the whole list is in the right column (L1, 11-16)
  const wide = useMatchMedia('(min-width: 1536px)')
  const [all, setAll] = useState(false)
  const listed = wide || all ? rows : rows.slice(0, UP_FIRST)

  // the list scrolls inside the column from 1536 px: its bottom fades only while more of it is below (hub-v5.css)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  const measureMore = useCallback(() => {
    const body = bodyRef.current
    setMore(!!body && body.scrollHeight - body.scrollTop - body.clientHeight > 1)
  }, [])

  const none = top.shown?.source === 'none'
  // older than LIVE lasts: it can't tell what is picking up now (S1, 11-13)
  const old = upAsOf != null && nowMs - upAsOf > TOP_KEEP_MS
  const down = top.upDown === true || old
  // it waits while Top moments today does (the hub read runs), so it never says "nothing" before the answer
  const waiting = !none && !down && (upAsOf == null || top.shown == null)
  const saved = !waiting && upSaved && upAsOf != null ? hubSavedClock(upAsOf, nowMs) : null
  const fresh = waiting ? '' : saved ? `Saved ${saved}` : feedFreshText(upAsOf, nowMs)
  const stale = waiting || down || upAsOf == null || upSaved || feedStale(upAsOf, nowMs)
  // Climbing: only in place of an empty "can't tell" (climbOnScreen); it greys as the list does past 2 minutes
  const climbAsOf = climbing?.asOf ?? null
  const climb = climbOnScreen(top, climbing, nowMs)
  const climbStale = climbAsOf != null && feedStale(climbAsOf, nowMs)
  const climbListed = wide || all ? climb : climb.slice(0, UP_FIRST)
  // "Show all N" counts whichever list is on screen
  const total = climb.length || n
  const hidden = total - (climb.length ? climbListed.length : listed.length)

  // Measured only where the list scrolls inside the column (from 1536 px), and only when the body or what is in it
  // changes size: a ResizeObserver reads after layout, where a layout effect on every render forced one (about
  // 200 ms on a phone, S1 11-19). A new branch (loading, rows, a line) observes its new children.
  const branch = waiting ? 'wait' : down ? `down${n}` : n ? 'rows' : 'none'
  useEffect(() => {
    const body = bodyRef.current
    if (!wide || !body || typeof ResizeObserver === 'undefined') {
      setMore(false)
      return undefined
    }
    const observer = new ResizeObserver(measureMore)
    observer.observe(body)
    for (const child of Array.from(body.children)) observer.observe(child)
    return () => observer.disconnect()
  }, [measureMore, wide, branch, all])

  return (
    <aside
      id="latest"
      className={`hv5-sec hv5-latest hv5-feed hv5-top hv5-up${stale ? ' hv5-f2-stale' : ''}`}
      aria-labelledby={H_ID}
    >
      <div className="hv5-rh">
        <h2 id={H_ID}><span className="hv5-fd-dot" aria-hidden="true" />Picking up now</h2>
        <span className="hv5-f2-fresh">{fresh}</span>
        {waiting || none ? null : <HubToggletip tip={UP_TIP} label="About Picking up now" />}
        {n && !down ? (
          <span className="hv5-end hv5-up-n">
            <span aria-hidden="true">{n}</span>
            <span className="hv5-vh">{`${n} ${n === 1 ? 'channel' : 'channels'}`}</span>
          </span>
        ) : null}
      </div>
      <div ref={bodyRef} className="hv5-tm-body" data-more={more ? '' : undefined} onScroll={measureMore}>
        {waiting ? (
          <>
            <ol className="hv5-tm-list hv5-tm-wait" aria-busy="true" aria-hidden="true">
              {Array.from({ length: 6 }, (_, i) => <li key={i} />)}
            </ol>
            <p role="status" className="hv5-vh">Loading channels picking up</p>
          </>
        ) : down ? (
          <>
            <p className="hv5-tm-q" data-up-down>{old && upAsOf != null ? upOld(saved ?? feedClockFloor(upAsOf)) : UP_DOWN}</p>
            {n && !old ? (
              <ol className="hv5-fd-list hv5-up-old" aria-labelledby={H_ID}>
                {listed.map((x) => <UpItem key={x.login} x={x} art={x.cat ? art.get(x.cat) ?? null : null} />)}
              </ol>
            ) : null}
            {climb.length ? (
              <div className={`hv5-up-climb${climbStale ? ' hv5-up-climb-old' : ''}`} data-up-climb="">
                <div className="hv5-up-ch">
                  <h3 id={C_ID}>Climbing</h3>
                  <span className="hv5-meta">last 5 min vs the 5 before</span>
                  <HubToggletip tip={CLIMB_TIP} label="About Climbing" />
                </div>
                <ol className="hv5-fd-list" aria-labelledby={C_ID}>
                  {climbListed.map((x) => <ClimbItem key={x.login} x={x} art={x.cat ? art.get(x.cat) ?? null : null} />)}
                </ol>
              </div>
            ) : null}
          </>
        ) : n ? (
          <ol className="hv5-fd-list" aria-labelledby={H_ID}>
            {listed.map((x) => <UpItem key={x.login} x={x} art={x.cat ? art.get(x.cat) ?? null : null} />)}
          </ol>
        ) : (
          <p className="hv5-tm-q">{none ? UP_UNAVAILABLE : saved ? upSavedNone(saved) : UP_NONE}</p>
        )}
        {!old && (hidden > 0 || (all && !wide && total > UP_FIRST)) ? (
          <div className="hv5-fd-more">
            <button className="hv5-qb" type="button" aria-expanded={all} onClick={() => setAll((v) => !v)}>
              {all ? 'Show fewer' : `Show all ${total}`}
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
