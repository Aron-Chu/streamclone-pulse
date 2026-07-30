import { FormEvent, useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { apiClient, type ApiError } from '../../../lib/apiClient'
import { isPlausibleTwitchLogin, normalizeTwitchLogin } from '../../../lib/normalizeTwitchLogin'
import { compact, displayName, initial } from './hubFormat'
import { ResilientImage } from '../ResilientImage'

export interface HubSearchSuggestion {
  login: string
  label?: string
  displayName?: string
  category?: string
  viewers?: number
  profileImageUrl?: string
  live?: boolean
}

export interface HubRecentChannel {
  login: string
  live?: boolean
}

export interface HubChannelSearchProps {
  title?: string
  description?: string
  suggestions?: HubSearchSuggestion[]
  variant?: 'panel' | 'masthead' | 'hub'
}

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    typeof (error as ApiError).kind === 'string'
  )
}

export function HubChannelSearch({
  title = 'Open full analytics',
  description = 'Enter any Twitch login to open the copied Streamclone console for that channel.',
  suggestions = [],
  variant = 'panel',
}: HubChannelSearchProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (variant !== 'hub') return
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName ?? ''
      const inField = /input|textarea|select/i.test(tag)
      const slash = event.key === '/' && !inField
      const cmdK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'
      if (slash || cmdK) {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [variant])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const login = normalizeTwitchLogin(query)
    if (!isPlausibleTwitchLogin(login)) {
      setError('Enter a valid Twitch login (2–25 characters: letters, numbers, underscore).')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await apiClient(`/v1/channels/${encodeURIComponent(login)}`)
      navigate(`/analytics/${encodeURIComponent(login)}`)
    } catch (error) {
      if (isApiError(error) && error.status === 404) {
        setError(`Channel "${login}" was not found. Check the spelling.`)
        return
      }
      if (isApiError(error) && error.kind === 'unauthorized') {
        setError('Channel lookup is unavailable right now. Try opening the channel directly.')
        return
      }
      setError('Could not reach StreamPulse. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  if (variant === 'hub') {
    const q = query.trim().toLowerCase()
    const matches = (q.length === 0
      ? suggestions
      : suggestions.filter(
          (s) =>
            s.login.toLowerCase().includes(q) || (s.displayName ?? '').toLowerCase().includes(q),
        )
    ).slice(0, 8)
    const showList = open && matches.length > 0
    const activeOptionId =
      showList && activeIndex >= 0 && activeIndex < matches.length
        ? `hub-opt-${matches[activeIndex].login}`
        : undefined

    const choose = (login: string) => {
      setOpen(false)
      setActiveIndex(-1)
      navigate(`/analytics/${encodeURIComponent(login.toLowerCase())}`)
    }

    return (
      <section className="hub-hero" aria-label="Channel search">
        <form className="hub-searchbar" role="search" onSubmit={(e) => void handleSubmit(e)}>
          <Search className="hub-searchbar__ic" aria-hidden="true" />
          <label className="sr-only" htmlFor="hub-search-input">
            Search channel login
          </label>
          <input
            id="hub-search-input"
            ref={inputRef}
            type="search"
            name="login"
            role="combobox"
            aria-expanded={showList}
            aria-controls="hub-search-listbox"
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search live channels..."
            value={query}
            aria-describedby={error ? 'hub-search-error' : undefined}
            aria-invalid={Boolean(error)}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
              setActiveIndex(-1)
              if (error) setError(null)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                if (matches.length === 0) return
                event.preventDefault()
                setOpen(true)
                setActiveIndex((index) => (index + 1) % matches.length)
              } else if (event.key === 'ArrowUp') {
                if (matches.length === 0) return
                event.preventDefault()
                setOpen(true)
                setActiveIndex((index) => (index <= 0 ? matches.length - 1 : index - 1))
              } else if (event.key === 'Enter') {
                if (showList && activeIndex >= 0 && activeIndex < matches.length) {
                  event.preventDefault()
                  choose(matches[activeIndex].login)
                }
              } else if (event.key === 'Escape') {
                setOpen(false)
                setActiveIndex(-1)
              }
            }}
            disabled={busy}
          />
          <span className="hub-searchbar__kbd" aria-hidden="true">
            /
          </span>
          {showList ? (
            <ul
              className="hub-acl"
              id="hub-search-listbox"
              role="listbox"
              aria-label="Live channel suggestions"
            >
              {matches.map((suggestion, index) => (
                <li
                  key={suggestion.login}
                  id={`hub-opt-${suggestion.login}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`hub-acl__opt${index === activeIndex ? ' is-active' : ''}`}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    choose(suggestion.login)
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span className="hub-acl__av" aria-hidden="true">
                    <ResilientImage
                      src={suggestion.profileImageUrl}
                      alt=""
                      loading="lazy"
                      fallback={initial(suggestion.login)}
                    />
                  </span>
                  <span className="hub-acl__id">
                    <strong>{displayName(suggestion.login, suggestion.displayName)}</strong>
                    <small>{suggestion.category?.trim() || (suggestion.live ? 'Live now' : 'Channel')}</small>
                  </span>
                  {typeof suggestion.viewers === 'number' && suggestion.viewers > 0 ? (
                    <span className="hub-acl__v">
                      <i aria-hidden="true" />
                      {compact(suggestion.viewers)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </form>
        {error ? (
          <p id="hub-search-error" className="hub-searcherr" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    )
  }

  if (variant === 'masthead') {
    return (
      <section className="analytics-home-masthead" aria-labelledby="analytics-home-title">
        <div className="analytics-home-brand" aria-label="StreamPulse analytics hub">
          <span className="analytics-home-brand__mark" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </span>
          <h1 id="analytics-home-title">
            Stream<span>Pulse</span>
          </h1>
          <p>Analytics Hub</p>
        </div>
        <form className="analytics-home-search" role="search" onSubmit={(e) => void handleSubmit(e)}>
          <label className="sr-only" htmlFor="analytics-home-search-input">
            Search channel login
          </label>
          <span className="analytics-home-search__icon" aria-hidden="true" />
          <input
            id="analytics-home-search-input"
            type="search"
            name="login"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search channel login..."
            value={query}
            aria-describedby={error ? 'analytics-home-search-error' : undefined}
            aria-invalid={Boolean(error)}
            onChange={(e) => {
              setQuery(e.target.value)
              if (error) setError(null)
            }}
            disabled={busy}
          />
          <button type="submit" aria-label="Open analytics" disabled={busy || !query.trim()}>
            /
          </button>
        </form>
        {error ? (
          <p id="analytics-home-search-error" className="analytics-home-search__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="analytics-home-recents" aria-label="Suggested channels">
          <span>Suggested channels</span>
          <div>
            {suggestions.map((suggestion, index) => (
              <Link
                key={suggestion.login}
                to={`/analytics/${encodeURIComponent(suggestion.login.toLowerCase())}`}
                className={index === 0 ? 'is-active' : undefined}
              >
                {suggestion.label ?? suggestion.login}
              </Link>
            ))}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="panel analytics-hub__search" aria-labelledby="hub-channel-search-title">
      <div className="analytics-hub__search-heading">
        <div>
          <p className="analytics-hub__eyebrow">Channel lookup</p>
          <h2 id="hub-channel-search-title" className="analytics-hub__panel-title">
            {title}
          </h2>
        </div>
        <span className="analytics-hub__search-badge">No watchlist required</span>
      </div>
      <p id="hub-channel-search-help" className="analytics-hub__search-help muted">
        {description}
      </p>
      <form className="analytics-hub__search-form" role="search" onSubmit={(e) => void handleSubmit(e)}>
        <label className="sr-only" htmlFor="hub-channel-search-input">
          Twitch channel login
        </label>
        <input
          id="hub-channel-search-input"
          type="search"
          name="login"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste a Twitch login: xqc, sodapoppin"
          value={query}
          aria-describedby={error ? 'hub-channel-search-error hub-channel-search-help' : 'hub-channel-search-help'}
          aria-invalid={Boolean(error)}
          onChange={(e) => {
            setQuery(e.target.value)
            if (error) setError(null)
          }}
          disabled={busy}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !query.trim()}>
          {busy ? 'Opening…' : 'Open analytics'}
        </button>
      </form>
      {error ? (
        <p id="hub-channel-search-error" className="analytics-hub__search-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="analytics-hub__search-shortcuts" aria-label="Suggested channels">
        {suggestions.map((suggestion) => (
          <Link key={suggestion.login} to={`/analytics/${encodeURIComponent(suggestion.login.toLowerCase())}`}>
            {suggestion.label ?? suggestion.login}
          </Link>
        ))}
        {suggestions.length > 0 ? <span aria-hidden="true">·</span> : null}
        <Link to="/analytics/streams">Streams</Link>
      </div>
    </section>
  )
}
