/**
 * Channels (R5-7, mockup hub-r4.js trow / renderChannels): one short table of
 * the live pool. Channel, Game, Viewers, Chat/min, vs own avg; 10 rows and
 * "Show 10 more"; a filter field and the game chip from Where chat is. A dash
 * means not measured, with the reason for screen readers and on hover.
 *
 * Livelier rows (11-21): the game's small cover beside its name (as Picking up
 * and Where chat is show it), chat/min with Where chat is's purple bar against
 * the highest chat/min in the list, and "+93%" beside a channel the backend
 * picked as climbing (hubV5FeedModel feedClimbing), as the rail lists it.
 *
 * Rows slide on refresh (3A, Aron 11-22): when a new read lands with the same
 * filter, game, sort and range, a row that changed place slides from its old
 * row to its new one in 240 ms (FLIP: only its transform moves), a row new to
 * the page fades in, and a changed figure fades in. Nothing counts up. Sorting,
 * filtering, paging, a range switch, the first rows and reduced motion snap.
 */
import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { HubLiveChannel } from '../../../../lib/publicHub'
import { HubToggletip } from '../d3/HubToggletip'
import { HubV5Avatar, HubV5Dash } from './HubV5Avatar'
import { HubV5Icon } from './HubV5Icon'
import { GameArt } from './HubV5Rack'
import { feedPct, type FeedClimbRow } from './hubV5FeedModel'
import {
  HUB_CHANNEL_SORTS,
  channelChat,
  channelChatWhy,
  channelHref,
  channelRows,
  channelVs,
  channelsTip,
  formatHubInt,
  formatHubMultiplier,
  formatHubRate,
  hubChatBasis,
  hubSavedAt,
  isLowMultiplier,
  multiplierWords,
  type HubChannelSort,
  type HubChatBasis,
} from './hubV5Model'

const PER = 10

function VsCell({ channel, basis }: { channel: HubLiveChannel; basis: HubChatBasis }) {
  const vs = channelVs(channel, basis)
  if (!('x' in vs)) return <HubV5Dash why={vs.why} />
  return (
    <span className={`hv5-ch5-x${isLowMultiplier(vs.x) ? ' lo' : ''}`} aria-label={`chat ${multiplierWords(vs.x)} times own average`}>
      {formatHubMultiplier(vs.x)}
    </span>
  )
}

export interface HubV5ChannelsProps {
  live: readonly HubLiveChannel[]
  poolSize: number
  /** The hub request failed: no count, and the empty table says so (INT-02). */
  unavailable?: boolean
  /** The first hub reply has not landed: no count and no empty line yet. */
  loading?: boolean
  /** When the saved copy on screen was saved (S1, 10-28): the live count gives its time, "212 of 500 live at 10:50 AM". */
  savedAt?: number | null
  /** The page's clock, for the saved time's day. */
  nowMs?: number
  /** The game picked in Where chat is, or null. */
  game: string | null
  onClearGame: () => void
  /** A sort asked for from elsewhere (Picking up's "+N more in Channels"); a new `id` applies it. */
  sortRequest?: { id: number; sort: HubChannelSort; dir: 1 | -1 } | null
  /** The window of the hub answer on screen (the old one while a new range loads); on 30m and 24h a screener outage fills Chat/min with the recent average (up to 35 min) (candidate, 10-30). */
  windowKey?: string
  /** Vetted box art by game name (the page's map from the Moments list); without it a cover is looked up by name. */
  art?: ReadonlyMap<string, string>
  /** The backend's climbing picks on screen (the rail's Climbing list); each shows "+93%" beside its name. */
  climbing?: readonly FeedClimbRow[]
}

const climbWords = (pct: number) => `, ${Math.round(pct)}% busier than the 5 minutes before`

