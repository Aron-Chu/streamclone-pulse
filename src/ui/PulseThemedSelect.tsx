import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { eventPathIncludesNode, usePulsePortalRoot } from './pulsePortalContext.ts'
import {
  computeSelectMenuPosition,
  findScrollportElement,
  isTriggerVisibleInScrollport,
  listScrollableAncestors,
} from './pulseSelectPosition.ts'
import { theme } from './theme.ts'

export interface PulseSelectOption<T extends string = string> {
  value: T
  label: string
  disabled?: boolean
}

export interface PulseThemedSelectProps<T extends string = string> {
  value: T
  options: readonly PulseSelectOption<T>[]
  onChange: (value: T) => void
  ariaLabel: string
  label?: string
  disabled?: boolean
  fullWidth?: boolean
  id?: string
}

function indexForValue<T extends string>(
  options: readonly PulseSelectOption<T>[],
  value: T,
): number {
  const selectedIndex = options.findIndex(option => option.value === value && !option.disabled)
  if (selectedIndex >= 0) return selectedIndex
  return Math.max(0, options.findIndex(option => !option.disabled))
}

function isShadowRoot(node: unknown): node is ShadowRoot {
  return typeof ShadowRoot !== 'undefined' && node instanceof ShadowRoot
}

function resolveMenuHost(
  portalRoot: ShadowRoot | Document,
  trigger: HTMLElement | null,
): Element | DocumentFragment | null {
  const dialog = trigger?.closest('dialog[open]')
  if (dialog) return dialog
  if (isShadowRoot(portalRoot)) return portalRoot
  const rootNode = trigger?.getRootNode()
  if (isShadowRoot(rootNode)) return rootNode
  return trigger?.ownerDocument.body ?? null
}

