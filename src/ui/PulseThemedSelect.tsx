import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { eventPathIncludesNode, usePulsePortalRoot } from './pulsePortalContext.ts'
import {
  computeSelectMenuPosition,
  findScrollportElement,
  isTriggerVisibleInScrollport,
} from './pulseSelectPosition.ts'
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

function indexForValue<T extends string>(
  options: readonly PulseSelectOption<T>[],
  value: T,
): number {
  return Math.max(0, options.findIndex(option => option.value === value))
}

function isShadowRoot(node: unknown): node is ShadowRoot {
  return typeof ShadowRoot !== 'undefined' && node instanceof ShadowRoot
}

function resolveMenuHost(
  portalRoot: ShadowRoot | Document,
  trigger: HTMLElement | null,
): Element | DocumentFragment | null {
  if (isShadowRoot(portalRoot)) return portalRoot
  const rootNode = trigger?.getRootNode()
  if (isShadowRoot(rootNode)) return rootNode
  return trigger?.parentElement ?? null
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
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      const scrollport = findScrollportElement(trigger)?.getBoundingClientRect() ?? null
      if (!isTriggerVisibleInScrollport(rect, scrollport, viewport)) {
        setOpen(false)
        return
      }
      const menuHeight = menuRef.current?.getBoundingClientRect().height
        || Math.min(220, options.length * 32 + 8)
      const position = computeSelectMenuPosition(rect, menuHeight, viewport)
      setMenuStyle({
        position: 'fixed',
        top: position.top,
        right: position.right,
        minWidth: position.minWidth,
        zIndex: 2_147_483_640,
      })
    }
    updatePosition()
    const scrollTargets = new Set<EventTarget>([document])
    let node: HTMLElement | null = triggerRef.current
    while (node) {
      const style = getComputedStyle(node)
      if (
        node.classList.contains('pulse-panel-body')
        || style.overflowY === 'auto'
        || style.overflowY === 'scroll'
        || style.overflowY === 'overlay'
      ) {
        scrollTargets.add(node)
      }
      const parent = node.parentElement
      if (!parent && node.getRootNode) {
        const root = node.getRootNode()
        if (isShadowRoot(root)) {
          node = root.host as HTMLElement
          continue
        }
      }
      node = parent as HTMLElement | null
    }
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
    if (!open) return
    const selectEvents = new WeakSet<Event>()
    const onPointerDown = (event: Event) => {
      if (
        !eventPathIncludesNode(event, rootRef.current)
        && !eventPathIncludesNode(event, menuRef.current)
      ) {
        if (isShadowRoot(portalRoot) && event.composedPath().includes(portalRoot.host)) {
          queueMicrotask(() => {
            if (!selectEvents.has(event)) setOpen(false)
          })
          return
        }
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
    document.addEventListener('pointerdown', onPointerDown, true)
    if (isShadowRoot(portalRoot)) {
      portalRoot.addEventListener('pointerdown', onPortalPointerDown, true)
    }
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
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
    onChange(next)
    closeMenu(true)
  }

  function openMenu(): void {
    setActiveIndex(indexForValue(options, value))
    setOpen(true)
  }

  function moveActive(delta: number): void {
    if (options.length === 0) return
    setActiveIndex(current => (current + delta + options.length) % options.length)
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
          setActiveIndex(0)
        }
        break
      case 'End':
        if (open) {
          event.preventDefault()
          setActiveIndex(Math.max(0, options.length - 1))
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
        onBlur={() => {
          if (open) closeMenu(false)
        }}
      >
        <span style={styles.triggerValue}>{selected?.label ?? value}</span>
        <span style={styles.chevron} aria-hidden>
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
                      data-active={focused ? 'true' : undefined}
                      tabIndex={-1}
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
    pointerEvents: 'auto',
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

export const __test = { indexForValue, resolveMenuHost }
