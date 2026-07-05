import { Link } from 'react-router-dom'
import { TrendingUp } from 'lucide-react'
import type { HubMover } from '../../../lib/publicHub'
import { formatMoverVelocity } from './hubFormat'
import { Avatar } from '../hub/primitives'

export interface HubLiveRailMoversStripProps {
  movers: HubMover[]
  loading?: boolean
}

export function HubLiveRailMoversStrip({ movers, loading }: HubLiveRailMoversStripProps) {
  if (loading && movers.length === 0) {
    return (
      <div className="hub-live-rail-movers" aria-busy="true" aria-label="Top emote movers">
        <span className="hub-live-rail-movers__label">Top emote movers</span>
        <div className="hub-live-rail-movers__row">
          {Array.from({ length: 4 }).map((_, i) => (
            <span key={i} className="hub-live-rail-movers__pill hub-live-rail-movers__pill--skeleton" />
          ))}
        </div>
      </div>
    )
  }

  if (movers.length === 0) return null

  return (
    <div className="hub-live-rail-movers" aria-label="Top emote movers">
      <span className="hub-live-rail-movers__label">
        <TrendingUp aria-hidden="true" />
        Top emote movers
      </span>
      <div className="hub-live-rail-movers__row">
        {movers.map((mover, index) => {
          const velocity = formatMoverVelocity(mover)
          const name = mover.displayName?.trim() || mover.login
          return (
            <Link
              key={mover.login}
              to={`/analytics/${encodeURIComponent(mover.login)}`}
              className="hub-live-rail-movers__pill"
              title={`${velocity.emoteLabel} emotes · ${velocity.chatLabel}`}
            >
              <span className="hub-live-rail-movers__rank">{index + 1}</span>
              <Avatar login={mover.login} src={mover.profileImageUrl} alt="" />
              <span className="hub-live-rail-movers__name">{name}</span>
              <span className="hub-live-rail-movers__metric">{velocity.emoteLabel}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
