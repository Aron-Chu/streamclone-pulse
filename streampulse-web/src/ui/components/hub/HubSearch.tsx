import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
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
  maxOptions?: number
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
}: HubSearchProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
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

  function submit(login: string) {
    const slug = normalize(login)
    if (!slug) return
    setOpen(false)
    setActive(-1)
    if (onSubmit) onSubmit(slug)
    else navigate(`/analytics/${encodeURIComponent(slug)}`)
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
          <button type="button" className="hx-btn hx-btn--default hx-btn--sm" onClick={() => submit(query)}>
            Open
          </button>
        ) : null}
      </div>
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
