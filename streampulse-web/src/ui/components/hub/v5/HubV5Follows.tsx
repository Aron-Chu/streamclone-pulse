/**
 * Show my Twitch follows (11-01; Aron: "load their followed streamer using
 * twitch sign on"): the button in the hero's foot, and "Your follows" above
 * Busiest now. The button sends the viewer to Twitch (lib/twitchFollows.ts);
 * back on the hub, the row shows which of their follows are live here, on
 * Busiest now's tiles and strip. Where the site has no Twitch app, neither shows.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { HubLiveChannel } from '../../../../lib/publicHub'
import {
  connectTwitchFollows,
  dismissTwitchFollowsFailure,
  forgetTwitchFollows,
  useTwitchFollows,
  type TwitchFollows,
  type TwitchFollowsFailure,
} from '../../../../lib/twitchFollows'
import { HubToggletip } from '../d3/HubToggletip'
import { BusiestTile } from './HubV5Busiest'
import { HubV5Icon } from './HubV5Icon'
import { FOLLOWS_START_TIP, followsMeta, followsTip, rankFollows, type HubFollowsSet } from './hubV5FollowsModel'
import { busiestCue, busiestShowsPictures, formatHubInt, hubChatBasis, hubClock } from './hubV5Model'
import { useHubStrip } from './useHubStrip'

const H_ID = 'hv5-fol-h'
const TRACK_ID = 'hv5-fol-track'
const START_ID = 'hv5-fol-start'

/** Twitch's glyph (Simple Icons, CC0) on the button that goes to Twitch. */
function TwitchGlyph() {
  return (
    <svg className="hv5-fol-tw" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
    </svg>
  )
}

/**
 * Forget or Dismiss took the focused control away: focus goes to the hero's button, or to the row's heading when
 * the list stays, scrolled into view below the sticky nav. A task later, when React has drawn the change (not a
 * frame later: frames can stall while the page still counts as visible).
 */
function refocus(): void {
  window.setTimeout(() => {
    const target = document.getElementById(START_ID) ?? document.getElementById(H_ID)
    if (!target) return
    target.focus({ preventScroll: true })
    target.scrollIntoView({ block: 'nearest' })
  }, 0)
}

/** The hero foot's button, until a list is on the page. */
export function HubV5FollowsButton() {
  const state = useTwitchFollows()
  if (state.status !== 'idle' && state.status !== 'opening') return null
  const opening = state.status === 'opening'
  return (
    <span className="hv5-fol-start">
      <button id={START_ID} type="button" className="hv5-fol-go" onClick={connectTwitchFollows} aria-disabled={opening || undefined}>
        <TwitchGlyph />
        {opening ? 'Opening Twitch…' : 'Show my Twitch follows'}
      </button>
      <HubToggletip tip={FOLLOWS_START_TIP} label="About Show my Twitch follows" align="right" />
    </span>
  )
}

const FAILED: Record<TwitchFollowsFailure, string> = {
  denied: 'You cancelled on Twitch, so nothing was read.',
  unfinished: 'That Twitch sign-in didn’t finish in this tab, so nothing was read.',
  rejected: 'Twitch didn’t accept the sign-in, so nothing was read.',
  unreachable: 'Twitch didn’t answer, so your follows didn’t load.',
  storage: 'Your browser is blocking this tab’s storage, which the Twitch sign-in needs.',
}

function Section({ children, head }: { children?: ReactNode; head?: ReactNode }) {
  return (
    <section id="follows" className="hv5-sec hv5-fol" aria-labelledby={H_ID}>
      <div className="hv5-bzv-in">
        <header className="hv5-bzv-rh">
          <h2 id={H_ID} tabIndex={-1}>Your follows</h2>
          {head}
        </header>
        {children}
      </div>
    </section>
  )
}

interface RowProps {
  /** The same live list as Busiest now: empty while a saved copy waits for fresh data. */
  live: readonly HubLiveChannel[]
  nowMs: number
  loading?: boolean
  unavailable?: boolean
  windowKey?: string
  poolSize: number
}

