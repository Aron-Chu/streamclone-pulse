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
  const index = options.findIndex(option => option.value === value)
  return Math.max(0, index)
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
  // Never fall back to document.body — Twitch page CSS would style the menu.
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
      const menu = menuRef.current
      if (!trigger) return

      const rect = trigger.getBoundingClientRect()
      const viewport = { width: window.innerWidth, height: window.innerHeight }
      const scrollportEl = findScrollportElement(trigger)
      const scrollportRect = scrollportEl?.getBoundingClientRect() ?? null

      if (!isTriggerVisibleInScrollport(rect, scrollportRect, viewport)) {
        setOpen(false)
        return
      }

      const menuHeight = menu?.getBoundingClientRect().height || Math.min(220, options.length * 32 + 8)
      const pos = computeSelectMenuPosition(rect, menuHeight, viewport)
      setMenuStyle({
        position: 'fixed',
        top: pos.top,
        right: pos.right,
        minWidth: pos.minWidth,
        zIndex: 2_147_483_640,
      })
    }

    updatePosition()

    // Scroll does not bubble. Shadow-root scrollports also do not surface to `document`,
    // so pin listeners on overflow ancestors as well as document (page scroll) + viewport chrome.
    const scrollTargets = new Set<EventTarget>()
    scrollTargets.add(document)
    let node: HTMLElement | null = triggerRef.current
    while (node) {
      const style = getComputedStyle(node)
      const overflowY = style.overflowY
      if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') {
        scrollTargets.add(node)
      }
      if (node.classList.contains('pulse-panel-scroll')) {
        scrollTargets.add(node)
      }
      const parent: Element | null = node.parentElement
      if (!parent && node.getRootNode) {
        const root = node.getRootNode()
        if (root instanceof ShadowRoot) {
          node = root.host as HTMLElement
          continue
        }
      }
      node = parent as HTMLElement | null
    }

    for (const target of scrollTargets) {
      target.addEventListener('scroll', updatePosition, true)
    }
    window.addEventListener('resize', updatePosition)
    const vv = window.visualViewport
    vv?.addEventListener('resize', updatePosition)
    vv?.addEventListener('scroll', updatePosition)

    return () => {
      for (const target of scrollTargets) {
        target.removeEventListener('scroll', updatePosition, true)
      }
      window.removeEventListener('resize', updatePosition)
      vv?.removeEventListener('resize', updatePosition)
      vv?.removeEventListener('scroll', updatePosition)
    }
  }, [open, value, options.length])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: Event) => {
      if (
        !eventPathIncludesNode(event, rootRef.current)
        && !eventPathIncludesNode(event, menuRef.current)
      ) {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    // Document capture so outside clicks close the menu even when it lives in a shadow root.
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [open])

  function closeMenu(restoreFocus: boolean): void {
    setOpen(false)
    if (restoreFocus) {
      queueMicrotask(() => triggerRef.current?.focus())
    }
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
        if (!open) openMenu()
        else moveActive(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        if (!open) openMenu()
        else moveActive(-1)
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
    event.stopPropagation()
  }

  const menuHost = resolveMenuHost(portalRoot, triggerRef.current)

  return (
    <div ref={rootRef} style={{ ...styles.wrap, ...(fullWidth ? styles.wrapFull : null) }}>
      {label ? <span style={styles.label}>{label}</span> : null}
      <button
        ref={triggerRef}
        type="button"
        className="pulse-themed-select-trigger"
        style={{
          ...styles.trigger,
          ...(fullWidth ? styles.triggerFull : null),
        }}
        disabled={disabled}
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
          style={{
            ...styles.chevron,
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
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
              className="pulse-themed-select-menu"
              role="listbox"
              aria-label={ariaLabel}
              style={{ ...styles.menu, ...menuStyle }}
            >
              {options.map((option, index) => {
                const active = option.value === value
                const focused = index === activeIndex
                const optionId = `${optionIdPrefix}-${option.value}`
                return (
                  <li key={option.value} role="presentation">
                    <button
                      id={optionId}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-active={focused ? 'true' : undefined}
                      tabIndex={focused ? 0 : -1}
                      className="pulse-themed-select-option"
                      style={styles.option}
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
    cursor: 'pointer',
    display: 'inline-flex',
    fontFamily: theme.font,
    fontSize: 11,
    fontWeight: 700,
    gap: 6,
    lineHeight: 1.3,
    minWidth: 92,
    padding: '4px 8px',
    textAlign: 'left',
  },
  triggerFull: {
    justifyContent: 'space-between',
    width: '100%',
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
    fontSize: 11,
    lineHeight: 1,
    transformOrigin: 'center',
    transition: 'transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1)',
  },
  menu: {
    background: 'var(--pulse-surface-panel-glass, rgba(17, 17, 23, 0.98))',
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    boxShadow: '0 12px 28px var(--pulse-surface-shadow, rgba(0, 0, 0, 0.45))',
    display: 'grid',
    fontFamily: theme.font,
    gap: 2,
    listStyle: 'none',
    margin: 0,
    maxHeight: 220,
    minWidth: '100%',
    overflowY: 'auto',
    padding: 4,
    pointerEvents: 'auto',
  },
  option: {
    border: 0,
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: theme.font,
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1.35,
    padding: '6px 8px',
    textAlign: 'left',
    width: '100%',
  },
}

export const __test = { indexForValue, resolveMenuHost }
