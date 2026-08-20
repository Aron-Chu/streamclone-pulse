import { useEffect, useState } from 'react'
import { COMMAND_CENTER_LABELS } from '../../themes/commandCenterLabels'

export interface HubSidebarSection {
  id: string
  label: string
  hidden?: boolean
}

const DEFAULT_SECTIONS: HubSidebarSection[] = [
  { id: 'section-overview', label: 'Overview' },
  { id: 'section-network', label: COMMAND_CENTER_LABELS.liveActivity },
  { id: 'section-pulse-moments', label: 'Pulse Moments' },
  { id: 'section-emote-signal', label: 'Emote Market' },
  { id: 'section-tracked', label: 'Channel Screener' },
  { id: 'section-coverage', label: 'Coverage' },
]

export interface AnalyticsHubSidebarProps {
  sections?: HubSidebarSection[]
  statusLabel?: string
  statusTone?: 'ready' | 'degraded' | 'offline'
}

/**
 * Live Wire is a sticky right rail, not an in-flow scroll section, so it is
 * excluded from the scroll-spy observer (action-only) and its "target" is the
 * single rail <aside> rather than a section id.
 */
const LIVE_WIRE_SECTION_ID = 'section-live-wire'

function scrollToSection(id: string) {
  const el =
    id === LIVE_WIRE_SECTION_ID
      ? document.querySelector<HTMLElement>('.figma-analytics__right-rail')
      : document.getElementById(id)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function AnalyticsHubSidebar({
  sections = DEFAULT_SECTIONS,
  statusLabel = 'Live',
  statusTone = 'ready',
}: AnalyticsHubSidebarProps) {
  const [activeId, setActiveId] = useState(sections[0]?.id ?? '')

  useEffect(() => {
    // Live Wire is action-only: it's a sticky rail, so it must not pin the
    // scroll-spy active state. Exclude it from observation entirely.
    const visible = sections.filter(
      (section) => !section.hidden && section.id !== LIVE_WIRE_SECTION_ID,
    )
    if (visible.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visibleEntry?.target.id) {
          setActiveId(visibleEntry.target.id)
        }
      },
      { rootMargin: '-20% 0px -55% 0px', threshold: [0.12, 0.35, 0.6] },
    )

    visible.forEach((section) => {
      const el = document.getElementById(section.id)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [sections])

  return (
    <nav className="analytics-hub-sidebar" aria-label="Analytics sections">
      <ul className="analytics-hub-sidebar__list">
        {sections
          .filter((section) => !section.hidden)
          .map((section) => {
            const active = section.id === activeId
            return (
              <li key={section.id} data-section-id={section.id}>
                <button
                  type="button"
                  className={`analytics-hub-sidebar__link${active ? ' is-active' : ''}`}
                  data-section-id={section.id}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => {
                    setActiveId(section.id)
                    scrollToSection(section.id)
                  }}
                >
                  {section.label}
                </button>
              </li>
            )
          })}
      </ul>
      <div className={`analytics-hub-sidebar__status analytics-hub-sidebar__status--${statusTone}`}>
        <span className="analytics-hub-sidebar__status-dot" aria-hidden="true" />
        <span>{statusLabel}</span>
      </div>
    </nav>
  )
}
