import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import {
  ArrowLeft,
  BarChart3,
  Home,
  LayoutDashboard,
  Plug,
  Radio,
  ShieldCheck,
  Smile,
} from 'lucide-react'
import { compact } from '../analytics/hubFormat'

export interface HubSidebarProps {
  liveCount: number
  emotesIndexed: number
  streamsTracked: number
  /** Invoked when any nav item is activated (used to close the drawer on mobile). */
  onNavigate?: () => void
}

interface RouteItem {
  kind: 'route'
  to: string
  end?: boolean
  label: string
  icon: ReactNode
  count?: string
  liveDot?: boolean
}

interface AnchorItem {
  kind: 'anchor'
  href: string
  label: string
  icon: ReactNode
  count?: string
  liveDot?: boolean
}

type NavItem = RouteItem | AnchorItem

export function HubSidebar({ liveCount, emotesIndexed, streamsTracked, onNavigate }: HubSidebarProps) {
  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: 'Overview',
      items: [
        { kind: 'route', to: '/analytics', end: true, label: 'Dashboard', icon: <LayoutDashboard /> },
        { kind: 'anchor', href: '#hx-live', label: 'Live now', icon: <Radio />, liveDot: liveCount > 0 },
      ],
    },
    {
      label: 'Analytics',
      items: [
        {
          kind: 'anchor',
          href: '#hx-command',
          label: 'Activity',
          icon: <BarChart3 />,
          count: streamsTracked > 0 ? compact(streamsTracked) : undefined,
        },
        {
          kind: 'anchor',
          href: '#hx-emotes',
          label: 'Emotes',
          icon: <Smile />,
          count: emotesIndexed > 0 ? compact(emotesIndexed) : undefined,
        },
        { kind: 'anchor', href: '#hx-coverage', label: 'Coverage', icon: <ShieldCheck /> },
      ],
    },
    {
      label: 'System',
      items: [
        { kind: 'route', to: '/analytics/connection', label: 'Connection', icon: <Plug /> },
        { kind: 'route', to: '/', end: true, label: 'Back to site', icon: <Home /> },
      ],
    },
  ]

  return (
    <aside className="hx-sidebar" aria-label="Analytics navigation">
      <Link to="/" className="hx-brand" onClick={onNavigate} aria-label="StreamPulse home">
        <span className="logo" aria-hidden="true">
          SP
        </span>
        StreamPulse
        <span className="env">HUB</span>
        <ArrowLeft className="back" aria-hidden="true" />
      </Link>
      <nav className="hx-side-scroll" aria-label="Primary">
        {groups.map((group) => (
          <div className="hx-side-group" key={group.label}>
            <div className="lbl">{group.label}</div>
            {group.items.map((item) =>
              item.kind === 'route' ? (
                <NavLink
                  key={item.label}
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  className={({ isActive }) => `hx-side-link${isActive ? ' is-active' : ''}`}
                >
                  {item.icon}
                  {item.label}
                  {item.count ? <span className="count">{item.count}</span> : null}
                  {item.liveDot ? <span className="live-dot" aria-hidden="true" /> : null}
                </NavLink>
              ) : (
                <a key={item.label} href={item.href} onClick={onNavigate} className="hx-side-link">
                  {item.icon}
                  {item.label}
                  {item.count ? <span className="count">{item.count}</span> : null}
                  {item.liveDot ? <span className="live-dot" aria-hidden="true" /> : null}
                </a>
              ),
            )}
          </div>
        ))}
      </nav>
      <div className="hx-side-foot">
        <span className="av" aria-hidden="true" />
        <span className="nm">
          Guest session
          <small>login optional · for pins</small>
        </span>
      </div>
    </aside>
  )
}
