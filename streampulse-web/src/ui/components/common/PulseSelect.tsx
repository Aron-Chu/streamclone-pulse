import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import './pulse-select.css'

export interface PulseSelectOption<T extends string = string> {
  value: T
  label: string
  disabled?: boolean
}

export interface PulseSelectProps<T extends string = string> {
  id?: string
  value: T
  options: readonly PulseSelectOption<T>[]
  onChange: (value: T) => void
  ariaLabel: string
  triggerAriaLabel?: string
  className?: string
  disabled?: boolean
}

export function PulseSelect<T extends string = string>({
  id: customId,
  value,
  options,
  onChange,
  ariaLabel,
  triggerAriaLabel,
  className = '',
  disabled = false,
}: PulseSelectProps<T>) {
  const generatedId = useId()
  const baseId = (customId || generatedId).replace(/[^a-zA-Z0-9_-]/g, '_')
  const listboxId = `${baseId}-listbox`
  const triggerId = `${baseId}-trigger`

  const [isOpen, setIsOpen] = useState(false)
  const [flipUp, setFlipUp] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const selectedIndex = useMemo(() => {
    const idx = options.findIndex((opt) => opt.value === value)
    return idx >= 0 ? idx : 0
  }, [options, value])

  const [highlightedIndex, setHighlightedIndex] = useState(selectedIndex)

  useEffect(() => {
    setHighlightedIndex(selectedIndex)
  }, [selectedIndex])

  const checkFlip = useCallback(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const menuHeight = 260
    setFlipUp(spaceBelow < menuHeight && rect.top > spaceBelow)
  }, [])

  const openMenu = useCallback(() => {
    if (disabled) return
    checkFlip()
    setIsOpen(true)
    setHighlightedIndex(selectedIndex)
  }, [disabled, checkFlip, selectedIndex])

  const closeMenu = useCallback(() => {
    setIsOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
  }, [])

  const selectOption = useCallback((nextValue: T) => {
    onChange(nextValue)
    setIsOpen(false)
    triggerRef.current?.focus({ preventScroll: true })
  }, [onChange])

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('touchstart', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('touchstart', handlePointerDown)
    }
  }, [isOpen])

  // Reposition on scroll / resize while open
  useEffect(() => {
    if (!isOpen) return
    const handleResizeOrScroll = () => checkFlip()
    window.addEventListener('resize', handleResizeOrScroll)
    window.addEventListener('scroll', handleResizeOrScroll, { passive: true })
    return () => {
      window.removeEventListener('resize', handleResizeOrScroll)
      window.removeEventListener('scroll', handleResizeOrScroll)
    }
  }, [isOpen, checkFlip])

  // Scroll highlighted item into view
  useEffect(() => {
    if (!isOpen || !menuRef.current) return
    const highlightedOption = menuRef.current.querySelector(
      `[data-index="${highlightedIndex}"]`,
    ) as HTMLElement | null
    if (highlightedOption && typeof highlightedOption.scrollIntoView === 'function') {
      highlightedOption.scrollIntoView({ block: 'nearest' })
    }
  }, [isOpen, highlightedIndex])

  const findNextSelectableIndex = (current: number, direction: 1 | -1): number => {
    const count = options.length
    if (count === 0) return -1
    let next = current + direction
    while (next >= 0 && next < count) {
      if (!options[next]?.disabled) return next
      next += direction
    }
    return current
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === ' ' || event.key === 'Enter') {
      event.preventDefault()
      if (!isOpen) {
        openMenu()
        if (event.key === 'ArrowDown') {
          setHighlightedIndex(findNextSelectableIndex(selectedIndex, 1))
        } else if (event.key === 'ArrowUp') {
          setHighlightedIndex(findNextSelectableIndex(selectedIndex, -1))
        }
      }
    }
  }

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isOpen) return
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
    } else if (event.key === 'Tab') {
      setIsOpen(false)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex((prev) => findNextSelectableIndex(prev, 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((prev) => findNextSelectableIndex(prev, -1))
    } else if (event.key === 'Home') {
      event.preventDefault()
      const first = options.findIndex((opt) => !opt.disabled)
      if (first >= 0) setHighlightedIndex(first)
    } else if (event.key === 'End') {
      event.preventDefault()
      for (let i = options.length - 1; i >= 0; i--) {
        if (!options[i]?.disabled) {
          setHighlightedIndex(i)
          break
        }
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const opt = options[highlightedIndex]
      if (opt && !opt.disabled) {
        selectOption(opt.value)
      }
    }
  }

  const currentOption = options.find((opt) => opt.value === value) ?? options[0]

  return (
    <div
      ref={containerRef}
      className={`pulse-select ${isOpen ? 'is-open' : ''} ${className}`}
      onKeyDown={handleMenuKeyDown}
    >
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="pulse-select__trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={isOpen && highlightedIndex >= 0 ? `${listboxId}-opt-${highlightedIndex}` : undefined}
        aria-label={triggerAriaLabel || `${ariaLabel} selector`}
        disabled={disabled}
        onClick={() => (isOpen ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="pulse-select__label">{currentOption?.label ?? value}</span>
        <span className="pulse-select__arrow" aria-hidden="true">
          <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
            <path
              d="M1 1.5L6 6.5L11 1.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          id={listboxId}
          className={`pulse-select__menu ${flipUp ? 'is-flipped' : ''}`}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value
            const isHighlighted = index === highlightedIndex
            return (
              <div
                key={option.value}
                id={`${listboxId}-opt-${index}`}
                data-index={index}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled || undefined}
                className={`pulse-select__option ${isSelected ? 'is-selected' : ''} ${
                  isHighlighted ? 'is-highlighted' : ''
                } ${option.disabled ? 'is-disabled' : ''}`}
                onClick={event => {
                  // A wrapping label must not forward this click back to the trigger.
                  event.preventDefault()
                  if (!option.disabled) selectOption(option.value)
                }}
                onMouseEnter={() => {
                  if (!option.disabled) setHighlightedIndex(index)
                }}
              >
                <span className="pulse-select__option-text">{option.label}</span>
                {isSelected && (
                  <span className="pulse-select__check" aria-hidden="true">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
