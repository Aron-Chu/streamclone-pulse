import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StoryComparison } from '../src/ui/components/newsroom/StoryComparison'
import { NetworkBrief } from '../src/ui/components/newsroom/NetworkBrief'

const metric = {
  state: 'ready' as const,
  currentPerMin: 10,
  baselinePerMin: 5,
  multiplier: 2,
  currentMeasuredMinutes: 1,
  currentExpectedMinutes: 1,
  baselineMeasuredMinutes: 239,
  baselineExpectedMinutes: 240,
  baselineCoveragePct: 239 / 240 * 100,
}

describe('rendered coverage percentages', () => {
  it('does not round an incomplete story baseline to 100%', () => {
    render(<StoryComparison label="Chat" metric={metric} />)
    expect(screen.getByText(/239\/240 min · 99\.5% coverage/)).toBeTruthy()
    expect(screen.queryByText(/239\/240 min · 100% coverage/)).toBeNull()
  })

  it.each([
    [0, '0%'],
    [100, '100%'],
    [99.6, '99.6%'],
    [Number.NaN, 'Unknown'],
  ])('renders network coverage %s as %s', (coveragePct, expected) => {
    render(<NetworkBrief brief={{
      currentStart: '2026-09-04T11:30:00Z',
      currentEnd: '2026-09-04T12:00:00Z',
      baselineStart: '2026-09-04T11:00:00Z',
      baselineEnd: '2026-09-04T11:30:00Z',
      comparableChannels: 10,
      coveragePct,
    }} />)
    expect(screen.getByText(expected)).toBeTruthy()
  })
})
