import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SyncStatusPanel } from './SyncStatusPanel.tsx'

afterEach(cleanup)

function factValue(term: string): string | null | undefined {
  return screen.getByText(term, { selector: 'dt' }).nextElementSibling?.textContent
}

describe('SyncStatusPanel coverage labels', () => {
  it.each([
    [239 / 240 * 100, '99.5% of stream minutes'],
    [0, '0% of stream minutes'],
    [100, '100% of stream minutes'],
    [Number.NaN, '-'],
  ])('renders %s without claiming false completeness', (coveragePct, expected) => {
    render(<SyncStatusPanel detail={{
      state: 'historical',
      stream: { streamId: 'sync-coverage', login: 'xqc' },
      rollups: [],
      topEmotes: [],
      chatCoveragePct: coveragePct,
    }} />)
    expect(factValue('Chat coverage')).toBe(expected)
  })
})

describe('SyncStatusPanel data-quality facts (d3-v2 session-original Status tab)', () => {
  it('lists quality, chat coverage, viewer samples and VOD, then the measured note', () => {
    const { container } = render(<SyncStatusPanel
      detail={{
        state: 'historical',
        stream: { streamId: 's1', login: 'xqc', viewerSamples: 12 },
        rollups: [],
        topEmotes: [],
        chatCoveragePct: 50,
        chatCoverage: { coveragePct: 50, partial: true, chatSpanMinutes: 30, streamSpanMinutes: 60 },
        viewerSource: 'live',
        availability: { vodState: 'resolving' },
        sources: [{ source: 'analytics_db', state: 'ready' }],
      }}
      summaryMetrics={{ viewerSampleCount: 600, data_coverage_pct: 50 }}
    />)
    const terms = [...container.querySelectorAll('[data-data-quality-facts] dt')].map(dt => dt.textContent)
    expect(terms).toEqual(['Data quality', 'Chat coverage', 'Viewer samples', 'VOD'])
    expect(factValue('Data quality')).toBe('Partial')
    expect(container.querySelector('[data-data-quality-warn]')).not.toBeNull()
    expect(factValue('Chat coverage')).toBe('50% of stream minutes')
    expect(factValue('Viewer samples')).toBe('600 · Live samples')
    expect(factValue('VOD')).toBe('resolving')
    expect(screen.getByText(/Partial coverage — chat spans 30 of 60 minutes/)).not.toBeNull()
    expect(screen.getByText('Every figure is measured; untracked minutes aren’t estimated.')).not.toBeNull()
    // A single source is always "Tracked": no Data sources card.
    expect(screen.queryByText('Data sources')).toBeNull()
  })

  it('shows Data sources only when there is more than one source', () => {
    render(<SyncStatusPanel detail={{
      state: 'historical',
      stream: { streamId: 's2', login: 'xqc' },
      rollups: [],
      topEmotes: [],
      sources: [{ source: 'analytics_db', state: 'ready' }, { source: 'gql', state: 'partial' }],
    }} />)
    expect(screen.getByText('Data sources')).not.toBeNull()
  })

  it('does not describe an unknown lifecycle as pending live', () => {
    render(<SyncStatusPanel detail={{
      state: 'historical',
      stream: { streamId: 's3', login: 'xqc', lifecycleState: 'unknown' },
      rollups: [],
      topEmotes: [],
      availability: { vodState: 'pending_live' },
    }} />)
    expect(factValue('VOD')).toBe('unavailable')
  })
})
