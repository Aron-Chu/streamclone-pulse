import { describe, expect, it } from 'vitest'
import { recapChartPreviewOffset } from '../src/ui/recapTraceExpand.ts'

describe('recapChartPreviewOffset', () => {
  it('prefers hovered offset over selected offset', () => {
    expect(recapChartPreviewOffset(420, 120)).toBe(420)
  })

  it('falls back to selected offset when hover is cleared', () => {
    expect(recapChartPreviewOffset(null, 120)).toBe(120)
  })

  it('returns null when neither hover nor selection is set', () => {
    expect(recapChartPreviewOffset(null, null)).toBeNull()
  })
})
