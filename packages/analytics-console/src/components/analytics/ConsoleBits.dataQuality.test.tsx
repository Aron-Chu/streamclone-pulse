import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { vi } from 'vitest'
import { CoverageStartMetaItem, DataQualityButton, DataQualityDisclosure, formatCoverageLead } from './ConsoleBits.tsx'

afterEach(cleanup)

describe('DataQualityDisclosure', () => {
  it('shows a neutral placeholder instead of a verdict while there is no data to judge', () => {
    const { container } = render(<DataQualityDisclosure pending />)
    const chip = container.querySelector('[data-data-quality-pending]')!
    expect(chip.textContent).toBe('Data quality: —')
    expect(chip.className).toContain('min-h-11')
    expect(chip.className).toContain('text-zinc-400')
    expect(container.textContent).not.toMatch(/No data/i)
    // Nothing to disclose yet, so no expandable details.
    expect(container.querySelector('details')).toBeNull()
  })

  it('presents quality, chat span, viewer samples, and VOD state in one disclosure', () => {
    render(
      <DataQualityDisclosure
        detail={{
          state: 'historical',
          stream: { streamId: 'session-1', login: 'xqc', viewerSamples: 12 },
          rollups: [],
          topEmotes: [],
          chatCoveragePct: 50,
          chatCoverage: { coveragePct: 50, partial: true, chatSpanMinutes: 30, streamSpanMinutes: 60 },
          viewerSource: 'live',
          availability: { vodState: 'resolving' },
        }}
      />,
    )

    const disclosure = screen.getByText(/Data quality:/i)
    expect(disclosure.closest('summary')).not.toBeNull()
    fireEvent.click(disclosure)
    expect(screen.getByText(/50% of the timeline \(30 of 60 minutes\)/i)).not.toBeNull()
    expect(screen.getByText(/12 samples · Live samples/i)).not.toBeNull()
    expect(screen.getByText(/resolving/i)).not.toBeNull()
    expect(document.querySelectorAll('[data-data-quality-disclosure]')).toHaveLength(1)
  })

  it.each([
    [99.6, '99.6%'],
    [239 / 240 * 100, '99.5%'],
    [0, '0%'],
    [100, '100%'],
    [Number.NaN, 'Unknown'],
  ])('renders coverage %s without rounding incomplete values to perfect', (coverage, expected) => {
    render(<DataQualityDisclosure detail={{
      state: 'historical',
      stream: { streamId: 'session-coverage', login: 'xqc' },
      rollups: [],
      topEmotes: [],
      chatCoveragePct: coverage,
    }} />)
    expect(screen.getByText(new RegExp(`${expected.replace(/[.*+?^${}()|[\]\\%]/g, '\\$&')} of the timeline`, 'i'))).not.toBeNull()
  })

  it('does not describe an unknown lifecycle as pending live', () => {
    render(<DataQualityDisclosure detail={{
      state: 'historical',
      stream: { streamId: 'session-unknown', login: 'xqc', lifecycleState: 'unknown' },
      rollups: [],
      topEmotes: [],
      availability: { vodState: 'pending_live' },
    }} />)
    expect(screen.getByText('VOD:').parentElement?.textContent).toBe('VOD: unavailable')
    expect(screen.queryByText('pending live')).toBeNull()
  })
})

describe('DataQualityButton (meta line "Data: <label>")', () => {
  const goodDetail = {
    state: 'historical',
    stream: { streamId: 'good', login: 'xqc' },
    rollups: [],
    topEmotes: [],
    timelineMinutes: 600,
  } as const

  it('shows a neutral placeholder while pending', () => {
    const { container } = render(<DataQualityButton pending />)
    const chip = container.querySelector('[data-data-quality-pending]')!
    expect(chip.textContent).toBe('Data: —')
    expect(container.querySelector('button')).toBeNull()
  })

  it('reads "Data: Good" without a warning mark and opens the Status tab', () => {
    const onOpen = vi.fn()
    render(<DataQualityButton detail={goodDetail} summaryMetrics={{ data_coverage_pct: 99, sync_health_state: 'synced' }} onOpen={onOpen} />)
    const button = screen.getByRole('button', { name: 'Data: Good' })
    expect(button.getAttribute('aria-controls')).toBe('session-panel-status')
    expect(button.querySelector('[data-data-quality-warn]')).toBeNull()
    fireEvent.click(button)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('marks a label other than Good', () => {
    render(<DataQualityButton detail={{ ...goodDetail, chatCoveragePct: 50 }} summaryMetrics={{ data_coverage_pct: 50 }} />)
    const button = screen.getByRole('button', { name: 'Data: Partial' })
    expect(button.querySelector('[data-data-quality-warn]')).not.toBeNull()
  })
})

describe('CoverageStartMetaItem ("First 54s not tracked")', () => {
  it.each([
    [54, '54s'],
    [60, '1m'],
    [125, '2m 5s'],
  ])('formats %s seconds as %s', (seconds, expected) => {
    expect(formatCoverageLead(seconds)).toBe(expected)
  })

  it('keeps the coverage hook and the backend wording as its title', () => {
    const { container } = render(<CoverageStartMetaItem
      missingRanges={[{ fromOffsetSeconds: 0, toOffsetSeconds: 54 }]}
      message="Coverage starts after the first minute."
    />)
    const item = container.querySelector('[data-coverage-start]')!
    expect(item.textContent).toBe('First 54s not tracked')
    expect(item.getAttribute('title')).toBe('Coverage starts after the first minute.')
  })

  it('renders nothing without a leading gap', () => {
    const { container } = render(<CoverageStartMetaItem offsetSeconds={0} />)
    expect(container.firstChild).toBeNull()
  })
})
