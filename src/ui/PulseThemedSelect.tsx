import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { eventPathIncludesNode, usePulsePortalRoot } from './pulsePortalContext.ts'
import { theme } from './theme.ts'

export interface PulseSelectOption<T extends string = string> {
  value: T
  label: string
}

export interface PulseThemedSelectProps<T extends string = string> {
  value: T
  options: readonly PulseSelectOption<T>[]
  onChange: (value: T) => void
  ariaLabel: string
  label?: string
  disabled?: boolean
  fullWidth?: boolean
}

export function PulseThemedSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  label,
  disabled = false,
  fullWidth = false,
}: PulseThemedSelectProps<T>) {
  const listId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLUListElement | null>(null)
  const portalRoot = usePulsePortalRoot()
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})

  const selected = options.find(option => option.value === value) ?? options[0]

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const updatePosition = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      setMenuStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        right: Math.max(8, window.innerWidth - rect.right),
        minWidth: Math.max(rect.width, 120),
        zIndex: 2_147_483_640,
      })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, value])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: Event) => {
      if (
        !eventPathIncludesNode(event, rootRef.current)
        && !eventPathIncludesNode(event, menuRef.current)
      ) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: Event) => {
      if ((event as KeyboardEvent).key === 'Escape') setOpen(false)
    }
    portalRoot.addEventListener('pointerdown', onPointerDown, true)
    portalRoot.addEventListener('keydown', onKeyDown)
    return () => {
      portalRoot.removeEventListener('pointerdown', onPointerDown, true)
      portalRoot.removeEventListener('keydown', onKeyDown)
    }
  }, [open, portalRoot])

  function choose(next: T): void {
    onChange(next)
    setOpen(false)
  }

  function handleOptionPointerDown(event: ReactPointerEvent<HTMLButtonElement>): void {
    event.stopPropagation()
  }

  return (
    <div ref={rootRef} style={{ ...styles.wrap, ...(fullWidth ? styles.wrapFull : null) }}>
      {label ? <span style={styles.label}>{label}</span> : null}
      <button
        ref={triggerRef}
        type="button"
        style={{
          ...styles.trigger,
          ...(fullWidth ? styles.triggerFull : null),
          ...(disabled ? styles.triggerDisabled : null),
          ...(open ? styles.triggerOpen : null),
        }}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          if (disabled) return
          setOpen(current => !current)
        }}
      >
        <span style={styles.triggerValue}>{selected?.label ?? value}</span>
        <span style={styles.chevron} aria-hidden>
          ▾
        </span>
      </button>
      {open
        ? createPortal(
            <ul
              ref={menuRef}
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              style={{ ...styles.menu, ...menuStyle, position: 'fixed', top: menuStyle.top, right: menuStyle.right }}
            >
              {options.map(option => {
                const active = option.value === value
                return (
                  <li key={option.value} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      className="pulse-themed-select-option"
                      style={{
                        ...styles.option,
                        ...(active ? styles.optionActive : null),
                      }}
                      onPointerDown={handleOptionPointerDown}
                      onClick={() => choose(option.value)}
                    >
                      {option.label}
                    </button>
                  </li>
                )
              })}
            </ul>,
            document.body,
          )
        : null}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    alignItems: 'center',
    display: 'inline-flex',
    flexShrink: 0,
    gap: 6,
    position: 'relative',
    zIndex: 12,
  },
  wrapFull: {
    alignItems: 'stretch',
    display: 'grid',
    gap: 6,
    width: '100%',
  },
  label: {
    color: theme.textMuted,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  trigger: {
    alignItems: 'center',
    background: theme.panel,
    border: `1px solid ${theme.border}`,
    borderRadius: 6,
    color: theme.textSecondary,
    cursor: 'pointer',
    display: 'inline-flex',
    fontSize: 10,
    fontWeight: 700,
    gap: 6,
    lineHeight: 1.2,
    minWidth: 92,
    padding: '4px 8px',
    textAlign: 'left',
  },
  triggerOpen: {
    background: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.12)',
    borderColor: 'rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45)',
    color: 'var(--pulse-accent-ink, #ddd6fe)',
  },
  triggerFull: {
    justifyContent: 'space-between',
    width: '100%',
  },
  triggerDisabled: {
    cursor: 'default',
    opacity: 0.55,
  },
  triggerValue: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  chevron: {
    color: theme.textMuted,
    flexShrink: 0,
    fontSize: 10,
    lineHeight: 1,
    transform: 'translateY(-1px)',
  },
  menu: {
    background: 'rgba(17, 17, 23, 0.98)',
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    boxShadow: '0 12px 28px rgba(0, 0, 0, 0.45)',
    display: 'grid',
    gap: 2,
    listStyle: 'none',
    margin: 0,
    maxHeight: 220,
    minWidth: '100%',
    overflowY: 'auto',
    padding: 4,
    position: 'absolute',
    right: 0,
    top: 'calc(100% + 4px)',
    zIndex: 40,
  },
  option: {
    background: 'transparent',
    border: 0,
    borderRadius: 6,
    color: theme.textSecondary,
    cursor: 'pointer',
    fontSize: 10,
    fontWeight: 700,
    padding: '6px 8px',
    textAlign: 'left',
    width: '100%',
  },
  optionActive: {
    background: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.18)',
    color: 'var(--pulse-accent-ink, #ddd6fe)',
  },
}
