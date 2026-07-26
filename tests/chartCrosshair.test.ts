import { describe, expect, it } from 'vitest'
import { resolveChartCrosshairMode } from '../src/ui/chartCrosshair.ts'

describe('resolveChartCrosshairMode', () => {
  it('shows pin only when not list-previewing', () => {
    expect(resolveChartCrosshairMode({ pinIndex: 5, listPreviewIndex: null })).toEqual({
      showPin: true,
      showListPreview: false,
      pinIndex: 5,
      listPreviewIndex: null,
    })
  })

  it('hides pin while previewing a different minute', () => {
    expect(resolveChartCrosshairMode({ pinIndex: 5, listPreviewIndex: 12 })).toEqual({
      showPin: false,
      showListPreview: true,
      pinIndex: null,
      listPreviewIndex: 12,
    })
  })

  it('shows pin when preview equals pin (deduped upstream)', () => {
    expect(resolveChartCrosshairMode({ pinIndex: 5, listPreviewIndex: null })).toEqual({
      showPin: true,
      showListPreview: false,
      pinIndex: 5,
      listPreviewIndex: null,
    })
  })

  it('shows preview only when pin is null', () => {
    expect(resolveChartCrosshairMode({ pinIndex: null, listPreviewIndex: 8 })).toEqual({
      showPin: false,
      showListPreview: true,
      pinIndex: null,
      listPreviewIndex: 8,
    })
  })
})
