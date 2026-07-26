import { describe, expect, it } from 'vitest'
import {
  nextTracesExpandedAfterPlottedCountChange,
  recapChartPreviewOffset,
  resolveTracesExpanded,
} from '../src/ui/recapTraceExpand.ts'

describe('resolveTracesExpanded', () => {
  it('returns false when no emotes are plotted', () => {
    expect(
      resolveTracesExpanded({
        plottedCount: 0,
        tracesExpanded: true,
        userCollapsedTraces: false,
      }),
    ).toBe(false)
  })

  it('auto-expands when emotes are plotted and user has not collapsed', () => {
    expect(
      resolveTracesExpanded({
        plottedCount: 2,
        tracesExpanded: false,
        userCollapsedTraces: false,
      }),
    ).toBe(true)
  })

  it('respects user collapse while emotes remain selected', () => {
    expect(
      resolveTracesExpanded({
        plottedCount: 2,
        tracesExpanded: false,
        userCollapsedTraces: true,
      }),
    ).toBe(false)
  })
})

describe('nextTracesExpandedAfterPlottedCountChange', () => {
  it('resets collapse state when all emotes are cleared', () => {
    expect(
      nextTracesExpandedAfterPlottedCountChange({
        plottedCount: 0,
        userCollapsedTraces: true,
      }),
    ).toEqual({ tracesExpanded: false, userCollapsedTraces: false })
  })

  it('auto-expands when emotes are added and user has not collapsed', () => {
    expect(
      nextTracesExpandedAfterPlottedCountChange({
        plottedCount: 1,
        userCollapsedTraces: false,
      }),
    ).toEqual({ tracesExpanded: true, userCollapsedTraces: false })
  })

  it('keeps traces collapsed when user collapsed before adding more emotes', () => {
    expect(
      nextTracesExpandedAfterPlottedCountChange({
        plottedCount: 3,
        userCollapsedTraces: true,
      }),
    ).toEqual({ tracesExpanded: false, userCollapsedTraces: true })
  })
})

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
