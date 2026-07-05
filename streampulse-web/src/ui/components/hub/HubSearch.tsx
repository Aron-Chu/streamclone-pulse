import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { apiClient, type ApiError } from '../../../lib/apiClient'
import {
  lookupChannelSuggestion,
  mergeHubSuggestions,
  searchChannelSuggestions,
} from '../../../lib/channelSearch'
import { isPlausibleTwitchLogin, normalizeTwitchLogin } from '../../../lib/normalizeTwitchLogin'
import { compact } from '../analytics/hubFormat'
import { Avatar } from './primitives'

export interface HubSuggestion {
  login: string
  displayName?: string
  category?: string
  viewers?: number
  profileImageUrl?: string
  live?: boolean
}

export interface HubSearchProps {
  suggestions: HubSuggestion[]
  size?: 'sm' | 'lg'
  placeholder?: string
  ariaLabel?: string
  showKbd?: boolean
  showOpenButton?: boolean
  /** Override navigation. Defaults to opening /analytics/{login}. */
  onSubmit?: (login: string) => void
  /** When true (default), validates login via /v1/channels/{login} before navigating. */
  validateChannel?: boolean
  /** Query Twitch metadata search for live + offline channels while typing. */
  remoteSearch?: boolean
  maxOptions?: number
}

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'kind' in error &&
    typeof (error as ApiError).kind === 'string'
  )
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

