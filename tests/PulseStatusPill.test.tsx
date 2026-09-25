import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  PULSE_STATUS_PRESENTATION,
  PulseStatusPill,
  type PulseStatusKind,
} from '../src/ui/PulseStatusPill.tsx'
import { shadowStyles } from '../src/ui/theme.ts'

const statuses = Object.keys(PULSE_STATUS_PRESENTATION) as PulseStatusKind[]

describe('PulseStatusPill', () => {
  it.each(statuses)('renders an accessible, state-specific pill for %s', status => {
    const html = renderToStaticMarkup(<PulseStatusPill status={status} />)
    const presentation = PULSE_STATUS_PRESENTATION[status]

    expect(html).toContain(`class="pulse-status-pill pulse-status-pill-${status}"`)
    expect(html).toContain(`data-status="${status}"`)
    expect(html).toContain(`aria-label="${presentation.label}"`)
    expect(html).toContain(`title="${presentation.description}"`)
    expect(html).toContain(`pulse-status-pill-dot-${status}`)
    expect(html).toContain(presentation.label)
  })

  it('animates only active and in-progress states, with reduced-motion support', () => {
    expect(shadowStyles).toContain('@keyframes pulse-status-dot')
    expect(shadowStyles).toContain('.pulse-status-pill-tracking .pulse-status-pill-dot')
    expect(shadowStyles).toContain('.pulse-status-pill-syncing .pulse-status-pill-dot')
    expect(shadowStyles).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
