/**
 * Channels (R5-7, mockup hub-r4.js trow / renderChannels): one short table of
 * the live pool. Channel, Game, Viewers, Chat/min, vs own avg; 10 rows and
 * "Show 10 more"; a filter field and the game chip from Where chat is. A dash
 * means not measured, with the reason for screen readers and on hover.
 */
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { HubLiveChannel } from '../../../../lib/publicHub'
import { HubToggletip } from '../d3/HubToggletip'
import { HubV5Avatar, HubV5Dash } from './HubV5Avatar'
import { HubV5Icon } from './HubV5Icon'
import {
  HUB_CHANNEL_SORTS,
  channelChat,
  channelHref,
  channelRows,
  channelVs,
  channelsTip,
  formatHubInt,
  formatHubMultiplier,
  formatHubRate,
  hasFullChatWindow,
  isLowMultiplier,
  multiplierWords,
  type HubChannelSort,
} from './hubV5Model'

const PER = 10

function VsCell({ channel }: { channel: HubLiveChannel }) {
  const vs = channelVs(channel)
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
  /** The game picked in Where chat is, or null. */
  game: string | null
  onClearGame: () => void
}

export const HubV5Channels = forwardRef<HTMLElement, HubV5ChannelsProps>(function HubV5Channels({ live, poolSize, game, onClearGame }, ref) {
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

  const rows = useMemo(() => channelRows(live, { q, game, sort, dir }), [live, q, game, sort, dir])
  const visible = rows.slice(0, n)
  const left = rows.length - visible.length

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

  const countLabel = game || q
    ? `${formatHubInt(rows.length)} ${rows.length === 1 ? 'channel' : 'channels'}`
    : `${formatHubInt(live.length)} of ${formatHubInt(poolSize)} live`

  return (
    <section
      id="channels"
      className="hv5-sec hv5-channels"
      aria-labelledby="hv5-cn-h"
      ref={(el) => {
        sectionRef.current = el
        if (typeof ref === 'function') ref(el)
        else if (ref) ref.current = el
      }}
    >
      <div className="hv5-rh">
        <h2 id="hv5-cn-h">Channels</h2>
        <span className="hv5-meta" data-hv5-channel-count="">{countLabel}</span>
        <HubToggletip tip={channelsTip(live.length, poolSize)} label="About Channels" />
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
                <button className="hv5-sortb" type="button" data-sort={key} data-on={sort === key ? '' : undefined} onClick={() => onSort(key)}>
                  {label}
                  {sort === key ? <HubV5Icon name={dir < 0 ? 'sortDown' : 'sortUp'} /> : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.length ? visible.map((c) => {
            const gm = c.category || '—'
            const chat = channelChat(c)
            return (
              <tr key={c.login} data-login={c.login}>
                <td className="c-ch">
                  <Link className="hv5-ch5-n" to={channelHref(c)}>
                    <HubV5Avatar login={c.login} name={c.displayName} src={c.profileImageUrl} size={24} />
                    <span className="hv5-ch5-tx">
                      <span className="hv5-ch5-nm">{c.displayName || c.login}</span>
                      <span className="hv5-ch5-g2">{gm}</span>
                    </span>
                  </Link>
                </td>
                <td className="c-gm">{gm}</td>
                <td className="r">{formatHubInt(c.viewers)}</td>
                <td className="r">
                  {hasFullChatWindow(c) && chat != null
                    ? formatHubRate(chat)
                    : <HubV5Dash why={c.coverageState === 'synced' ? 'no full 5 minutes yet' : 'viewers only'} />}
                </td>
                <td className="r"><VsCell channel={c} /></td>
              </tr>
            )
          }) : (
            <tr><td colSpan={5} className="hv5-ch5-none">No channels match.</td></tr>
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
