import type { CSSProperties, ReactNode } from 'react'
import { theme } from './theme.ts'
import { MOMENT_CARD_HEIGHT } from './momentCardLayout.ts'

export function MomentInspectionTray({
  children,
  state,
}: {
  children?: ReactNode
  state?: 'active' | 'idle'
}) {
  return (
    <div
      data-selected-minute-slot="true"
      data-inspection-tray-state={state ?? (children ? 'active' : 'idle')}
      style={styles.slot}
    >
      {children ?? (
        <div style={styles.idle}>
          <span style={styles.idleTitle}>Select a moment</span>
          <span style={styles.idleCopy}>Hover to preview · click to lock</span>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  slot: {
    flexShrink: 0,
    marginTop: 8,
    minHeight: MOMENT_CARD_HEIGHT,
    minWidth: 0,
  },
  idle: {
    alignContent: 'center',
    background: theme.panel,
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    boxSizing: 'border-box',
    display: 'grid',
    gap: 5,
    minHeight: MOMENT_CARD_HEIGHT,
    padding: '10px 12px',
    textAlign: 'center',
  },
  idleTitle: {
    color: theme.textSecondary,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  idleCopy: { color: theme.textMuted, fontSize: 10, fontWeight: 600 },
}
