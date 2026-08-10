import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { ChevronDown } from 'lucide-react'

export interface HubActivityRangeOption {
  key: string
  label: string
  /** Long form shown in the menu row and announced with the option. */
  description?: string
}

export interface HubActivityRangeControl {
  active: string
  options: HubActivityRangeOption[]
  onSelect: (key: string) => void
}

interface HubRangeMenuProps {
  control: HubActivityRangeControl
  label?: string
}

/**
 * Collapsed listbox for the activity window. Replaces the inline tab capsule so
 * the chart header keeps its width as ranges are added.
 */
export function HubRangeMenu({ control, label = 'Activity time window' }: HubRangeMenuProps) {
  const { active, options, onSelect } = control
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const baseId = useId()

  const selectedIndex = options.findIndex((option) => option.key === active)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined
  const optionId = (index: number) => `${baseId}-option-${index}`

  const close = useCallback((focusTrigger: boolean) => {
    setOpen(false)
    setActiveIndex(-1)
    if (focusTrigger) triggerRef.current?.focus()
  }, [])

  const openAt = useCallback((index: number) => {
    setOpen(true)
    setActiveIndex(index)
  }, [])

  const commit = useCallback(
    (index: number) => {
      const option = options[index]
      if (option) onSelect(option.key)
      close(true)
    },
    [options, onSelect, close],
  )

  useEffect(() => {
    if (!open) return
    listRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open, close])

  function onTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openAt(selectedIndex >= 0 ? selectedIndex : 0)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      openAt(selectedIndex >= 0 ? selectedIndex : options.length - 1)
    }
  }

  function onListKeyDown(event: ReactKeyboardEvent<HTMLUListElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        setActiveIndex((prev) => (prev + 1) % options.length)
        break
      case 'ArrowUp':
        event.preventDefault()
        setActiveIndex((prev) => (prev <= 0 ? options.length - 1 : prev - 1))
        break
      case 'Home':
        event.preventDefault()
        setActiveIndex(0)
        break
      case 'End':
        event.preventDefault()
        setActiveIndex(options.length - 1)
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (activeIndex >= 0) commit(activeIndex)
        break
      case 'Escape':
        event.preventDefault()
        close(true)
        break
      case 'Tab':
        close(false)
        break
      default:
        break
    }
  }

  return (
    <div className="hx-range-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="hx-range-menu__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${selected?.description ?? selected?.label ?? active}`}
        onClick={() => (open ? close(false) : openAt(selectedIndex >= 0 ? selectedIndex : 0))}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="hx-range-menu__value">{selected?.label ?? active}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open ? (
        <ul
          ref={listRef}
          className="hx-range-menu__list"
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
          onKeyDown={onListKeyDown}
        >
          {options.map((option, index) => (
            <li
              key={option.key}
              id={optionId(index)}
              role="option"
              aria-selected={option.key === active}
              className={[
                'hx-range-menu__option',
                option.key === active ? 'is-selected' : '',
                index === activeIndex ? 'is-active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onMouseEnter={() => setActiveIndex(index)}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => commit(index)}
            >
              <span className="hx-range-menu__option-label">{option.label}</span>
              {option.description ? (
                <span className="hx-range-menu__option-desc">{option.description}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
