/**
 * Picking up now (M1 + P1, hub rail board 2026-11-02): the rail is only what is
 * heating up now; the day's moments are in Top moments today, the carousel under
 * the chart (HubV5BigMoments). Every live channel whose chat over the last 5
 * minutes ran at least 1.5× its own usual, strongest × first, with how many more
 * messages a minute beside it (hubV5FeedModel). Each row opens the stream page.
 *
 * From 1100 px the whole list is in the rail and scrolls inside it (the sticky
 * column from 1536 px, the row Top emotes and Where chat is give it from 1100),
 * its bottom fading while more is below. Narrower, the first 6 show and "Show
 * all N" opens the rest in place.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { fx } from '../../../../lib/momentsChecked'
import { useMatchMedia } from '../../../hooks/useMatchMedia'
import { HubToggletip } from '../d3/HubToggletip'
import '../d3/hub-d3-tokens.css'
import { HubV5Avatar } from './HubV5Avatar'
import { GameArt } from './HubV5Rack'
import type { TopToday } from './HubV5TopMoments'
import { FEED_ADD_MIN, FEED_NOW_MIN, FEED_UP_MIN, feedFreshText, feedMore, feedStale, type FeedUpRow } from './hubV5FeedModel'
import { channelHref, hubSavedClock } from './hubV5Model'

const H_ID = 'hv5-up-h'
/** Rows under 1100 px before "Show all N". */
export const UP_FIRST = 6
const SEP = <span className="hv5-fd-sep" aria-hidden="true">·</span>

export const UP_TIP = `Live channels whose chat over the last 5 minutes ran at least ${FEED_UP_MIN}× their own usual, `
  + `at least ${FEED_NOW_MIN} messages a minute and ${FEED_ADD_MIN} more than usual. Strongest × first; the figure beside it is how many more messages a minute.`
export const UP_NONE = 'Nothing is picking up right now.'
export const upSavedNone = (clock: string) => `Nothing was picking up as of ${clock}.`
export const UP_UNAVAILABLE = 'Unavailable right now.'

const upAria = (x: FeedUpRow) => `${x.name}, chat ${fx(x.x).replace('×', ' times')} its usual, ${feedMore(x.add)} more messages a minute${x.cat ? `, ${x.cat}` : ''}. Opens the stream page.`

function UpItem({ x, art }: { x: FeedUpRow; art: string | null }) {
  return (
    <li>
      <Link className="hv5-fd" to={channelHref({ login: x.login, streamId: x.streamId })} aria-label={upAria(x)}>
        <span className="hv5-fd-av"><HubV5Avatar login={x.login} name={x.name} src={x.avatar} size={28} /></span>
        <span className="hv5-fd-tx" aria-hidden="true">
          <span className="hv5-fd-l1"><span className="hv5-fd-nm">{x.name}</span></span>
          <span className="hv5-fd-l2">
            <span className="hv5-f2-x"><b>{fx(x.x)}</b> usual</span>
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
  top: Pick<TopToday, 'shown' | 'up' | 'upAsOf' | 'upSaved' | 'art'>
  nowMs: number
}

export function HubV5PickingUp({ top, nowMs }: HubV5PickingUpProps) {
  const { up, upAsOf, upSaved, art } = top
  const rows = up.up
  const n = rows.length
  const wide = useMatchMedia('(min-width: 1100px)')
  const [all, setAll] = useState(false)
  const listed = wide || all ? rows : rows.slice(0, UP_FIRST)
  const hidden = n - listed.length

  // the list scrolls inside the rail from 1100 px: its bottom fades only while more of it is below (hub-v5.css)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  const measureMore = useCallback(() => {
    const body = bodyRef.current
    setMore(!!body && body.scrollHeight - body.scrollTop - body.clientHeight > 1)
  }, [])
  useLayoutEffect(() => measureMore())
  useEffect(() => {
    const body = bodyRef.current
    if (!body || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measureMore)
    observer.observe(body)
    return () => observer.disconnect()
  }, [measureMore])

  const none = top.shown?.source === 'none'
  // it waits while Top moments today does (the hub read runs), so it never says "nothing" before the answer
  const waiting = !none && (upAsOf == null || top.shown == null)
  const saved = !waiting && upSaved && upAsOf != null ? hubSavedClock(upAsOf, nowMs) : null
  const fresh = waiting ? '' : saved ? `Saved ${saved}` : feedFreshText(upAsOf, nowMs)
  const stale = waiting || upAsOf == null || upSaved || feedStale(upAsOf, nowMs)

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
        {n ? <span className="hv5-end hv5-up-n" aria-label={`${n} ${n === 1 ? 'channel' : 'channels'}`}>{n}</span> : null}
      </div>
      <div ref={bodyRef} className="hv5-tm-body" data-more={more ? '' : undefined} onScroll={measureMore}>
        {waiting ? (
          <>
            <ol className="hv5-tm-list hv5-tm-wait" aria-busy="true" aria-hidden="true">
              {Array.from({ length: 6 }, (_, i) => <li key={i} />)}
            </ol>
            <p role="status" className="hv5-vh">Loading channels picking up</p>
          </>
        ) : n ? (
          <ol className="hv5-fd-list" aria-labelledby={H_ID}>
            {listed.map((x) => <UpItem key={x.login} x={x} art={x.cat ? art.get(x.cat) ?? null : null} />)}
          </ol>
        ) : (
          <p className="hv5-tm-q">{none ? UP_UNAVAILABLE : saved ? upSavedNone(saved) : UP_NONE}</p>
        )}
        {hidden > 0 || (all && !wide && n > UP_FIRST) ? (
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
