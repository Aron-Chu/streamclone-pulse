import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { resetHubBucketSelectionForTests } from '../src/lib/hubBucketSelection'
import { summarizeActivity } from '../src/lib/hubActivitySummary'
import { normalizePublicHub } from '../src/lib/publicHub'
import { HubActivityPanelV5 } from '../src/ui/components/analytics/HubActivityPanelV5'

afterEach(() => {
  cleanup()
  resetHubBucketSelectionForTests()
})

/** The page's hub before any reply: the empty payload, named with the range picked (24h). */
const empty = normalizePublicHub(null)
const notLanded = { ...empty, activity: { ...empty.activity, windowMinutes: 24 * 60 } }

const panel = (awaitingData: boolean) => render(<MemoryRouter>
  <HubActivityPanelV5
    hub={notLanded}
    activitySummary={summarizeActivity([], 30, 0)}
    suggestions={[]}
    loading
    awaitingData={awaitingData}
  />
</MemoryRouter>)

describe('HubActivityPanelV5 while the first hub reply is loading', () => {
  it('heads the chart with the range picked, not the empty payload\'s 30 min', () => {
    const { container } = panel(true)
    expect(container.querySelector('h2')!.textContent).toBe('Activity · last 24 h')
    expect(container.querySelector('[data-hub-activity-state]')!.getAttribute('data-hub-activity-state')).toBe('loading')
  })

  it('keeps the chart\'s 220 px space while it waits', () => {
    const { container } = panel(true)
    expect(container.querySelector<HTMLElement>('.hub-act-skeleton')!.style.height).toBe('220px')
  })

  it('keeps the served window once data has landed (a range refresh)', () => {
    const { container } = panel(false)
    expect(container.querySelector('h2')!.textContent).toBe('Activity · last 30 min')
  })
})
