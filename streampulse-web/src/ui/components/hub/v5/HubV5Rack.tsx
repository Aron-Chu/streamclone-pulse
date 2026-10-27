/**
 * Where chat is as the ranked rack (R5-22, mockup d3-v5 hub-rack.js /
 * hub-rack.css; the header and hover card from hub-r4.js and hub-r5e.css).
 * Aron rejected the covers-first layouts as "low resolution and slightly
 * distracting": here each game keeps a small cover (30 × 40, else its
 * initials) and the share goes into a bar in chat purple, so the eye lands on
 * where chat is. 10 rows; 16 in two columns of 8 when the block is 620 px or
 * wider. A row is a button: it lists the game's channels in Channels (pressed),
 * again shows every channel. Hover (after 90 ms) or keyboard focus shows the
 * game's card.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { HubToggletip } from '../d3/HubToggletip'
import { HubV5Avatar } from './HubV5Avatar'
import {
  HUB_RACK_NARROW_ROWS,
  HUB_RACK_ROWS,
  boxArtAt,
  channelChat,
  formatHubInt,
  gameAria,
  gameInitials,
  rackFoot,
  whereChatIsTip,
  type HubGameShare,
  type HubWhereChatIs,
} from './hubV5Model'
import { isFocusVisible, placeHubV5Card } from './hubV5HoverCard'

const H_ID = 'hv5-gm-h'

function GameArt({ url, name, w, h }: { url: string | undefined; name: string; w: number; h: number }) {
  const [failed, setFailed] = useState(false)
  if (!url || failed) return <span>{gameInitials(name)}</span>
  // three times the box, so the cover stays sharp
  return <img src={boxArtAt(url, w * 3, h * 3)} alt="" width={w} height={h} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}

function GameCard({ g, rank, of, pressed, art, avatars }: { g: HubGameShare; rank: number; of: number; pressed: boolean; art: string | undefined; avatars: ReadonlyMap<string, string> }) {
  const n = g.rows.length
  return (
    <>
      <div className="hv5-ec-h">
        <span className="hv5-ec-im hv5-gc-im"><GameArt url={art} name={g.name} w={30} h={40} /></span>
        <span className="hv5-ec-tx"><b>{g.name}</b><span>#{rank} of {of} games by chat</span></span>
      </div>
      <dl className="hv5-ec-dl">
        <dt>Share of chat</dt>
        <dd>{g.chatShare.toFixed(1)}% <span>· {formatHubInt(g.chat)}/min</span></dd>
        <dt>Share of viewers</dt>
        <dd>{g.viewerShare.toFixed(1)}% <span>· {formatHubInt(g.viewers)} watching</span></dd>
        <dt>Channels</dt>
        <dd>{n}</dd>
        <dt>Most chat</dt>
        <dd className="hv5-gc-top">
          {g.rows.slice(0, 3).map((c) => (
            <span key={c.login} className="hv5-gc-ch">
              <HubV5Avatar login={c.login} name={c.displayName} src={avatars.get(c.login) ?? c.profileImageUrl} size={20} />
              <span>{c.displayName || c.login}</span>
              <span>{formatHubInt(channelChat(c))}/min</span>
            </span>
          ))}
        </dd>
      </dl>
      <p className="hv5-ec-f">{pressed ? 'Listed in Channels · click to show every channel' : 'Click to list its channels in Channels'}</p>
    </>
  )
}

export function HubV5Rack({ games, game, onGame, art, avatars, loading, unavailable }: {
  games: HubWhereChatIs
  game: string | null
  onGame: (game: string | null) => void
  /** Box art by category name. */
  art: ReadonlyMap<string, string>
  avatars: ReadonlyMap<string, string>
  loading?: boolean
  /** The hub request failed: the empty line says so (INT-02). */
  unavailable?: boolean
}) {
  const list = games.all.slice(0, HUB_RACK_ROWS)
  const max = list[0]?.chatShare || 1
  const secRef = useRef<HTMLElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [on, setOn] = useState<{ name: string; el: HTMLElement } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const hide = useCallback(() => {
    window.clearTimeout(timer.current)
    setOn(null)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  // a game that left the rack (a new poll) takes its card with it
  useEffect(() => {
    if (on && (!on.el.isConnected || !games.all.some((g) => g.name === on.name))) hide()
  }, [games, on, hide])
  useEffect(() => {
    if (!on) return undefined
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') hide() }
    const onScroll = () => { if (!secRef.current?.contains(document.activeElement)) hide() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [on, hide])
  useLayoutEffect(() => {
    if (on && on.el.isConnected && cardRef.current) placeHubV5Card(cardRef.current, on.el)
  }, [on, game, games])

  const rowOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('[data-game]') : null)
  const handlers = {
    onPointerOver: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === 'touch') return
      const el = rowOf(event.target)
      if (!el || el === on?.el) return
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        if (el.isConnected) setOn({ name: el.dataset.game!, el })
      }, on ? 0 : 90)
    },
    onPointerOut: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === 'touch') return
      const to = rowOf(event.relatedTarget)
      if (!to || !secRef.current?.contains(to)) hide()
    },
    onFocus: (event: ReactFocusEvent<HTMLElement>) => {
      const el = rowOf(event.target)
      if (el && isFocusVisible(el)) setOn({ name: el.dataset.game!, el })
    },
    onBlur: (event: ReactFocusEvent<HTMLElement>) => {
      if (!(event.relatedTarget instanceof Node) || !secRef.current?.contains(event.relatedTarget)) hide()
    },
  }

  // the open card re-renders with the new pressed state, so it says what the click did
  const onRow = (g: HubGameShare) => () => onGame(game === g.name ? null : g.name)

  const current = on ? games.all.find((g) => g.name === on.name) : undefined

  return (
    <section id="games" ref={secRef} className="hv5-sec hv5-games" aria-labelledby={H_ID} aria-busy={loading || undefined} {...handlers}>
      <div className="hv5-rh hv5-gm-rh">
        <h2 id={H_ID}>Where chat is</h2>
        <HubToggletip tip={whereChatIsTip(games)} label="About Where chat is" />
        <span className="hv5-meta hv5-gm-meta">share of chat in the top 500 live channels · last 5 min</span>
      </div>
      {list.length ? (
        <>
          <ol className="hv5-gr-list" aria-labelledby={H_ID}>
            {list.map((g) => {
              const pressed = game === g.name
              const n = g.rows.length
              return (
                <li key={g.name}>
                  <button type="button" className="hv5-gr" data-game={g.name} aria-pressed={pressed} aria-label={gameAria(g, pressed)} onClick={onRow(g)}>
                    <span className="hv5-gr-art"><GameArt url={art.get(g.name)} name={g.name} w={30} h={40} /></span>
                    <span className="hv5-gr-nm">{g.name}</span>
                    <span className="hv5-gr-v">{g.chatShare.toFixed(1)}%</span>
                    <span className="hv5-gr-bar" aria-hidden="true"><i style={{ width: `${Math.max(1.5, (g.chatShare / max) * 100).toFixed(1)}%` }} /></span>
                    <span className="hv5-gr-c">{formatHubInt(n)} {n === 1 ? 'channel' : 'channels'}</span>
                  </button>
                </li>
              )
            })}
          </ol>
          <p className="hv5-gr-foot hv5-gr-f10">{rackFoot(games, HUB_RACK_NARROW_ROWS)}</p>
          <p className="hv5-gr-foot hv5-gr-f16">{rackFoot(games, HUB_RACK_ROWS)}</p>
        </>
      ) : loading ? (
        <div className="hv5-gr-skel" aria-hidden="true" />
      ) : (
        <p className="hv5-none">{unavailable ? 'Unavailable right now.' : 'No channel has a full 5-minute window right now.'}</p>
      )}
      {current && on && typeof document !== 'undefined'
        ? createPortal(
          <div ref={cardRef} className="hub-d3-layer hv5-layer hv5-em-card hv5-gp-card" aria-hidden="true" style={{ left: 0, top: 0, visibility: 'hidden' }}>
            <GameCard
              g={current}
              rank={games.all.indexOf(current) + 1}
              of={games.all.length}
              pressed={game === current.name}
              art={art.get(current.name)}
              avatars={avatars}
            />
          </div>,
          document.body,
        )
        : null}
    </section>
  )
}
