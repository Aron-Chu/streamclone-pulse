import { Link } from 'react-router-dom'
import { Activity, ArrowRight, BookOpen, TerminalSquare, type LucideIcon } from 'lucide-react'

interface ResourceLink {
  to: string
  icon: LucideIcon
  title: string
  copy: string
  cta: string
}

const LINKS: ResourceLink[] = [
  {
    to: '/docs',
    icon: BookOpen,
    title: 'Documentation',
    copy: 'Install the extension, understand coverage, and find moments in Analytics.',
    cta: 'Read the docs',
  },
  {
    to: '/status',
    icon: Activity,
    title: 'System status',
    copy: 'Available service health and coverage measurements, with their last update time.',
    cta: 'View status',
  },
  {
    to: '/docs#api', icon: TerminalSquare, title: 'Developer reference',
    copy: 'Read-only aggregate endpoints and the boundaries of the public API.', cta: 'View reference',
  },
]

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
    </div>
  )
}
