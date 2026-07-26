import type { ReactNode } from 'react'
import { Menu, RefreshCw } from 'lucide-react'
import type { BackendSource } from '../../../lib/backendSource'
import { backendSourceLabel } from '../../../lib/backendSource'
import { Badge, IconButton } from './primitives'

export interface HubSubbarProps {
  crumbTrail: string
  crumbCurrent: string
  statusLabel: string
  statusTone: 'live' | 'down'
  updatedLabel: string
  refreshing?: boolean
  onRefresh: () => void
  onMenu: () => void
  search?: ReactNode
  action?: ReactNode
  backendSource?: BackendSource
}

export function HubSubbar({
  crumbTrail,
  crumbCurrent,
  statusLabel,
  statusTone,
  updatedLabel,
  refreshing,
  onRefresh,
  onMenu,
  search,
  action,
  backendSource,
}: HubSubbarProps) {
  return (
    <div className="hx-subbar">
      <button type="button" className="hx-btn hx-btn--ghost hx-btn--sm hx-btn--icon hx-menu-btn" onClick={onMenu} aria-label="Open navigation">
        <Menu aria-hidden="true" />
      </button>
      <div className="hx-crumb">
        {crumbTrail}
        <span className="sep" aria-hidden="true">
          /
        </span>
        <b>{crumbCurrent}</b>
      </div>
      {search}
      <div className="right">
        {backendSource ? (
          <span className="hx-backend-badge" title="Backend source">
            <Badge variant="secondary">{backendSourceLabel(backendSource)}</Badge>
          </span>
        ) : null}
        <Badge variant={statusTone === 'live' ? 'live' : 'down'} dot pulse={statusTone === 'live'}>
          {statusLabel}
        </Badge>
        <span className="muted" style={{ fontSize: '0.74rem' }}>
          {updatedLabel}
        </span>
        <IconButton ariaLabel="Refresh hub data" onClick={onRefresh} busy={refreshing}>
          <RefreshCw aria-hidden="true" />
        </IconButton>
        {action}
      </div>
    </div>
  )
}
