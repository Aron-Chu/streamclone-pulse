import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { apiClient, type ApiError } from '../../../lib/apiClient'
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
}: HubSearchProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()

  const filtered = useMemo(() => {
    const q = normalize(query)
    const base = q
      ? suggestions.filter(
          (s) => s.login.toLowerCase().includes(q) || (s.displayName ?? '').toLowerCase().includes(q),
        )
      : suggestions
    return base.slice(0, maxOptions)
  }, [query, suggestions, maxOptions])

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

  const showPopover = open && (filtered.length > 0 || query.trim().length > 0)

  return (
    <div className={`hx-search hx-search--${size}`}>
      <div className="hx-search__field">
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
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
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
      {showPopover ? (
        <ul className="hx-search__pop" id={listboxId} role="listbox" aria-label="Channel suggestions">
          {filtered.length === 0 ? (
            <li className="hx-search__empty" role="presentation">
              Press Enter to open <strong>{normalize(query)}</strong>
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
                  {s.live ? <span className="hx-badge hx-badge--live"><span className="dot" />Live</span> : null}
                  {typeof s.viewers === 'number' && s.viewers > 0 ? <span>{compact(s.viewers)}</span> : null}
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
