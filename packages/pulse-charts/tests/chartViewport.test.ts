import { describe, expect, it } from 'vitest'
import {
  chartViewportPresets,
  dragPanChartViewport,
  normalizeChartViewport,
  panChartViewport,
  resolveSelectionReveal,
  wheelZoomChartViewport,
  zoomChartViewport,
} from '../src/chartViewport.ts'
import {
  jumpViewportToOffset,
  railGeometry,
  resizeViewportEdge,
} from '../src/ChartPositionRail.tsx'

describe('chart viewport math', () => {
  it('keeps pointer-anchored zoom stable at the anchor', () => {
    const got = zoomChartViewport({
      viewport: { startSeconds: 0, endSeconds: 7200 },
      durationSeconds: 14400,
      zoomSeconds: 3600,
      anchorSeconds: 1800,
    })
    expect(got).toEqual({ startSeconds: 900, endSeconds: 4500 })
  })

  it('clamps zoom and pan to the wall duration', () => {
    const zoomed = normalizeChartViewport({ startSeconds: -100, endSeconds: 99999 }, 3600)
    expect(zoomed).toEqual({ startSeconds: 0, endSeconds: 3600 })
    expect(panChartViewport({ startSeconds: 300, endSeconds: 900 }, -9999, 3600)).toEqual({
      startSeconds: 0,
      endSeconds: 600,
    })
  })

  it('keeps unattested leading history outside the full visual domain', () => {
    expect(normalizeChartViewport(
      { startSeconds: 0, endSeconds: 7200 },
      7200,
      undefined,
      1800,
    )).toEqual({ startSeconds: 1800, endSeconds: 7200 })
    expect(panChartViewport(
      { startSeconds: 1800, endSeconds: 3600 },
      -9999,
      7200,
      undefined,
      1800,
    )).toEqual({ startSeconds: 1800, endSeconds: 3600 })
  })

  it('uses one full-stream coordinate model for the uncovered rail prefix', () => {
    const geometry = railGeometry(
      { startSeconds: 1800, endSeconds: 7200 },
      7200,
      100,
      1800,
    )

    expect(geometry.thumbX).toBeCloseTo(25)
    expect(geometry.thumbWidth).toBeCloseTo(75)
  })

  it('keeps edge resize inside coverage and enforces the minimum window', () => {
    const viewport = { startSeconds: 2400, endSeconds: 3000 }
    expect(resizeViewportEdge(viewport, 'start', -9999, 7200, 1800)).toEqual({
      startSeconds: 1800,
      endSeconds: 3000,
    })
    expect(resizeViewportEdge(viewport, 'end', -9999, 7200, 1800)).toEqual({
      startSeconds: 2400,
      endSeconds: 2700,
    })
    expect(resizeViewportEdge(viewport, 'end', 9999, 7200, 1800)).toEqual({
      startSeconds: 2400,
      endSeconds: 7200,
    })
  })

  it('uses bounded wheel ratios and exposes useful long-stream presets', () => {
    const current = { startSeconds: 0, endSeconds: 7200 }
    const zoomed = wheelZoomChartViewport({
      viewport: current,
      durationSeconds: 28800,
      deltaY: -120,
      anchorSeconds: 3600,
    })
    expect(zoomed.endSeconds - zoomed.startSeconds).toBeLessThan(7200)
    expect(chartViewportPresets(28800).map(item => item.label)).toEqual(['15m', '1h', '2h', '4h', 'Full'])
  })

  it('maps graph drag direction to timestamp pan and ignores full-range drags', () => {
    const zoomed = { startSeconds: 1200, endSeconds: 2400 }
    expect(dragPanChartViewport({
      viewport: zoomed,
      durationSeconds: 7200,
      deltaPixels: 100,
      plotWidthPixels: 400,
    })).toEqual({ startSeconds: 900, endSeconds: 2100 })
    expect(dragPanChartViewport({
      viewport: zoomed,
      durationSeconds: 7200,
      deltaPixels: -100,
      plotWidthPixels: 400,
    })).toEqual({ startSeconds: 1500, endSeconds: 2700 })
    expect(dragPanChartViewport({
      viewport: { startSeconds: 0, endSeconds: 7200 },
      durationSeconds: 7200,
      deltaPixels: -200,
      plotWidthPixels: 400,
    })).toEqual({ startSeconds: 0, endSeconds: 7200 })
  })
})

describe('PreviewNeverChangesViewportSelectionRevealsOnce', () => {
  it('ignores preview and reveals each newly committed off-screen selection once', () => {
    const viewport = { startSeconds: 0, endSeconds: 600 }
    const preview = resolveSelectionReveal({
      viewport,
      durationSeconds: 3600,
      selectedOffsetSeconds: null,
      previewOffsetSeconds: 1800,
      lastRevealedOffsetSeconds: null,
    })
    expect(preview).toEqual({
      viewport,
      revealedOffsetSeconds: null,
    })

    const selected = resolveSelectionReveal({
      viewport,
      durationSeconds: 3600,
      selectedOffsetSeconds: 1800,
      previewOffsetSeconds: null,
      lastRevealedOffsetSeconds: null,
    })
    expect(selected).toEqual({
      viewport: { startSeconds: 1500, endSeconds: 2100 },
      revealedOffsetSeconds: 1800,
    })

    const manualPan = { startSeconds: 2400, endSeconds: 3000 }
    expect(resolveSelectionReveal({
      viewport: manualPan,
      durationSeconds: 3600,
      selectedOffsetSeconds: 1800,
      previewOffsetSeconds: null,
      lastRevealedOffsetSeconds: selected.revealedOffsetSeconds,
    })).toEqual({
      viewport: manualPan,
      revealedOffsetSeconds: 1800,
    })

    expect(jumpViewportToOffset(
      manualPan,
      1800,
      3600,
      600,
    )).toEqual({ startSeconds: 1500, endSeconds: 2100 })
  })
})
