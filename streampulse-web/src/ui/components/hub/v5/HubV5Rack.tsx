/**
 * Where chat is (9A, 11-22; board artifacts/hub-audit-board-20261122 Q9): one
 * share bar for the top eight games and the rest, then the eight as rows. Each
 * row keeps the game's cover to the left of its name (Aron, 11-22: "the actual
 * game played card to the left the game name"; 27 × 36, else its initials),
 * then its tone, share and channel count. It replaces the ranked rack
 * (R5-22: 10 rows of bars, 16 in two columns). A row is a button: it lists the
 * game's channels in Channels (pressed), again shows every channel; the pressed
 * game's part of the bar takes the accent. Hover (after 90 ms) or keyboard
 * focus shows the game's card.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FocusEvent as ReactFocusEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { askGameArt, gameArtFor, missGameArt, subscribeGameArt } from '../../../../lib/hubGameArt'
import { HubToggletip } from '../d3/HubToggletip'
import { HubV5Avatar } from './HubV5Avatar'
// the leaf module, not the console entry, so the hub chunk stays without the console (fix, 10-30)
import { isTwitchPlaceholderBoxArt, twitchBoxArtByName } from '../../../../../../packages/analytics-console/src/utils/twitchBoxArt.ts'
import {
  HUB_CHAT_COUNTS_DOWN,
  HUB_NO_CATEGORY,
  HUB_RACK_ROWS,
  boxArtAt,
  channelChat,
  formatHubInt,
  gameAria,
  gameInitials,
  rackFoot,
  whereChatIsTip,
  type HubChatBasis,
  type HubGameShare,
  type HubWhereChatIs,
} from './hubV5Model'
import { isFocusVisible, placeHubV5Card } from './hubV5HoverCard'

const H_ID = 'hv5-gm-h'
/** The eight rows' tones, chat purple stepping down to greys, and the rest of the games (9A). */
const GAME_TONES = [
  'var(--hv5-chat)',
  'color-mix(in oklab, var(--hv5-chat) 72%, var(--sp-panel))',
  'color-mix(in oklab, var(--hv5-chat) 50%, var(--sp-panel))',
  'color-mix(in oklab, var(--hv5-chat) 32%, var(--sp-panel))',
  'color-mix(in oklab, var(--sp-text-3) 82%, var(--sp-panel))',
  'color-mix(in oklab, var(--sp-text-3) 62%, var(--sp-panel))',
  'color-mix(in oklab, var(--sp-text-3) 44%, var(--sp-panel))',
  'color-mix(in oklab, var(--sp-text-3) 30%, var(--sp-panel))',
] as const
const REST_TONE = 'var(--sp-line-strong)'

/**
 * A game's cover: the vetted art, else Twitch's box art by name, else one a
 * live stream's game list gave (hubGameArt, kept). A by-name cover that proves
 * to be Twitch's "?" placeholder shows the initials and asks hubGameArt to look
 * the game up in the game lists of `streamIds`, streams playing it (11-02), so
 * a new game gets its cover a moment later. A looked-up cover is checked the
 * same way: Twitch has no cover for some ids either, and then it stays the
 * initials.
 */
export function GameArt({ url, name, w, h, streamIds = [] }: { url: string | undefined; name: string; w: number; h: number; streamIds?: readonly (string | null | undefined)[] }) {
  const kept = useSyncExternalStore(subscribeGameArt, () => gameArtFor(name), () => undefined)
  // no vetted art: Twitch box art by name, at twice the box (fix, 10-30, LW-5/GP-5); a known miss goes straight to the initials
  const byName = !url && kept === undefined && name !== HUB_NO_CATEGORY ? twitchBoxArtByName(name, w * 2, h * 2) : null
  // three times the box, so the cover stays sharp
  const src = url ? boxArtAt(url, w * 3, h * 3) : kept ? boxArtAt(kept, w * 3, h * 3) : byName
  const [failed, setFailed] = useState<string | null>(null)
  const [checked, setChecked] = useState<string | null>(null)
  const missing = () => {
    setFailed(src)
    if (byName) askGameArt(name, streamIds)
    else missGameArt(name)
  }
  // the initials are the picture's stand-in: the row's own words name the game
  if (!src || failed === src) return <span aria-hidden="true">{gameInitials(name)}</span>
  if (url) return <img src={src} alt="" width={w} height={h} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(src)} />
  // an unknown name or id gets Twitch's grey "?" cover with HTTP 200 (no onError):
  // it loads with CORS and stays hidden until checked; a proven placeholder or a
  // failed load shows the initials, a check that cannot tell keeps the cover
  return (
    <img
      key={src}
      src={src}
      alt=""
      width={w}
      height={h}
      decoding="async"
      crossOrigin="anonymous"
      referrerPolicy="no-referrer"
      style={checked === src ? undefined : { opacity: 0 }}
      onLoad={(event) => {
        void isTwitchPlaceholderBoxArt(event.currentTarget)
          .then((placeholder) => (placeholder ? missing() : setChecked(src)))
          .catch(() => setChecked(src))
      }}
      onError={missing}
    />
  )
}

