import type { SidebarTab } from '../shared/storage.ts'

export interface PulseSidebarTabsProps {
  active: SidebarTab
  onChange?: (tab: SidebarTab) => void
  compact?: boolean
  /** When true, tab buttons are presentational only (landing demo). */
  demoMode?: boolean
}

export function PulseSidebarTabs({
  active,
  onChange,
  compact = false,
  demoMode = false,
}: PulseSidebarTabsProps) {
  return (
    <div
      className={`pulse-sidebar-tabs${compact ? ' pulse-sidebar-tabs-compact' : ''}`}
      role="tablist"
      aria-label="Chat or Pulse"
    >
      <button
        type="button"
        role="tab"
        aria-selected={active === 'chat'}
        className={`pulse-sidebar-tab${active === 'chat' ? ' active' : ''}`}
        onClick={demoMode ? undefined : () => onChange?.('chat')}
        tabIndex={demoMode ? -1 : 0}
      >
        Chat
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={active === 'pulse'}
        className={`pulse-sidebar-tab${active === 'pulse' ? ' active' : ''}`}
        onClick={demoMode ? undefined : () => onChange?.('pulse')}
        tabIndex={demoMode ? -1 : 0}
      >
        Pulse
      </button>
    </div>
  )
}
