/**
 * The hub's search (R5-12 / R5-14, mockup hub.js masthead), in the hero
 * ("hero": 60 px field with a Search button) or docked in the top bar once the
 * hero's has scrolled under it ("dock": compact, Enter to go). Both boxes share
 * the typed text through the hub search store; each keeps its own list. Focus
 * lists the busiest live channels; typing filters them; Enter opens the
 * highlighted row, else the exact live channel, else the typed login's page.
 *
 * One box that knows more (3A, 11-02): a login no live row matches gets, after
 * a pause in typing, a real row from StreamPulse's records ("xQc · Offline ·
 * last streamed Oct 31 · GTA V", or "Can't check right now" when the read
 * fails); "Games live now" lists the games live channels are counted in, and a
 * pick sets the hub's game filter; "Emotes" lists the hub's counted emotes,
 * and a pick finds the emote on the Top emotes map. Off the hub both picks
 * open the hub with ?game= or ?emote=.
 */
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { HubLiveChannel } from '../../../../lib/publicHub'
import { buildAnalyticsHref } from '../../../../lib/analyticsLinks'
import { lookupChannel, lookupLine, readChannelLookup, type ChannelLookup } from '../../../../lib/channelLookup'
import { sanitizeEmoteImageUrl } from '../../../../lib/emoteAssetUrl'
import { isPlausibleTwitchLogin } from '../../../../lib/normalizeTwitchLogin'
import { HubV5Avatar } from './HubV5Avatar'
import { HubV5Icon } from './HubV5Icon'
import {
  boxArtAt,
  gameInitials,
  channelHref,
  channelsByViewers,
  formatHubInt,
  hubEmoteHref,
  hubGameHref,
  searchChannels,
  searchEmotes,
  searchGames,
  typedLogin,
  type HubSearchEmote,
  type HubSearchGame,
} from './hubV5Model'
import { useHubV5Search, useHubV5SearchStore } from './hubV5SearchStore'

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent)
/** Q1 (11-02): the field says what it finds; its name keeps the verb. */
export const HUB_SEARCH_PLACEHOLDER = 'Streamers or games'
/** The field's name for screen readers: the placeholder's words, said as an action. */
export const HUB_SEARCH_LABEL = 'Search streamers or games'
const BLUR_CLOSE_MS = 150
/** K1 (11-02): the window this much taller than the visual viewport means a phone keyboard is up. */
const KEYBOARD_MIN_PX = 100
/** The pause in typing before the box asks about a login: one read per settled name, not one per key. */
export const LOOKUP_DELAY_MS = 300
const NO_GAMES: readonly HubSearchGame[] = []
const NO_EMOTES: readonly HubSearchEmote[] = []
const PROVIDERS: Record<string, string> = { twitch: 'Twitch', seventv: '7TV', '7tv': '7TV', bttv: 'BTTV', ffz: 'FFZ' }

type Option =
  | { kind: 'channel'; key: string; href: string; channel: HubLiveChannel }
  | { kind: 'login'; key: string; href: string; login: string; lookup: ChannelLookup | null }
  | { kind: 'game'; key: string; href: string; game: HubSearchGame }
  | { kind: 'emote'; key: string; href: string; emote: HubSearchEmote }

const HEADINGS: Record<Option['kind'], string> = { channel: 'Live now', login: 'Channels', game: 'Games live now', emote: 'Emotes' }

function loginHref(login: string, lookup: ChannelLookup | null): string {
  return buildAnalyticsHref({ login, streamId: lookup?.state === 'recorded' ? lookup.stream.streamId : undefined })
}

