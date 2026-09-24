import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { DataQualityDisclosure } from './ConsoleBits.tsx'

afterEach(cleanup)

describe('DataQualityDisclosure', () => {
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
