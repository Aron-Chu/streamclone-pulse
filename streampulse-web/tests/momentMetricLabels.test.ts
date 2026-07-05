import { describe, expect, it } from 'vitest'
import { formatViewerDelta, formatViewerDeltaCompact } from '../src/lib/momentMetricLabels'

describe('formatViewerDelta', () => {
  it('formats backend numeric strings with viewers suffix', () => {
    expect(formatViewerDelta('+9000')).toBe('+9K viewers')
    expect(formatViewerDelta('-1200')).toBe('-1.2K viewers')
  })

  it('treats backend zero string as no change', () => {
    expect(formatViewerDelta('0')).toBe('no change')
  })

  it('returns em dash when delta is missing', () => {
    expect(formatViewerDelta(null)).toBe('—')
    expect(formatViewerDelta('')).toBe('—')
  })
})

describe('formatViewerDeltaCompact', () => {
  it('drops viewers suffix for table cells', () => {
    expect(formatViewerDeltaCompact('+9000')).toBe('+9K')
    expect(formatViewerDeltaCompact('-500')).toBe('-500')
  })

  it('maps missing and flat deltas to em dash', () => {
    expect(formatViewerDeltaCompact(null)).toBe('—')
    expect(formatViewerDeltaCompact('0')).toBe('—')
    expect(formatViewerDeltaCompact(0)).toBe('—')
  })
})