/** "Your follows" while it reads, after it failed, and with the list. */
export function HubV5Follows(props: RowProps) {
  const state = useTwitchFollows()
  const { live, loading = false, unavailable = false, windowKey } = props
  const follows = state.status === 'ready' ? state.follows : null
  const basis = hubChatBasis(live, windowKey)
  const set = useMemo(() => (follows ? rankFollows(live, follows.logins, basis) : null), [live, follows, basis])

  // A read on this page ends in the live region, once the hub's channels are in: the row itself comes in silently.
  const [said, setSaid] = useState('')
  const armed = useRef(false)
  useEffect(() => {
    if (state.status === 'reading') armed.current = true
    else if (state.status !== 'ready') armed.current = false
    if (!follows || !set) {
      setSaid('')
      return undefined
    }
    if (!armed.current || loading) return undefined
    const text = unavailable ? 'Your follows are read, but live channels are unavailable right now.' : followsMeta(set, follows)
    const id = window.setTimeout(() => {
      armed.current = false
      setSaid(text)
    }, 30)
    return () => window.clearTimeout(id)
  }, [state.status, follows, set, loading, unavailable])

  if (state.status === 'off') return null
  let body: ReactNode = null
  if (state.status === 'reading') {
    const progress = state.read > 0 ? ` ${formatHubInt(state.read)}${state.total ? ` of ${formatHubInt(state.total)}` : ''}` : ''
    // the count changes with each page Twitch sends (up to 30): screen readers hear the line, then the result
    body = (
      <Section>
        <p className="hv5-fol-msg" role="status">Reading your follows from Twitch…{progress ? <span aria-hidden="true">{progress}</span> : null}</p>
        <div className="hv5-bzs-wait" aria-hidden="true" />
      </Section>
    )
  } else if (state.status === 'failed') {
    const dismiss = () => {
      dismissTwitchFollowsFailure()
      refocus()
    }
    body = (
      <Section>
        <div className="hv5-fol-fail">
          <p className="hv5-fol-msg" role="alert">{FAILED[state.why]}</p>
          {state.why === 'storage' ? null : <button type="button" className="hv5-btn" onClick={connectTwitchFollows}>Try again</button>}
          <button type="button" className="hv5-qb" onClick={dismiss}>Dismiss</button>
        </div>
      </Section>
    )
  } else if (follows && set) {
    body = <FollowsRow follows={follows} set={set} {...props} />
  }
  return (
    <>
      {body}
      <div className="hv5-vh" aria-live="polite" aria-atomic="true">{said}</div>
    </>
  )
}

function FollowsRow({ follows, set, live, nowMs, loading = false, unavailable = false, poolSize }: RowProps & { follows: TwitchFollows; set: HubFollowsSet }) {
  const cue = busiestCue(set, nowMs)
  const pictures = busiestShowsPictures(set, cue)
  const rows = set.rows
  const N = rows.length
  const { trackRef, pos, prevOff, nextOff, more, rove, page, onTrackKeyDown } = useHubStrip(N, rows.map((row) => row.login).join(' '))
  const avg = set.basis === 'avg_35'
  const hasWindow = Number.isFinite(set.windowEnd)
  // the summary waits for live channels: a saved copy or a read under way has none yet
  const settled = !loading && !unavailable
  const forget = () => {
    forgetTwitchFollows()
    refocus()
  }
  return (
    <Section
      head={(
        <>
          {settled ? <HubToggletip tip={<span className="hv5-pre">{followsTip(set, follows, live.length, poolSize)}</span>} label="About Your follows" /> : null}
          {settled && set.counted > 0 && (avg || hasWindow) ? (
            <span className="hv5-bzv-cue" data-cue={avg ? 'stale' : cue}>
              <i aria-hidden="true" />
              {avg ? '5-min counts unavailable' : cue === 'live' ? 'Live' : `Not updated since ${hubClock(set.windowEnd)}`}
            </span>
          ) : null}
          <p className="hv5-bzv-meta hv5-fol-meta">
            {settled ? <>{followsMeta(set, follows)}<span aria-hidden="true"> · </span></> : null}
            <button type="button" className="hv5-fol-x" onClick={forget} aria-label="Forget your Twitch follows">Forget</button>
          </p>
          {/* no pager while every tile is in view: a few follows fit on one page */}
          {settled && N && !(prevOff && nextOff) ? (
            <div className="hv5-bzc-pg">
              <span className="hv5-bzc-pos" aria-live="polite">{pos}</span>
              <button className="hv5-ib" type="button" aria-label="Previous follows" aria-controls={TRACK_ID} aria-disabled={prevOff} onClick={() => page(-1)}>
                <HubV5Icon name="left" />
              </button>
              <button className="hv5-ib" type="button" aria-label="Next follows" aria-controls={TRACK_ID} aria-disabled={nextOff} onClick={() => page(1)}>
                <HubV5Icon name="right" />
              </button>
            </div>
          ) : null}
        </>
      )}
    >
      {loading ? (
        <div className="hv5-bzs-wait" aria-hidden="true" />
      ) : unavailable ? (
        <p className="hv5-bzv-none">Unavailable right now.</p>
      ) : N ? (
        <div className={`hv5-bzc-vp hv5-bzs-vp${more.l ? ' more-l' : ''}${more.r ? ' more-r' : ''}`}>
          <ol ref={trackRef} id={TRACK_ID} className="hv5-bzc-track" aria-labelledby={H_ID} onKeyDown={onTrackKeyDown}>
            {rows.map((row, i) => (
              <li key={row.login} className="hv5-bzc-it" data-login={row.login}>
                <BusiestTile row={row} total={N} tab={i === rove} pictures={pictures} nowMs={nowMs} />
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Section>
  )
}