function GameCard({ g, rank, of, pressed, art, avatars, basis }: { g: HubGameShare; rank: number; of: number; pressed: boolean; art: string | undefined; avatars: ReadonlyMap<string, string>; basis?: HubChatBasis }) {
  const n = g.rows.length
  return (
    <>
      <div className="hv5-ec-h">
        <span className="hv5-ec-im hv5-gc-im"><GameArt url={art} name={g.name} w={30} h={40} streamIds={g.rows.map((c) => c.streamId)} /></span>
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
              <span>{formatHubInt(channelChat(c, basis))}/min</span>
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
  const restShare = games.all.slice(HUB_RACK_ROWS).reduce((sum, g) => sum + g.chatShare, 0)
  const restCount = games.all.length - list.length
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
        {/* the recent average says so (candidate, 10-30) */}
        <span className="hv5-meta hv5-gm-meta">{games.basis === 'avg_35' ? 'share of chat in the top 500 live channels · recent average' : 'share of chat in the top 500 live channels · last 5 min'}</span>
      </div>
      {list.length ? (
        <>
          {/* one bar of the shares: the eight rows' tones, then the rest of the games in one part */}
          <div
            className="hv5-gs"
            role="img"
            aria-label={`${list.map((g) => `${g.name} ${g.chatShare.toFixed(1)}%`).join(', ')}${restCount ? `, and ${restCount} more ${restCount === 1 ? 'game' : 'games'} ${restShare.toFixed(1)}%` : ''}`}
          >
            {list.map((g, i) => (
              <i key={g.name} style={{ flexGrow: g.chatShare, background: game === g.name ? 'var(--hv5-accent)' : GAME_TONES[i] }} />
            ))}
            {restCount > 0 && restShare > 0 ?<i style={{ flexGrow: restShare, background: REST_TONE }} /> : null}
          </div>
          <ol className="hv5-gr-list" aria-labelledby={H_ID}>
            {list.map((g, i) => {
              const pressed = game === g.name
              const n = g.rows.length
              return (
                <li key={g.name}>
                  <button type="button" className="hv5-gr" data-game={g.name} aria-pressed={pressed} onClick={onRow(g)}>
                    <span className="hv5-gr-art"><GameArt url={art.get(g.name)} name={g.name} w={27} h={36} streamIds={g.rows.map((c) => c.streamId)} /></span>
                    <span className="hv5-gr-nm" aria-hidden="true">{g.name}</span>
                    <span className="hv5-gr-v" aria-hidden="true"><i className="hv5-gr-sw" style={{ background: pressed ? 'var(--hv5-accent)' : GAME_TONES[i] }} />{g.chatShare.toFixed(1)}%</span>
                    <span className="hv5-gr-c" aria-hidden="true">{formatHubInt(n)} {n === 1 ? 'channel' : 'channels'}</span>
                    {/* Its words for screen readers; an aria-label would not match the row's own text (WCAG 2.5.3). */}
                    <span className="hv5-vh">{gameAria(g, pressed, games.basis)}</span>
                  </button>
                </li>
              )
            })}
          </ol>
          <p className="hv5-gr-foot">{rackFoot(games, HUB_RACK_ROWS)}</p>
        </>
      ) : loading ? (
        <div className="hv5-gr-skel" aria-hidden="true" />
      ) : (
        // our 5-minute read failed, not the channels (fix, 10-30)
        <p className="hv5-none">{unavailable ? 'Unavailable right now.' : games.down ? HUB_CHAT_COUNTS_DOWN : 'No channel has a full 5-minute window right now.'}</p>
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
              basis={games.basis}
            />
          </div>,
          document.body,
        )
        : null}
    </section>
  )
}