export function HubV5SearchBox({
  live,
  variant,
  games = NO_GAMES,
  emotes = NO_EMOTES,
}: {
  live: readonly HubLiveChannel[]
  variant: 'hero' | 'dock'
  /** The games live channels are counted in (hubSearchGames). */
  games?: readonly HubSearchGame[]
  /** The hub's counted emotes (hubSearchEmotes). */
  emotes?: readonly HubSearchEmote[]
}) {
  const navigate = useNavigate()
  const store = useHubV5SearchStore()
  const value = useHubV5Search((s) => s.value)
  const uid = useId()
  const inputId = `${uid}q`
  const listId = `${uid}sugg`
  const optionId = (i: number) => `${uid}sg${i}`
  const inputRef = useRef<HTMLInputElement | null>(null)
  const blurTimer = useRef<number | undefined>(undefined)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [found, setFound] = useState<ChannelLookup | null>(null)

  const byViewers = useMemo(() => channelsByViewers(live), [live])
  const gameHits = useMemo(() => searchGames(games, value), [games, value])
  const emoteHits = useMemo(() => searchEmotes(emotes, value, 2), [emotes, value])
  // with games or emotes to show, four live rows, so the list stays about as tall as six
  const result = useMemo(() => searchChannels(byViewers, value, gameHits.length || emoteHits.length ? 4 : 6), [byViewers, value, gameHits.length, emoteHits.length])

  // A login no live row matches: once typing pauses, StreamPulse's records for it (kept answers show at once).
  const login = result.openLogin
  useEffect(() => {
    if (!login || !open) return undefined
    const kept = readChannelLookup(login)
    if (kept) {
      setFound(kept)
      return undefined
    }
    let current = true
    const timer = window.setTimeout(() => {
      void lookupChannel(login).then((answer) => { if (current) setFound(answer) })
    }, LOOKUP_DELAY_MS)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [login, open])
  const lookup = found && found.login === login ? found : null

  const options = useMemo<Option[]>(() => [
    ...result.channels.map((c): Option => ({ kind: 'channel', key: c.login, href: channelHref(c), channel: c })),
    ...(login ? [{ kind: 'login', key: `login:${login}`, href: loginHref(login, lookup), login, lookup } satisfies Option] : []),
    ...gameHits.map((g): Option => ({ kind: 'game', key: `game:${g.name}`, href: hubGameHref(g.name), game: g })),
    ...emoteHits.map((e): Option => ({ kind: 'emote', key: `emote:${e.provider || ''}:${e.name}`, href: hubEmoteHref(e.name), emote: e })),
  ], [result, login, lookup, gameHits, emoteHits])
  const typed = value.trim()
  const empty = Boolean(typed) && !options.length
  const expanded = open && (options.length > 0 || empty)

  const close = useCallback(() => {
    setOpen(false)
    setActive(-1)
  }, [])

  useEffect(() => () => window.clearTimeout(blurTimer.current), [])
  // K1 (11-02): with a phone keyboard up, rows under it could not be reached. While the list is open it ends 8 px
  // above the keyboard (no shorter than 120 px) and scrolls inside; the page stays put. Keyboard closed, nothing changes.
  // The visible bottom is the lower of the two readings: Chrome measures the list from the layout viewport, so the
  // visual viewport's offset counts, but iPhone Safari measured it from the visual viewport itself, and adding the
  // offset there left the front page's list 170 px under the keyboard (real phones, 11-03).
  useEffect(() => {
    const list = listRef.current
    const vv = typeof window === 'undefined' ? null : window.visualViewport
    if (!expanded || !list || !vv) return undefined
    const fit = () => {
      if (window.innerHeight - vv.height * vv.scale < KEYBOARD_MIN_PX) {
        list.style.removeProperty('--hv5-sugg-room')
        return
      }
      const bottom = Math.min(vv.height, vv.offsetTop + vv.height)
      const room = Math.max(120, Math.floor(bottom - list.getBoundingClientRect().top - 8))
      list.style.setProperty('--hv5-sugg-room', `${room}px`)
    }
    fit()
    vv.addEventListener('resize', fit)
    vv.addEventListener('scroll', fit)
    // the room stays set while the closing list fades, so it doesn't grow on its way out
    return () => {
      vv.removeEventListener('resize', fit)
      vv.removeEventListener('scroll', fit)
    }
  }, [expanded])
  // the list scrolls inside when long: the arrow keys keep their row in sight
  useEffect(() => {
    if (active >= 0) document.getElementById(`${uid}sg${active}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [active, uid])
  useEffect(() => {
    const inputs = store.inputs
    inputs[variant] = inputRef.current
    return () => {
      if (inputs[variant] === inputRef.current) inputs[variant] = null
    }
  }, [store, variant])

  /** On the hub a game or an emote acts in place (the game filter, the map); the text clears so the list goes. */
  const actOn = (option: Option): boolean => {
    const act = option.kind === 'game' ? store.actions.game : option.kind === 'emote' ? store.actions.emote : null
    if (!act) return false
    close()
    store.set({ value: '' })
    inputRef.current?.blur()
    act(option.kind === 'game' ? option.game.name : option.kind === 'emote' ? option.emote.name : '')
    return true
  }

  /** The highlighted row, else the exact live channel, else the typed login's page, else (text no login can be, "Just Chatting") the first game. */
  const go = (): boolean => {
    const t = typedLogin(value)
    const exact = t ? byViewers.find((c) => c.login === t) : undefined
    const firstGame = !exact && !(t && isPlausibleTwitchLogin(t)) ? options.find((o) => o.kind === 'game') : undefined
    const picked = open && active >= 0 ? options[active] : firstGame
    if (picked && actOn(picked)) return true
    const href = picked
      ? picked.href
      : exact
        ? channelHref(exact)
        : t && isPlausibleTwitchLogin(t)
          ? loginHref(t, lookup)
          : null
    if (!href) return false
    close()
    navigate(href)
    return true
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) setOpen(true)
      if (!options.length) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((i) => ((open ? i : -1) + step + options.length) % options.length)
      return
    }
    if (event.key === 'Enter') {
      if (go()) event.preventDefault()
      return
    }
    if (event.key === 'Escape') {
      if (expanded) {
        event.preventDefault()
        close()
      } else if (value) {
        store.set({ value: '' })
      } else {
        inputRef.current?.blur()
      }
    }
  }

  const onPick = (option: Option) => (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (actOn(option)) {
      event.preventDefault()
      return
    }
    close()
  }

  return (
    <div className={variant === 'hero' ? 'hv5-search' : 'hv5-search hv5-search--dock'} role="search">
      <label className="hv5-field" htmlFor={inputId}>
        <HubV5Icon name="search" />
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
          aria-label={HUB_SEARCH_LABEL}
          placeholder={HUB_SEARCH_PLACEHOLDER}
          spellCheck={false}
          autoComplete="off"
          value={value}
          onChange={(event) => {
            store.set({ value: event.target.value })
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => {
            window.clearTimeout(blurTimer.current)
            setOpen(true)
            setActive(-1)
          }}
          onBlur={() => {
            window.clearTimeout(blurTimer.current)
            blurTimer.current = window.setTimeout(close, BLUR_CLOSE_MS)
          }}
          onKeyDown={onKeyDown}
        />
        <span className="hv5-kbd" aria-hidden="true">{IS_MAC ? '⌘K' : 'Ctrl K'}</span>
        {variant === 'hero' ? (
          <button
            className="hv5-hero-go"
            type="button"
            onClick={(event) => {
              event.preventDefault()
              if (go()) return
              inputRef.current?.focus()
              setOpen(true)
            }}
          >
            Search
          </button>
        ) : null}
      </label>
      <div ref={listRef} className="hv5-sugg" id={listId} role="listbox" aria-label="Search suggestions" hidden={!expanded}>
        {options.map((option, i) => {
          // a heading over each group: live channels (or the busiest, before typing), the looked-up login, games, emotes
          const prev = options[i - 1]
          const group = option.kind === 'login' && prev?.kind === 'channel' ? null : option.kind !== prev?.kind ? (option.kind === 'channel' && !typed ? 'Busiest live channels' : HEADINGS[option.kind]) : null
          return (
            <Fragment key={option.key}>
              {group ? <div className="hv5-sg-h" aria-hidden="true">{group}</div> : null}
              <Link
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                // under live rows the login's row sits below a rule, as "Open analytics for" always has
                className={option.kind === 'login' && prev?.kind === 'channel' ? 'hv5-sg-open' : undefined}
                data-kind={option.kind}
                data-state={option.kind === 'login' ? option.lookup?.state ?? 'pending' : undefined}
                to={option.href}
                tabIndex={-1}
                onClick={onPick(option)}
              >
                <OptionBody option={option} />
              </Link>
            </Fragment>
          )
        })}
        {empty ? <div className="hv5-sg-none">Nothing live matches “{typed}”.</div> : null}
      </div>
    </div>
  )
}

function OptionBody({ option }: { option: Option }) {
  if (option.kind === 'channel') {
    const c = option.channel
    return (
      <>
        <HubV5Avatar login={c.login} name={c.displayName} src={c.profileImageUrl} size={32} />
        <span className="hv5-sg-tx">
          <span className="hv5-sg-nm">{c.displayName || c.login}</span>
          <span className="hv5-sg-c">{c.category || 'No category'}</span>
        </span>
        <span className="hv5-sg-v">{c.viewers != null ? `${formatHubInt(c.viewers)} viewers` : ''}</span>
      </>
    )
  }
  if (option.kind === 'login') {
    const { login, lookup } = option
    // what StreamPulse holds for the login; until the read answers (or when it fails) the plain "Open analytics for"
    if (lookup && lookup.state !== 'unknown') {
      return (
        <>
          <HubV5Avatar login={login} name={lookup.profile?.displayName} src={lookup.profile?.avatar} size={32} />
          <span className="hv5-sg-tx">
            <span className="hv5-sg-nm">{lookup.profile?.displayName || login}</span>
            <span className="hv5-sg-c">{lookupLine(lookup)}</span>
          </span>
        </>
      )
    }
    return (
      <>
        <HubV5Icon name="search" />
        <span>Open analytics for <b>{login}</b></span>
        <span className="hv5-sg-k">{lookup ? lookupLine(lookup) : 'Enter'}</span>
      </>
    )
  }
  if (option.kind === 'game') {
    const g = option.game
    return (
      <>
        <span className="hv5-sg-gm" aria-hidden="true"><SearchGameArt url={g.art} name={g.name} /></span>
        <span className="hv5-sg-tx">
          <span className="hv5-sg-nm">{g.name}</span>
          <span className="hv5-sg-c">{g.n === 1 ? '1 channel live' : `${formatHubInt(g.n)} channels live`}</span>
        </span>
        <span className="hv5-sg-v">Show channels</span>
      </>
    )
  }
  const e = option.emote
  const src = sanitizeEmoteImageUrl(e.imageUrl)
  return (
    <>
      <span className="hv5-sg-em" aria-hidden="true">{src ? <img src={src} alt="" width={28} height={28} decoding="async" referrerPolicy="no-referrer" /> : null}</span>
      <span className="hv5-sg-tx">
        <span className="hv5-sg-nm">{e.name}</span>
        <span className="hv5-sg-c">{PROVIDERS[e.provider || ''] || 'Emote'}</span>
      </span>
      <span className="hv5-sg-v">Find on the map</span>
    </>
  )
}

/**
 * A game's cover in a suggestion: the vetted art when the hub sent one, else its initials. Not the rack's GameArt,
 * which falls back to Twitch art by name from the analytics package: the front page shares this box, and public
 * pages stay free of analytics UI.
 */
function SearchGameArt({ url, name }: { url: string | undefined; name: string }) {
  const src = url ? boxArtAt(url, 72, 96) : null
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) return <span>{gameInitials(name)}</span>
  return <img src={src} alt="" width={24} height={32} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(src)} />
}