export function HubSearch({
  suggestions,
  size = 'lg',
  placeholder = 'e.g. xqc, caseoh_, sodapoppin',
  ariaLabel = 'Search channel login',
  showKbd,
  showOpenButton,
  onSubmit,
  maxOptions = 8,
  validateChannel = true,
  remoteSearch = true,
}: HubSearchProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [remoteSuggestions, setRemoteSuggestions] = useState<HubSuggestion[]>([])
  const [remoteLoading, setRemoteLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const listboxId = useId()
  const [popStyle, setPopStyle] = useState<CSSProperties>({})

  useEffect(() => {
    if (!showKbd) return
    const onKey = (event: globalThis.KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName ?? ''
      const inField = /input|textarea|select/i.test(tag)
      const slash = event.key === '/' && !inField
      const cmdK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'
      if (slash || cmdK) {
        event.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
        setActive(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showKbd])

  useEffect(
    () => () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
    },
    [],
  )

  const localFiltered = useMemo(() => {
    const q = normalize(query)
    const base = q
      ? suggestions.filter(
          (s) => s.login.toLowerCase().includes(q) || (s.displayName ?? '').toLowerCase().includes(q),
        )
      : suggestions
    return base
  }, [query, suggestions])

  useEffect(() => {
    if (!remoteSearch) {
      setRemoteSuggestions([])
      return
    }
    const q = query.trim()
    if (q.length < 2) {
      setRemoteSuggestions([])
      setRemoteLoading(false)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        setRemoteLoading(true)
        try {
          const rows = await searchChannelSuggestions(q, maxOptions)
          if (cancelled) return
          if (rows.length > 0) {
            setRemoteSuggestions(rows)
            return
          }
          const slug = normalizeTwitchLogin(q)
          if (isPlausibleTwitchLogin(slug)) {
            const exact = await lookupChannelSuggestion(slug)
            if (!cancelled) setRemoteSuggestions(exact ? [exact] : [])
            return
          }
          setRemoteSuggestions([])
        } catch {
          if (cancelled) return
          const slug = normalizeTwitchLogin(q)
          if (isPlausibleTwitchLogin(slug)) {
            const exact = await lookupChannelSuggestion(slug)
            if (!cancelled) setRemoteSuggestions(exact ? [exact] : [])
            return
          }
          setRemoteSuggestions([])
        } finally {
          if (!cancelled) setRemoteLoading(false)
        }
      })()
    }, 250)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [maxOptions, query, remoteSearch])

  const filtered = useMemo(
    () => mergeHubSuggestions(localFiltered, remoteSuggestions, maxOptions),
    [localFiltered, maxOptions, remoteSuggestions],
  )

  async function submit(login: string) {
    const slug = normalizeTwitchLogin(login)
    if (!isPlausibleTwitchLogin(slug)) {
      setError('Enter a valid Twitch login (2–25 characters: letters, numbers, underscore).')
      return
    }
    setError(null)
    setOpen(false)
    setActive(-1)
    if (onSubmit) {
      onSubmit(slug)
      return
    }
    if (validateChannel) {
      setBusy(true)
      try {
        await apiClient(`/v1/channels/${encodeURIComponent(slug)}`)
        navigate(`/analytics/${encodeURIComponent(slug)}`)
      } catch (err) {
        if (isApiError(err) && err.status === 404) {
          setError(`Channel "${slug}" was not found. Check the spelling.`)
          return
        }
        if (isApiError(err) && err.kind === 'unauthorized') {
          setError('Channel lookup is unavailable right now. Try opening the channel directly.')
          return
        }
        setError('Could not reach StreamPulse. Check your connection and try again.')
      } finally {
        setBusy(false)
      }
      return
    }
    navigate(`/analytics/${encodeURIComponent(slug)}`)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setActive((prev) => Math.min(prev + 1, filtered.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((prev) => Math.max(prev - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (open && active >= 0 && filtered[active]) submit(filtered[active].login)
      else if (query.trim()) submit(query)
    } else if (event.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  const trimmedQuery = query.trim()
  const showPopover =
    open &&
    (trimmedQuery.length > 0 || active >= 0) &&
    (filtered.length > 0 || trimmedQuery.length > 0)

  const syncPopoverPosition = () => {
    const anchor = fieldRef.current ?? inputRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    setPopStyle({
      position: 'fixed',
      top: rect.bottom + 6,
      left: rect.left,
      width: rect.width,
      zIndex: 300,
    })
  }

  useEffect(() => {
    if (!showPopover) return
    syncPopoverPosition()
    const onLayout = () => syncPopoverPosition()
    window.addEventListener('resize', onLayout)
    window.addEventListener('scroll', onLayout, true)
    return () => {
      window.removeEventListener('resize', onLayout)
      window.removeEventListener('scroll', onLayout, true)
    }
  }, [showPopover, filtered.length, query])

  return (
    <div className={`hx-search hx-search--${size}${showPopover ? ' is-open' : ''}`}>
      <div className="hx-search__field" ref={fieldRef}>
        <Search aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showPopover}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && filtered[active] ? `${listboxId}-opt-${active}` : undefined}
          aria-label={ariaLabel}
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => {
            if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
            setOpen(true)
            setActive(-1)
          }}
          onBlur={() => {
            blurTimerRef.current = setTimeout(() => setOpen(false), 150)
          }}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        {showKbd ? <span className="kbd" aria-hidden="true">⌘K</span> : null}
        {showOpenButton ? (
          <button type="button" className="hx-btn hx-btn--default hx-btn--sm" disabled={busy} onClick={() => void submit(query)}>
            {busy ? '…' : 'Open'}
          </button>
        ) : null}
      </div>
      {error ? <p className="hx-search__error" role="alert">{error}</p> : null}
      {showPopover
        ? createPortal(
            <ul
              className="hx-search__pop hx-search__pop--portal hx-search-pop-surface"
              id={listboxId}
              role="listbox"
              aria-label="Channel suggestions"
              style={popStyle}
            >
              {filtered.length === 0 ? (
                <li className="hx-search__empty" role="presentation">
                  {remoteLoading ? (
                    <>Searching channels…</>
                  ) : (
                    <>
                      Press Enter to open <strong>{normalize(query)}</strong>
                    </>
                  )}
                </li>
              ) : (
                filtered.map((s, index) => (
                  <li
                    key={s.login}
                    id={`${listboxId}-opt-${index}`}
                    role="option"
                    aria-selected={index === active}
                    className={`hx-search__opt${index === active ? ' is-active' : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => submit(s.login)}
                  >
                    <Avatar login={s.login} src={s.profileImageUrl} />
                    <span>
                      <strong>{s.displayName?.trim() || s.login}</strong>
                      {s.category ? <small> {s.category}</small> : null}
                    </span>
                    <span className="meta">
                      {s.live ? (
                        <span className="hx-badge hx-badge--live">
                          <span className="dot" />
                          Live
                        </span>
                      ) : query.trim().length > 0 ? (
                        <span className="muted">Offline</span>
                      ) : null}
                      {typeof s.viewers === 'number' && s.viewers > 0 ? <span>{compact(s.viewers)}</span> : null}
                    </span>
                  </li>
                ))
              )}
              {remoteLoading && filtered.length > 0 ? (
                <li className="hx-search__empty" role="presentation">
                  Searching channels…
                </li>
              ) : null}
            </ul>,
            document.body,
          )
        : null}
    </div>
  )
}
