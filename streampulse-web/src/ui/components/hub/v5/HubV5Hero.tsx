/**
 * The d3-v5 hub's hero search (R5-12 / R5-14, mockup hub.js masthead): "Find
 * your streamer", a 60 px field with a Search button, five live channels to
 * try, and what the hub covers. Focus lists the busiest live channels; typing
 * filters them; Enter opens the highlighted row, else the exact live channel,
 * else "Open analytics for" a plausible login. / and Ctrl/⌘K focus the field.
 * The mockup's docked top-bar button is not part of this page (the top bar is
 * the shared analytics shell). Behind it runs the emote conveyor at Soft
 * (R5-15, HubV5Conveyor); the mockup's hero-motion switch was a proposal aid
 * and is not ported.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import panelChart from '../../../../demo/pictures/panel-chart-2x.webp'
import panelCard from '../../../../demo/pictures/panel-moment-card-2x.webp'
import panelMoments from '../../../../demo/pictures/panel-top-moments-2x.webp'
import type { HubActivityPoint, HubLiveChannel } from '../../../../lib/publicHub'
import { buildAnalyticsHref } from '../../../../lib/analyticsLinks'
import { isPlausibleTwitchLogin } from '../../../../lib/normalizeTwitchLogin'
import { ChromeInstallCta } from '../../ChromeInstallCta'
import { HubV5Avatar } from './HubV5Avatar'
import { HubV5Conveyor, type HubV5ConveyorRefs } from './HubV5Conveyor'
import { HubV5Icon } from './HubV5Icon'
import { useMedia } from './HubV5LiveFeed'
import { channelHref, channelsByViewers, formatHubInt, searchChannels, typedLogin } from './hubV5Model'

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent)
const PLACEHOLDER = 'Search any Twitch channel'
const BLUR_CLOSE_MS = 150

interface Option {
  key: string
  href: string
  channel: HubLiveChannel | null
}

const NO_POINTS: readonly HubActivityPoint[] = []
/** P2 (10-22): 2× captures of the real panel (the sandbox /extension demo): Top moments, the chart, a moment's card. */
const PANEL_FRAMES = [panelMoments, panelChart, panelCard] as const
const PANEL_FRAME_MS = 4000

/** The panel's three states crossfading every 4 s; hover holds the one on show; reduced motion keeps the first. */
function PanelFrames() {
  const reduce = useMedia('(prefers-reduced-motion: reduce)')
  const [at, setAt] = useState(0)
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (reduce || held) return undefined
    const id = window.setInterval(() => setAt((n) => (n + 1) % PANEL_FRAMES.length), PANEL_FRAME_MS)
    return () => window.clearInterval(id)
  }, [reduce, held])
  const on = reduce ? 0 : at
  return (
    <div className="hv5-get-pic" aria-hidden="true" onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}>
      {PANEL_FRAMES.map((src, i) => (
        <img key={src} src={src} alt="" width={338} height={188} decoding="async" className={i === on ? 'on' : undefined} />
      ))}
      {reduce ? null : (
        <span className="hv5-get-dots">
          {PANEL_FRAMES.map((src, i) => <i key={src} className={i === on ? 'on' : undefined} />)}
        </span>
      )}
    </div>
  )
}

