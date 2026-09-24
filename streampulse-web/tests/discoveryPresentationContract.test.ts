import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const landing = source('src/routes/analytics/AnalyticsLandingPage.tsx')
const activity = source('src/ui/components/analytics/FigmaGlobalActivityPanel.tsx')
const wire = source('src/ui/components/analytics/HubLiveWireFeed.tsx')
const layout = source('src/ui/components/analytics/discovery-layout.css')

describe('Analytics discovery presentation contract', () => {
  it('mounts one Live Wire in the shell, outside the analytical card', () => {
    const chart = landing.indexOf('analytics-discovery-layout__chart')
    const liveWire = landing.indexOf('analytics-discovery-layout__wire')
    const secondary = landing.indexOf('analytics-discovery-layout__secondary')
    expect(chart).toBeGreaterThan(0)
    expect(liveWire).toBeGreaterThan(0)
    expect(liveWire).toBeLessThan(chart)
    expect(landing).toContain('rightRail={')
    expect(landing.match(/<HubLiveWireFeed/g)).toHaveLength(1)
    expect(secondary).toBeGreaterThan(chart)
    expect(landing).toContain('requireExplicitSelection')
    expect(landing).toContain('Jump to Live Wire')
    expect(landing).toContain('Browse all moments & saved')
    expect(landing).not.toContain('Newsroom · catch up')
    expect(activity).not.toContain('ActivityNewsroomSidecar')
    expect(activity).toContain('Measurement and coverage details')
  })

  it('separates outer rail width from the chart-inspector breakpoint', () => {
    expect(layout).toContain('@media (min-width: 1440px)')
    expect(layout).toContain('@container (min-width: 1200px)')
    expect(layout).toContain('grid-template-columns: minmax(0, 1fr) 320px')
    expect(layout).toContain('#section-network ~ * { order: 3; }')
    expect(layout).not.toContain('"chart wire"')
  })

  it('uses discovery actions and omits score bars from compact Live Wire rows', () => {
    expect(wire).toContain('discoveryAnalyticsHref(discoveryMoment)')
    // Repeated row actions carry the exact creator, reaction and offset, so the
    // save control is named per row rather than bare.
    expect(wire).toContain('<SaveMomentButton moment={discoveryMoment} contextLabel={actionContext} />')
    expect(wire).toContain('on chart')
    expect(wire).not.toContain('hub-live-wire__bar-fill')
    expect(wire).not.toContain('rail-score')
  })

  it('keeps the rail an arrivals ticker rather than a second filterable list', () => {
    // Filtering, sorting and lifecycle all belong to surfaces that already own
    // them: the Pulse Moments table and Pool Wire.
    expect(wire).not.toContain('<select')
    expect(wire).not.toContain('categoryFilter')
    expect(wire).not.toContain('eventFilter')
    expect(wire).not.toContain('liveActivity')
    // The magnitude, not a sentence, is the headline, and a dip is marked as one.
    expect(wire).toContain('momentComparisonBadge')
    expect(wire).toContain('badge.belowBaseline')
    expect(wire).not.toContain('momentComparisonSummary')
  })
})
