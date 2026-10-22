/**
 * The d3-v5 hub's channel search (R5-12, mockup hub.js masthead), shared by
 * the hero and the top bar's search window (R5-14, AnalyticsFind). Focus lists
 * the busiest live channels; typing filters them; Enter opens the highlighted
 * row, else the exact live channel, else "Open analytics for" a plausible
 * login. The / and Ctrl/⌘K keys belong to whoever hosts it.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { HubLiveChannel } from '../../../../lib/publicHub'
import { buildAnalyticsHref } from '../../../../lib/analyticsLinks'
import { IS_MAC } from '../../analytics/analyticsFindContext'
import { isPlausibleTwitchLogin } from '../../../../lib/normalizeTwitchLogin'
import { HubV5Avatar } from './HubV5Avatar'
import { HubV5Icon } from './HubV5Icon'
import { channelHref, channelsByViewers, formatHubInt, searchChannels, typedLogin } from './hubV5Model'

const PLACEHOLDER = 'Search any Twitch channel'
const BLUR_CLOSE_MS = 150

interface Option {
  key: string
  href: string
  channel: HubLiveChannel | null
}

export function HubV5SearchBox({ live, inputRef, autoFocus = false, onNavigate }: {
  live: readonly HubLiveChannel[]
  inputRef: RefObject<HTMLInputElement>
  /** Focus (and so list the busiest channels) on mount: the search window. */
  autoFocus?: boolean
  /** Called after a row or Enter opens a channel. */
  onNavigate?: () => void
}) {
  const navigate = useNavigate()
  const uid = useId()
  const inputId = `${uid}q`
  const listId = `${uid}sugg`
  const optionId = (i: number) => `${uid}sg${i}`
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

  const close = () => {
    setOpen(false)
    setActive(-1)
  }

  useEffect(() => () => window.clearTimeout(blurTimer.current), [])

  useEffect(() => {
    if (!autoFocus) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [autoFocus, inputRef])

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
    onNavigate?.()
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

  return (
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
            onClick={() => {
              close()
              onNavigate?.()
            }}
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
  )
}