export function PulseThemedSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  label,
  disabled = false,
  fullWidth = false,
  id,
}: PulseThemedSelectProps<T>) {
  const listId = useId()
  const optionIdPrefix = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLUListElement | null>(null)
  const portalRoot = usePulsePortalRoot()
  const [open, setOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const [activeIndex, setActiveIndex] = useState(() => indexForValue(options, value))

  const selected = options.find(option => option.value === value) ?? options[0]
  const activeOption = options[activeIndex] ?? selected
  const activeDescendantId = activeOption
    ? `${optionIdPrefix}-${activeOption.value}`
    : undefined

  useEffect(() => {
    setActiveIndex(indexForValue(options, value))
  }, [options, value])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const updatePosition = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const viewport = { width: document.documentElement.clientWidth, height: window.innerHeight }
      const scrollport = findScrollportElement(trigger)?.getBoundingClientRect() ?? null
      if (!isTriggerVisibleInScrollport(rect, scrollport, viewport)) {
        setOpen(false)
        return
      }
      const menuHeight = menuRef.current?.getBoundingClientRect().height
        || Math.min(220, options.length * 28 + 8)
      const position = computeSelectMenuPosition(rect, menuHeight, viewport)
      setMenuStyle({
        position: 'fixed',
        top: position.top,
        right: position.right,
        minWidth: position.minWidth,
        zIndex: 2_147_483_640,
        transformOrigin: position.placement === 'above' ? 'bottom right' : 'top right',
        maxHeight: Math.max(64, Math.min(220, viewport.height - 16)),
      })
    }
    updatePosition()
    const scrollTargets = new Set<EventTarget>([document])
    for (const scrollport of listScrollableAncestors(triggerRef.current)) scrollTargets.add(scrollport)
    for (const target of scrollTargets) target.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    window.visualViewport?.addEventListener('resize', updatePosition)
    window.visualViewport?.addEventListener('scroll', updatePosition)
    return () => {
      for (const target of scrollTargets) target.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
      window.visualViewport?.removeEventListener('resize', updatePosition)
      window.visualViewport?.removeEventListener('scroll', updatePosition)
    }
  }, [open, options.length, value])

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeIndex])

  useEffect(() => {
    if (!open) return
    const selectEvents = new WeakSet<Event>()
    const onPointerDown = (event: Event) => {
      if (
        !eventPathIncludesNode(event, rootRef.current)
        && !eventPathIncludesNode(event, menuRef.current)
      ) {
        if (selectEvents.has(event)) return
        setOpen(false)
      }
    }
    const onPortalPointerDown = (event: Event) => {
      if (
        eventPathIncludesNode(event, rootRef.current)
        || eventPathIncludesNode(event, menuRef.current)
      ) {
        selectEvents.add(event)
      }
    }
    // Observe after shadow-root capture has classified a closed-root event.
    document.addEventListener('pointerdown', onPointerDown)
    if (isShadowRoot(portalRoot)) {
      portalRoot.addEventListener('pointerdown', onPortalPointerDown, true)
    }
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      if (isShadowRoot(portalRoot)) {
        portalRoot.removeEventListener('pointerdown', onPortalPointerDown, true)
      }
    }
  }, [open, portalRoot])

  function closeMenu(restoreFocus: boolean): void {
    setOpen(false)
    if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus())
  }

  function choose(next: T): void {
    if (options.find(option => option.value === next)?.disabled) return
    onChange(next)
    closeMenu(true)
  }

  function openMenu(): void {
    setActiveIndex(indexForValue(options, value))
    setOpen(true)
  }

  function moveActive(delta: number): void {
    if (options.length === 0) return
    setActiveIndex(current => {
      for (let step = 1; step <= options.length; step++) {
        const next = (current + delta * step + options.length * options.length) % options.length
        if (!options[next].disabled) return next
      }
      return current
    })
  }

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    if (disabled) return
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (open) moveActive(1)
        else openMenu()
        break
      case 'ArrowUp':
        event.preventDefault()
        if (open) moveActive(-1)
        else openMenu()
        break
      case 'Home':
        if (open) {
          event.preventDefault()
          setActiveIndex(Math.max(0, options.findIndex(option => !option.disabled)))
        }
        break
      case 'End':
        if (open) {
          event.preventDefault()
          setActiveIndex(Math.max(0, options.map(option => !option.disabled).lastIndexOf(true)))
        }
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (open) {
          const option = options[activeIndex]
          if (option) choose(option.value)
        } else {
          openMenu()
        }
        break
      case 'Escape':
        if (open) {
          event.preventDefault()
          closeMenu(true)
        }
        break
      default:
        break
    }
  }

  function handleOptionPointerDown(event: ReactPointerEvent<HTMLButtonElement>): void {
    event.preventDefault()
    event.stopPropagation()
  }

  const menuHost = resolveMenuHost(portalRoot, triggerRef.current)

  return (
    <div
      ref={rootRef}
      style={{ ...styles.wrap, ...(fullWidth ? styles.wrapFull : null) }}
      data-chart-action="true"
    >
      {label ? <span style={styles.label}>{label}</span> : null}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        style={{
          ...styles.trigger,
          ...(fullWidth ? styles.triggerFull : null),
          ...(disabled ? styles.triggerDisabled : null),
          ...(open ? styles.triggerOpen : null),
        }}
        disabled={disabled}
        className="pulse-themed-select-trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? activeDescendantId : undefined}
        onClick={() => {
          if (disabled) return
          if (open) closeMenu(false)
          else openMenu()
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span style={styles.triggerValue}>{selected?.label ?? value}</span>
        <span
          className="pulse-themed-select-chevron"
          data-open={open ? 'true' : 'false'}
          style={styles.chevron}
          aria-hidden
        >
          ▾
        </span>
      </button>
      {open && menuHost
        ? createPortal(
            <ul
              ref={menuRef}
              id={listId}
              role="listbox"
              aria-label={ariaLabel}
              className="pulse-themed-select-menu"
              data-chart-action="true"
              style={{ ...styles.menu, ...menuStyle }}
            >
              {options.map((option, index) => {
                const active = option.value === value
                const focused = index === activeIndex
                return (
                  <li key={option.value} role="presentation">
                    <button
                      id={`${optionIdPrefix}-${option.value}`}
                      type="button"
                      role="option"
                      aria-selected={active}
                      disabled={option.disabled}
                      data-active={focused ? 'true' : undefined}
                      tabIndex={-1}
                      className="pulse-themed-select-option"
                      style={{
                        ...styles.option,
                        ...(active ? styles.optionActive : null),
                        ...(option.disabled ? styles.triggerDisabled : null),
                      }}
                      onPointerDown={handleOptionPointerDown}
                      onClick={() => choose(option.value)}
                    >
                      <span>{option.label}</span><span aria-hidden="true">{active ? '✓' : ''}</span>
                    </button>
                  </li>
                )
              })}
            </ul>,
            menuHost,
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
    fontFamily: theme.font,
    alignItems: 'center',
    background: theme.panel,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: theme.border,
    borderRadius: 8,
    color: theme.textSecondary,
    cursor: 'pointer',
    display: 'inline-flex',
    fontSize: 11,
    fontWeight: 700,
    gap: 6,
    lineHeight: 1.2,
    minWidth: 92,
    minHeight: 30,
    padding: '5px 9px',
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
    fontVariantNumeric: 'tabular-nums',
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
  },
  menu: {
    fontFamily: theme.font,
    background: '#111117',
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
    pointerEvents: 'auto',
    position: 'absolute',
    right: 0,
    top: 'calc(100% + 4px)',
    zIndex: 40,
  },
  option: {
    fontFamily: theme.font,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    background: 'transparent',
    border: 0,
    borderRadius: 6,
    color: theme.textSecondary,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
    minHeight: 30,
    padding: '6px 9px',
    textAlign: 'left',
    width: '100%',
  },
  optionActive: {
    background: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.18)',
    color: 'var(--pulse-accent-ink, #ddd6fe)',
  },
}

export const __test = { indexForValue, resolveMenuHost }