// The public prerender renders the hub with no window.
const calm = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const SLIDE: KeyframeAnimationOptions = { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
const FADE_ROW: KeyframeAnimationOptions = { duration: 200, easing: 'ease-out' }
const FADE_FIG: KeyframeAnimationOptions = { duration: 180, easing: 'ease-out' }
const fadeIn = (el: Element | null | undefined, timing: KeyframeAnimationOptions) => {
  el?.animate?.([{ opacity: 0 }, { opacity: 1 }], timing)
}

/** What the table showed, to tell a refresh from any other change: its rows in order and their figures. */
interface ShownRows {
  live: readonly HubLiveChannel[]
  view: string
  order: string[]
  figs: Map<string, readonly [string, string]>
}

export const HubV5Channels = forwardRef<HTMLElement, HubV5ChannelsProps>(function HubV5Channels({ live, poolSize, unavailable = false, loading = false, savedAt = null, nowMs, game, onClearGame, sortRequest, windowKey, art, climbing }, ref) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<HubChannelSort>('viewers')
  const [dir, setDir] = useState<1 | -1>(-1)
  const [n, setN] = useState(PER)
  const [focusSort, setFocusSort] = useState<HubChannelSort | null>(null)
  const sectionRef = useRef<HTMLElement | null>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const pendingMoreFocus = useRef<'1' | '0' | null>(null)

  // A new game (or none) starts again at 10 rows.
  useEffect(() => { setN(PER) }, [game])

  useEffect(() => {
    if (!sortRequest) return
    setSort(sortRequest.sort)
    setDir(sortRequest.dir)
    setN(PER)
  }, [sortRequest])

  const basis = useMemo(() => hubChatBasis(live, windowKey), [live, windowKey])
  const rows = useMemo(() => channelRows(live, { q, game, sort, dir, basis }), [live, q, game, sort, dir, basis])
  const visible = rows.slice(0, n)
  const left = rows.length - visible.length
  // the bars measure against the highest chat/min in the list as filtered, so they keep their lengths while paging
  const chatMax = useMemo(() => rows.reduce((max, c) => Math.max(max, channelChat(c, basis) ?? 0), 0), [rows, basis])
  const climbBy = useMemo(() => new Map((climbing ?? []).map((x) => [x.login, x.pct])), [climbing])

  // 3A: after every commit, note what the table shows; when only the read changed, slide the rows from where they were.
  // A row's old place is where the row now at its old index sits (rows are one height), so a resize between reads
  // never reads as a move.
  const tbodyRef = useRef<HTMLTableSectionElement>(null)
  const shownRef = useRef<ShownRows | null>(null)
  const view = `${q}|${game ?? ''}|${sort}|${dir}|${basis}|${windowKey ?? ''}`
  useLayoutEffect(() => {
    const figs = new Map(visible.map((c) => {
      const chat = channelChat(c, basis)
      return [c.login, [formatHubInt(c.viewers), chat != null ? formatHubRate(chat) : '']] as const
    }))
    const prev = shownRef.current
    shownRef.current = { live, view, order: visible.map((c) => c.login), figs }
    const body = tbodyRef.current
    if (!prev || !body || prev.live === live || prev.view !== view || !prev.order.length || calm()) return
    const trs = Array.from(body.querySelectorAll<HTMLTableRowElement>('tr[data-login]'))
    const was = new Map(prev.order.map((login, i) => [login, i]))
    trs.forEach((tr, i) => {
      const login = tr.dataset.login ?? ''
      const j = was.get(login)
      if (j == null || j >= trs.length) {
        fadeIn(tr, FADE_ROW)
        return
      }
      if (j !== i) {
        const dy = trs[j]!.offsetTop - tr.offsetTop
        if (Math.abs(dy) > 0.5) tr.animate?.([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], SLIDE)
      }
      const before = prev.figs.get(login)
      const now = figs.get(login)
      if (before && now) {
        if (before[0] !== now[0]) fadeIn(tr.querySelector('.hv5-ch5-vw'), FADE_FIG)
        if (before[1] !== now[1]) fadeIn(tr.querySelector('.hv5-ch5-cv'), FADE_FIG)
      }
    })
  })

  // Sorting re-renders the head; focus stays on the sort button that was pressed.
  useEffect(() => {
    if (!focusSort) return
    sectionRef.current?.querySelector<HTMLButtonElement>(`[data-sort="${focusSort}"]`)?.focus()
    setFocusSort(null)
  }, [focusSort])

  useEffect(() => {
    const want = pendingMoreFocus.current
    if (!want) return
    pendingMoreFocus.current = null
    const box = moreRef.current
    const next = box?.querySelector<HTMLButtonElement>(`[data-more="${want}"]`) ?? box?.querySelector<HTMLButtonElement>('[data-more]')
    next?.focus({ preventScroll: true })
  }, [n])

  const onSort = (key: HubChannelSort) => {
    if (sort === key) setDir((d) => (d === -1 ? 1 : -1))
    else {
      setSort(key)
      setDir(-1)
    }
    setN(PER)
    setFocusSort(key)
  }

  const onMore = (more: boolean) => {
    pendingMoreFocus.current = more ? '1' : '0'
    setN((value) => (more ? value + PER : PER))
    if (!more) sectionRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' })
  }

  const countLabel = (unavailable || loading) && !live.length ? ''
    : game || q
    ? `${formatHubInt(rows.length)} ${rows.length === 1 ? 'channel' : 'channels'}`
    : `Showing ${formatHubInt(live.length)} of ${formatHubInt(poolSize)} live${savedAt != null ? ` ${hubSavedAt(savedAt, nowMs ?? Date.now())}` : ''}`

  return (
    <section
      id="channels"
      className="hv5-sec hv5-channels"
      aria-labelledby="hv5-cn-h"
      aria-busy={loading || undefined}
      ref={(el) => {
        sectionRef.current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) ref.current = el
      }}
    >
      <div className="hv5-rh">
        <h2 id="hv5-cn-h">Channels</h2>
        <span className="hv5-meta" data-hv5-channel-count="">{countLabel}</span>
        {/* the recent average says so (candidate, 10-30) */}
        {basis === 'avg_35' ? <span className="hv5-meta" data-hv5-chat-basis="">Chat/min = recent average</span> : null}
        <HubToggletip tip={channelsTip(live.length, poolSize, basis)} label="About Channels" />
        <span className="hv5-end hv5-ch5-tools">
          {game ? (
            <span className="hv5-chip" data-chip="game">
              {game}
              <button
                className="hv5-ib"
                type="button"
                aria-label={`Remove the ${game} filter`}
                onClick={() => {
                  onClearGame()
                  filterRef.current?.focus()
                }}
              >
                <HubV5Icon name="x" />
              </button>
            </span>
          ) : null}
          <label className="hv5-field hv5-ch5-f">
            <HubV5Icon name="search" />
            <input
              ref={filterRef}
              type="text"
              placeholder="Filter channels or games…"
              aria-label="Filter channels or games"
              autoComplete="off"
              value={q}
              onChange={(event) => {
                setQ(event.target.value.trim() ? event.target.value : '')
                setN(PER)
              }}
            />
          </label>
        </span>
      </div>
      <table className={`hv5-tbl hv5-ch5${game ? ' one-game' : ''}`} aria-labelledby="hv5-cn-h">
        <colgroup>
          <col className="k-ch" />
          <col className="k-gm" />
          <col className="k-vw" />
          <col className="k-ct" />
          <col className="k-vs" />
        </colgroup>
        <thead>
          <tr>
            <th className="c-ch" scope="col">Channel</th>
            <th className="c-gm" scope="col">Game</th>
            {HUB_CHANNEL_SORTS.map(([key, label]) => (
              <th key={key} className={`r c-${key}`} scope="col" aria-sort={sort === key ? (dir < 0 ? 'descending' : 'ascending') : 'none'}>
                <button className="hv5-sortb" type="button" data-sort={key} data-on={sort === key ? '' : undefined} onClick={() => onSort(key)} title={key === 'vs' ? 'vs own avg' : label}>
                  {label}
                  {sort === key ? <HubV5Icon name={dir < 0 ? 'sortDown' : 'sortUp'} /> : null}
                  {/* "vs avg" is short for the channel's own average: the rest is said after the visible words (WCAG 2.5.3). */}
                  {key === 'vs' ? <span className="hv5-vh">(the channel’s own average)</span> : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody ref={tbodyRef}>
          {visible.length ? visible.map((c) => {
            const gm = c.category || '—'
            const chat = channelChat(c, basis)
            const climb = climbBy.get(c.login.toLowerCase())
            return (
              <tr key={c.login} data-login={c.login}>
                <td className="c-ch">
                  <Link className="hv5-ch5-n" to={channelHref(c)}>
                    <HubV5Avatar login={c.login} name={c.displayName} src={c.profileImageUrl} size={24} />
                    <span className="hv5-ch5-tx">
                      {/* the climbing mark rides the name's line, so a long game name on phones never pushes it toward Viewers */}
                      <span className="hv5-ch5-l1">
                        <span className="hv5-ch5-nm">{c.displayName || c.login}</span>
                        {climb != null ? (
                          <>
                            <span className="hv5-ch5-up" aria-hidden="true">{feedPct(climb)}</span>
                            <span className="hv5-vh">{climbWords(climb)}</span>
                          </>
                        ) : null}
                      </span>
                      <span className="hv5-ch5-g2">{gm}</span>
                    </span>
                  </Link>
                </td>
                <td className="c-gm">
                  {c.category ? (
                    <span className="hv5-ch5-gm">
                      <span className="hv5-tm-cv hv5-tm-gm" aria-hidden="true"><GameArt url={art?.get(c.category)} name={c.category} w={18} h={24} streamIds={[c.streamId]} /></span>
                      <span className="hv5-ch5-gn">{gm}</span>
                    </span>
                  ) : gm}
                </td>
                <td className="r"><span className="hv5-ch5-vw">{formatHubInt(c.viewers)}</span></td>
                <td className="r">
                  {chat != null ? (
                    <span className="hv5-ch5-ct">
                      {chatMax > 0 ? <span className="hv5-gr-bar hv5-ch5-bar" aria-hidden="true"><i style={{ width: `${Math.max(1.5, (chat / chatMax) * 100).toFixed(1)}%` }} /></span> : null}
                      <span className="hv5-ch5-cv">{formatHubRate(chat)}</span>
                    </span>
                  )
                    // the row's own screener reason, so a failed read never reads as a short window (fix, 10-30)
                    : <HubV5Dash why={channelChatWhy(c)} />}
                </td>
                <td className="r"><VsCell channel={c} basis={basis} /></td>
              </tr>
            )
          }) : loading ? null : (
            <tr><td colSpan={5} className="hv5-ch5-none">{unavailable && !live.length ? 'Unavailable right now.' : 'No channels match.'}</td></tr>
          )}
        </tbody>
      </table>
      <div className="hv5-ch5-more" ref={moreRef}>
        {left > 0 ? <button className="hv5-btn" type="button" data-more="1" onClick={() => onMore(true)}>Show {Math.min(PER, left)} more</button> : null}
        {visible.length > PER ? <button className="hv5-qb" type="button" data-more="0" onClick={() => onMore(false)}>Show fewer</button> : null}
        {rows.length > PER ? <span className="hv5-ch5-of">{formatHubInt(visible.length)} of {formatHubInt(rows.length)}</span> : null}
      </div>
    </section>
  )
})
