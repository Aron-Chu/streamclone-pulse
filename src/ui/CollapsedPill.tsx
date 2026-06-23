import type { CSSProperties } from 'react'
import { theme } from './theme.ts'

export interface CollapsedPillProps {
  tracking: boolean
  isLive?: boolean
  sidebarFill?: boolean
  onOpen: () => void
}

/** Tucked pill shown when Pulse is hidden — tap to reopen (Figma state-collapsed). */
export function CollapsedPill({ tracking, isLive = false, sidebarFill = false, onOpen }: CollapsedPillProps) {
  return (
    <div style={sidebarFill ? styles.wrapSidebar : styles.wrapFloating}>
      <button
        type="button"
        className="pulse-collapsed-pill"
        style={styles.pill}
        onClick={onOpen}
        title="Open Pulse panel"
        aria-label="Open Pulse panel"
      >
        <span style={styles.brandMark}>
          <span style={styles.brandDot} />
        </span>
        <strong style={styles.label}>Pulse</strong>
        <span
          className={tracking && isLive ? 'pulse-live-dot' : undefined}
          style={tracking ? styles.dotLive : styles.dotIdle}
          aria-hidden
        />
      </button>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrapFloating: {
    display: 'flex',
    justifyContent: 'flex-start',
    padding: 0,
  },
  wrapSidebar: {
    alignItems: 'center',
    display: 'flex',
    height: '100%',
    justifyContent: 'center',
    padding: '6px 10px',
    width: '100%',
  },
  pill: {
    alignItems: 'center',
    background: theme.panel,
    border: `1px solid ${theme.border}`,
    borderRadius: 999,
    boxShadow: '0 10px 28px rgba(0, 0, 0, 0.35)',
    color: theme.textPrimary,
    cursor: 'pointer',
    display: 'inline-flex',
    font: theme.font,
    gap: 10,
    padding: '10px 16px 10px 12px',
    transition: 'border-color 0.15s ease, background 0.15s ease, transform 0.15s ease',
  },
  brandMark: {
    alignItems: 'center',
    background: theme.accent,
    borderRadius: 8,
    display: 'inline-flex',
    flexShrink: 0,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  brandDot: {
    background: theme.textPrimary,
    borderRadius: 999,
    display: 'block',
    height: 10,
    width: 10,
  },
  label: {
    fontSize: 14,
    fontWeight: 800,
    letterSpacing: '-0.01em',
  },
  dotLive: {
    background: theme.live,
    borderRadius: 999,
    display: 'inline-block',
    flexShrink: 0,
    height: 9,
    width: 9,
  },
  dotIdle: {
    background: theme.textMuted,
    borderRadius: 999,
    display: 'inline-block',
    flexShrink: 0,
    height: 9,
    width: 9,
  },
}
