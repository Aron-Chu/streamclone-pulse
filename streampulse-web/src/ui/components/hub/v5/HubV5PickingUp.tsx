/**
 * Picking up now (M1 + P1, hub rail board 2026-11-02): the rail is only what is
 * heating up now; the day's moments are in Top moments today, the carousel under
 * the chart (HubV5BigMoments). Every live channel whose chat over the last 5
 * minutes ran at least 1.5× its own usual, strongest × first, with how many more
 * messages a minute beside it (hubV5FeedModel). Each row opens the stream page.
 *
 * At every width (desktop took the phone order, B1 11-11) the first 6 show and
 * "Show all N" opens the rest in place.
 *
 * H01 (11-13): once its data is over 15 minutes old, when the carousel's LIVE
 * badges go too (TOP_KEEP_MS), the old rows go: in their place it says it
 * can't tell, with the time it last knew, and shows no count (nor "Show all N").
 * Z06 (11-13): the × reads in pulse-core's words, "6.0× more chat".
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatLiftRatio } from '@streampulse/pulse-core'
import { HubToggletip } from '../d3/HubToggletip'
import '../d3/hub-d3-tokens.css'
import { HubV5Avatar } from './HubV5Avatar'
import { GameArt } from './HubV5Rack'
import type { TopToday } from './HubV5TopMoments'
import { FEED_ADD_MIN, FEED_NOW_MIN, FEED_UP_MIN, feedClockFloor, feedFreshText, feedMore, feedStale, type FeedUpRow } from './hubV5FeedModel'
import { channelHref, hubSavedClock } from './hubV5Model'
import { TOP_KEEP_MS } from './hubV5TopModel'

const H_ID = 'hv5-up-h'
/** Rows before "Show all N". */
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

function UpItem({ x, art }: { x: FeedUpRow; art: string | null }) {
  return (
    <li>
      <Link className="hv5-fd" to={channelHref({ login: x.login, streamId: x.streamId })} aria-label={upAria(x)}>
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
      </Link>
    </li>
  )
}

export interface HubV5PickingUpProps {
  top: Pick<TopToday, 'shown' | 'up' | 'upAsOf' | 'upSaved' | 'art'> & Partial<Pick<TopToday, 'upDown'>>
  nowMs: number
}

export function HubV5PickingUp({ top, nowMs }: HubV5PickingUpProps) {
  const { up, upAsOf, upSaved, art } = top
  const rows = up.up
  const n = rows.length
  const [all, setAll] = useState(false)
  const listed = all ? rows : rows.slice(0, UP_FIRST)
  const hidden = n - listed.length

  const none = top.shown?.source === 'none'
  // older than LIVE lasts: it can't tell what is picking up now (S1, 11-13)
  const old = upAsOf != null && nowMs - upAsOf > TOP_KEEP_MS
  const down = top.upDown === true || old
  // it waits while Top moments today does (the hub read runs), so it never says "nothing" before the answer
  const waiting = !none && !down && (upAsOf == null || top.shown == null)
  const saved = !waiting && upSaved && upAsOf != null ? hubSavedClock(upAsOf, nowMs) : null
  const fresh = waiting ? '' : saved ? `Saved ${saved}` : feedFreshText(upAsOf, nowMs)
  const stale = waiting || down || upAsOf == null || upSaved || feedStale(upAsOf, nowMs)

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
      <div className="hv5-tm-body">
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
          </>
        ) : n ? (
          <ol className="hv5-fd-list" aria-labelledby={H_ID}>
            {listed.map((x) => <UpItem key={x.login} x={x} art={x.cat ? art.get(x.cat) ?? null : null} />)}
          </ol>
        ) : (
          <p className="hv5-tm-q">{none ? UP_UNAVAILABLE : saved ? upSavedNone(saved) : UP_NONE}</p>
        )}
        {!old && (hidden > 0 || (all && n > UP_FIRST)) ? (
          <div className="hv5-fd-more">
            <button className="hv5-qb" type="button" aria-expanded={all} onClick={() => setAll((v) => !v)}>
              {all ? 'Show fewer' : `Show all ${n}`}
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  )
}
