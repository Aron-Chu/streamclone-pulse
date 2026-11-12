/**
 * The d3-v5 hub's hero search (R5-12 / R5-14, mockup hub.js masthead): "Find
 * your streamer", a 60 px field with a Search button (HubV5SearchBox), what
 * the extension does (HubV5Promo), five live channels to try, and what the hub
 * covers. Once the field scrolls under the top bar the bar shows its own box
 * (HubV5DockSearch, the mockup's docked search), and once the install card
 * leaves the screen the bar shows its install button; this sets both in the
 * hub search store. / and Ctrl/⌘K focus whichever box is on show. Behind it
 * runs the emote conveyor at Soft (R5-15, HubV5Conveyor); the mockup's
 * hero-motion switch was a proposal aid and is not ported.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { HubActivityPoint, HubLiveChannel } from '../../../../lib/publicHub'
import type { HubSearchEmote, HubSearchGame } from './hubV5Model'
import { HubV5Avatar } from './HubV5Avatar'
import { HubV5Conveyor, type HubV5ConveyorRefs } from './HubV5Conveyor'
import { HubV5Promo } from './HubV5Promo'
import { HubV5SearchBox } from './HubV5SearchBox'
import { channelHref, channelsByViewers, formatHubInt } from './hubV5Model'
import { useHubV5SearchStore } from './hubV5SearchStore'

const NO_POINTS: readonly HubActivityPoint[] = []

/** The bottom of the sticky top bar, which the hero's field and install card scroll under. */
function barBottom(): number {
  return Math.round(document.querySelector('.analytics-topnav')?.getBoundingClientRect().bottom ?? 0)
}

/**
 * `foot`: beside the scope line, under the hero's rule (Show my Twitch follows, 11-01). `games` and `emotes`: what the search offers besides channels (3A).
 * `waiting`: the hub's first answer is still on its way, so the Try row and the scope line keep their room and nothing below moves when they land.
 */
export function HubV5Hero({ live, poolSize, points = NO_POINTS, foot, games, emotes, waiting = false }: { live: readonly HubLiveChannel[]; poolSize: number; points?: readonly HubActivityPoint[]; foot?: ReactNode; games?: readonly HubSearchGame[]; emotes?: readonly HubSearchEmote[]; waiting?: boolean }) {
  const store = useHubV5SearchStore()
  const mastRef = useRef<HTMLElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const tryRef = useRef<HTMLParagraphElement>(null)
  const getRef = useRef<HTMLDivElement>(null)
  const footRef = useRef<HTMLDivElement>(null)
  const conveyorRefs = useMemo<HubV5ConveyorRefs>(
    () => ({ mast: mastRef, title: titleRef, field: fieldRef, tryRow: tryRef, getRow: getRef, foot: footRef }),
    [],
  )

  // Docked once the field's bottom is above the bar's; the install card counts as on screen while
  // any of it shows below the bar. Watched against the bar's height, again whenever it changes.
  useEffect(() => {
    const field = fieldRef.current
    const promo = getRef.current
    if (!field || typeof IntersectionObserver === 'undefined') return undefined
    let io: IntersectionObserver | null = null
    let barH = -1
    const watch = () => {
      const h = barBottom()
      if (h === barH) return
      barH = h
      io?.disconnect()
      io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === field) store.set({ docked: !entry.isIntersecting && entry.boundingClientRect.bottom <= barH + 1 })
          else store.set({ promoVisible: entry.isIntersecting })
        }
      }, { rootMargin: `${-barH}px 0px 0px 0px` })
      io.observe(field)
      if (promo) io.observe(promo)
    }
    watch()
    const bar = document.querySelector('.analytics-topnav')
    const ro = bar && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(watch) : null
    if (bar) ro?.observe(bar)
    return () => {
      io?.disconnect()
      ro?.disconnect()
      store.set({ docked: false, promoVisible: true })
    }
  }, [store])

  // / and Ctrl/⌘K focus the box on show: the bar's once docked (opening its row when narrow), else the hero's.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const inField = Boolean(target && (/INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable))
      const cmdK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'
      const slash = event.key === '/' && !inField && !event.metaKey && !event.ctrlKey && !event.altKey
      if (!cmdK && !slash) return
      event.preventDefault()
      const { inputs } = store
      const dock = store.get().docked ? inputs.dock : null
      if (dock && !dock.getClientRects().length) inputs.openDock?.()
      const input = dock ?? inputs.hero
      input?.focus()
      input?.select()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [store])

  const tryChannels = useMemo(() => channelsByViewers(live).slice(0, 5), [live])

  return (
    <header className="hv5-mast" ref={mastRef}>
      <HubV5Conveyor points={points} refs={conveyorRefs} />
      <h1 className="hv5-hero-h" ref={titleRef}>Find your streamer</h1>
      <p className="hv5-hero-sub">Chat, emotes and top moments for the Twitch channels we track, minute by minute.</p>
      <div className="hv5-hero-field" ref={fieldRef}>
        <HubV5SearchBox live={live} variant="hero" games={games} emotes={emotes} />
      </div>
      {/* What you get, under the search, which stays first (Aron's C1 pick, 10-21; the scene is direction A of the 11-01 board). */}
      <HubV5Promo ref={getRef} />
      {tryChannels.length ? (
        <p className="hv5-hero-try" ref={tryRef}>
          <span className="hv5-hero-tl">Try</span>
          {tryChannels.map((c) => (
            <Link
              key={c.login}
              className="hv5-hero-chip"
              to={channelHref(c)}
              aria-label={`${c.displayName || c.login}, live, ${formatHubInt(c.viewers || 0)} viewers`}
            >
              <HubV5Avatar login={c.login} name={c.displayName} src={c.profileImageUrl} size={24} />
              <span>{c.displayName || c.login}</span>
            </Link>
          ))}
        </p>
      ) : waiting ? (
        // Keeps the chips' room while the first answer loads (hub-v5.css), so they land without a shift.
        <p className="hv5-hero-try" ref={tryRef} data-wait="" aria-hidden="true" />
      ) : null}
      <div className="hv5-hero-foot" ref={footRef}>
        {/* The hub's one channel count (B1, 11-11): every list below says what it shows of it. */}
        {poolSize > 0 ? <p className="hv5-scope">{formatHubInt(poolSize)} live channels tracked · not all of Twitch</p>
          // The same line without its number, unseen, so it wraps as the real one will.
          : waiting ? <p className="hv5-scope" data-wait="" aria-hidden="true">The live channels tracked · not all of Twitch</p>
            : null}
        {foot}
      </div>
    </header>
  )
}
