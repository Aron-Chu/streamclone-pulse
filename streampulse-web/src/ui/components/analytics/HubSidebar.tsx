import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Radio,
  LineChart,
  Smile,
  ShieldCheck,
  Wifi,
  Settings,
} from 'lucide-react'
import { compact } from './hubFormat'

export interface HubSidebarCounts {
  streams: number
  emotes: number
  live: number
}

interface HubSidebarProps {
  counts: HubSidebarCounts
}

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'dash-side-link active' : 'dash-side-link'
}

/**
 * Persistent left navigation for the streams directory. Internal product
 * routes use react-router NavLink (active styling); in-page sections (emote
 * economy, coverage health) use anchor links to the corresponding cards.
 */
export function HubSidebar({ counts }: HubSidebarProps) {
  return (
    <aside className="dash-sidebar" aria-label="Analytics navigation">
      <NavLink to="/analytics" className="dash-side-brand" end>
        <span className="logo" aria-hidden="true">
          SP
        </span>
        StreamPulse
        <span className="env">HUB</span>
      </NavLink>

      <nav className="dash-side-scroll" aria-label="Sections">
        <div className="dash-side-group">
          <div className="lbl">Overview</div>
          <NavLink to="/analytics" className={navClass} end>
            <LayoutDashboard aria-hidden="true" />
            Dashboard
          </NavLink>
          <NavLink to="/analytics/streams" className={navClass}>
            <Radio aria-hidden="true" />
            Live now
            {counts.live > 0 ? <span className="live-dot" aria-hidden="true" /> : null}
          </NavLink>
        </div>

        <div className="dash-side-group">
          <div className="lbl">Analytics</div>
          <NavLink to="/analytics/streams" className={navClass}>
            <LineChart aria-hidden="true" />
            Streams
            {counts.streams > 0 ? <span className="count">{compact(counts.streams)}</span> : null}
          </NavLink>
          <a href="#dash-emote-economy" className="dash-side-link">
            <Smile aria-hidden="true" />
            Emotes
            {counts.emotes > 0 ? <span className="count">{compact(counts.emotes)}</span> : null}
          </a>
          <a href="#dash-coverage" className="dash-side-link">
            <ShieldCheck aria-hidden="true" />
            Coverage
          </a>
        </div>

        <div className="dash-side-group">
          <div className="lbl">System</div>
          <NavLink to="/analytics/connection" className={navClass}>
            <Wifi aria-hidden="true" />
            Connection
          </NavLink>
          <NavLink to="/analytics/connection" className={navClass}>
            <Settings aria-hidden="true" />
            Settings
          </NavLink>
        </div>
      </nav>

      <div className="dash-side-foot">
        <span className="av" aria-hidden="true" />
        <span className="nm">
          Guest session
          <small>login optional · for pins</small>
        </span>
      </div>
    </aside>
  )
}
