import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TopEmoteBurstsPanel } from '../src/ui/components/analytics/TopEmoteBurstsPanel'

describe('TopEmoteBurstsPanel', () => {
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