export function HubV5Hero({ live, poolSize, points = NO_POINTS }: { live: readonly HubLiveChannel[]; poolSize: number; points?: readonly HubActivityPoint[] }) {
  const navigate = useNavigate()
  const uid = useId()
  const inputId = `${uid}q`
  const listId = `${uid}sugg`
  const optionId = (i: number) => `${uid}sg${i}`
  const inputRef = useRef<HTMLInputElement>(null)
  const mastRef = useRef<HTMLElement>(null)
  const kickerRef = useRef<HTMLParagraphElement>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const tryRef = useRef<HTMLParagraphElement>(null)
  const getRef = useRef<HTMLDivElement>(null)
  const footRef = useRef<HTMLDivElement>(null)
  const conveyorRefs = useMemo<HubV5ConveyorRefs>(
    () => ({ mast: mastRef, kicker: kickerRef, field: fieldRef, tryRow: tryRef, getRow: getRef, foot: footRef }),
    [],
  )
  const blurTimer = useRef<number | undefined>(undefined)
  const [value, setValue] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)

  const byViewers = useMemo(() => channelsByViewers(live), [live])
  const result = useMemo(() => searchChannels(byViewers, value), [byViewers, value])
  const options = useMemo<Option[]>(() => [
    ...result.channels.map((c) => ({ key: c.login, href: channelHref(c), channel: c })),
    ...(result.openLogin ? [{ key: `open:${result.openLogin}`, href: buildAnalyticsHref({ login: result.openLogin }), channel: null }] : []),
  ], [result])
  const expanded = open && (options.length > 0 || result.empty)

  const close = useCallback(() => {
    setOpen(false)
    setActive(-1)
  }, [])

  useEffect(() => () => window.clearTimeout(blurTimer.current), [])

  // / and Ctrl/⌘K focus the field from anywhere on the page.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const inField = Boolean(target && (/INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable))
      const cmdK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'
      const slash = event.key === '/' && !inField && !event.metaKey && !event.ctrlKey && !event.altKey
      if (!cmdK && !slash) return
      event.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  /** The highlighted row, else the exact live channel, else "Open analytics for" a plausible login. */
  const go = (): boolean => {
    const t = typedLogin(value)
    const exact = t ? byViewers.find((c) => c.login === t) : undefined
    const href = open && active >= 0 && options[active]
      ? options[active]!.href
      : exact
        ? channelHref(exact)
        : t && isPlausibleTwitchLogin(t)
          ? buildAnalyticsHref({ login: t })
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
        setValue('')
      } else {
        inputRef.current?.blur()
      }
    }
  }

  const tryChannels = byViewers.slice(0, 5)

  return (
    <header className="hv5-mast" ref={mastRef}>
      <HubV5Conveyor points={points} refs={conveyorRefs} />
      <p className="hv5-hero-k" ref={kickerRef}>Analytics</p>
      <h1 className="hv5-hero-h">Find your streamer</h1>
      <p className="hv5-hero-sub">Chat, emotes and top moments for any Twitch channel, minute by minute.</p>
      <div className="hv5-hero-field" ref={fieldRef}>
        <div className="hv5-search" role="search">
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
              aria-label={PLACEHOLDER}
              placeholder={PLACEHOLDER}
              spellCheck={false}
              autoComplete="off"
              value={value}
              onChange={(event) => {
                setValue(event.target.value)
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
          </label>
          <div className="hv5-sugg" id={listId} role="listbox" aria-label="Channels" hidden={!expanded}>
            {result.heading ? <div className="hv5-sg-h" aria-hidden="true">{result.heading}</div> : null}
            {options.map((option, i) => (
              <Link
                key={option.key}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                className={option.channel ? undefined : 'hv5-sg-open'}
                to={option.href}
                tabIndex={-1}
                onClick={close}
              >
                {option.channel ? (
                  <>
                    <HubV5Avatar login={option.channel.login} name={option.channel.displayName} src={option.channel.profileImageUrl} size={32} />
                    <span className="hv5-sg-tx">
                      <span className="hv5-sg-nm">{option.channel.displayName || option.channel.login}</span>
                      <span className="hv5-sg-c">{option.channel.category || 'No category'}</span>
                    </span>
                    <span className="hv5-sg-v">{option.channel.viewers != null ? `${formatHubInt(option.channel.viewers)} viewers` : ''}</span>
                  </>
                ) : (
                  <>
                    <HubV5Icon name="search" />
                    <span>Open analytics for <b>{result.openLogin}</b></span>
                    <span className="hv5-sg-k">Enter</span>
                  </>
                )}
              </Link>
            ))}
            {result.empty ? (
              <div className="hv5-sg-none">No live channel matches. A Twitch login is 2 to 25 letters, numbers or underscores.</div>
            ) : null}
          </div>
        </div>
      </div>
      {/* What you get, under the search, which stays first: the real panel, one line and one big
          button (Aron's C1 pick, 10-21, with the P2 picture, 10-22; the copy is a draft). */}
      <div className="hv5-hero-get" ref={getRef}>
        <PanelFrames />
        <div className="hv5-get-tx">
          <p className="hv5-get-h">See chat's big moments on Twitch</p>
          <p className="hv5-get-p">The Pulse panel sits next to Twitch chat and shows the spikes and top moments of the stream you're on.</p>
          <p className="hv5-get-row">
            <ChromeInstallCta className="hv5-hero-install" data-cta="chrome-install-hub-hero">
              <span className="chrome-mark" aria-hidden="true" />Add to Chrome
            </ChromeInstallCta>
            <span className="hv5-get-free">Free · no account · also Edge and Brave</span>
          </p>
        </div>
      </div>
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
      ) : null}
      <div className="hv5-hero-foot" ref={footRef}>
        {poolSize > 0 ? <p className="hv5-scope">The hub below covers {formatHubInt(poolSize)} channels we follow · not all of Twitch</p> : null}
      </div>
    </header>
  )
}
