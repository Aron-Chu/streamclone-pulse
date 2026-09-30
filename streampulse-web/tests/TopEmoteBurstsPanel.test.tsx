import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TopEmoteBurstsPanel } from '../src/ui/components/analytics/TopEmoteBurstsPanel'

describe('TopEmoteBurstsPanel', () => {
  it('keeps measured counts and backend shares distinct from count-derived estimates', () => {
    render(<TopEmoteBurstsPanel variant="pulse-live" bursts={[
      { code: 'MeasuredEmoteWithALongName', count: 100, sharePct: 54.3 },
      { code: 'EstimatedEmote', count: 25 },
    ]} />)
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]!).getByText('100')).toBeTruthy()
    expect(within(rows[0]!).getByLabelText('54% share of emote sends in window')).toBeTruthy()
    expect(within(rows[0]!).queryByText('est.')).toBeNull()
    expect(within(rows[1]!).getByText('25')).toBeTruthy()
    expect(within(rows[1]!).getByLabelText('20% estimated share')).toBeTruthy()
    expect(screen.getByText('Estimated shares use available counts')).toBeTruthy()
  })

  it('does not turn zero counts into a fabricated share', () => {
    render(<TopEmoteBurstsPanel variant="pulse-live" bursts={[{ code: 'NoSends', count: 0 }]} />)
    expect(screen.getByText('0')).toBeTruthy()
    expect(screen.queryByLabelText(/share of emote sends|estimated share/)).toBeNull()
    expect(screen.queryByText('est.')).toBeNull()
  })

  it('calls onSelectBurst for bursts with peak anchors including stream start', () => {
    const onSelectBurst = vi.fn()
    render(
      <TopEmoteBurstsPanel
        bursts={[
          { code: 'KEKW', count: 42, peakOffset: '01:00', peakOffsetSeconds: 60 },
          { code: 'START', count: 5, peakOffset: '00:00', peakOffsetSeconds: 0 },
          { code: 'NOANCHOR', count: 10 },
        ]}
        selectedCode="KEKW"
        onSelectBurst={onSelectBurst}
      />,
    )
    fireEvent.click(screen.getByTitle('Plot KEKW on chart'))
    expect(onSelectBurst).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'KEKW', peakOffsetSeconds: 60 }),
    )
    expect((screen.getByTitle('Plot START on chart') as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByTitle('No peak anchor from backend for this burst yet.') as HTMLButtonElement).disabled).toBe(true)
  })
})
