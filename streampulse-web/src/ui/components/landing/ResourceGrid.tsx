import { Link } from 'react-router-dom'
import { Activity, ArrowRight, BookOpen, TerminalSquare, type LucideIcon } from 'lucide-react'

interface ResourceLink {
  to: string
  icon: LucideIcon
  title: string
  copy: string
  cta: string
}

interface ResourceSoon {
  icon: LucideIcon
  title: string
  copy: string
}

const LINKS: ResourceLink[] = [
  {
    to: '/docs',
    icon: BookOpen,
    title: 'Documentation',
    copy: 'Coverage states, backfill behavior, and how the hosted console maps to Streamclone.',
    cta: 'Read the docs',
  },
  {
    to: '/status',
    icon: Activity,
    title: 'System status',
    copy: 'Live API health, collector coverage, and incident history for the hosted stack.',
    cta: 'View status',
  },
]

const SOON: ResourceSoon = {
  icon: TerminalSquare,
  title: 'Public API',
  copy: 'Programmatic access to sanitized peaks, coverage, and moments. Landing soon.',
}

export function ResourceGrid() {
  return (
    <div className="sl-resgrid">
      {LINKS.map(({ to, icon: Icon, title, copy, cta }) => (
        <Link key={to} to={to} className="sl-rescard">
          <span className="sl-res-ic" aria-hidden="true">
            <Icon size={20} />
          </span>
          <h3>{title}</h3>
          <p>{copy}</p>
          <span className="sl-res-go">
            {cta} <ArrowRight size={14} aria-hidden="true" style={{ verticalAlign: 'middle' }} />
          </span>
        </Link>
      ))}
      <div className="sl-rescard" aria-label={`${SOON.title} — coming soon`}>
        <span className="sl-res-ic" aria-hidden="true">
          <SOON.icon size={20} />
        </span>
        <h3>
          {SOON.title}
          <span className="sl-res-soon">Soon</span>
        </h3>
        <p>{SOON.copy}</p>
      </div>
    </div>
  )
}
