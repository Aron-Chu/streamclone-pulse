import { describe, expect, it } from 'vitest'
import {
  EMPTY_CHART_SELECTION_NAVIGATION,
  cancelSelectionNavigation,
  centerViewportOnOffset,
  clearSelectionNavigation,
  isViewportFullDomain,
  rangeNavigation,
  sourceWindowForDuration,
  revealSelectionNavigation,
  viewportForRangePreset,
  zoomNavigation,
  zoomViewportInDomain,
} from '../src/ui/chartNavigation.ts'

const fullDomain = { startSeconds: 0, endSeconds: 8 * 60 * 60 }

describe('chart navigation', () => {
  it('anchors Range presets at the timeline end', () => {
    expect(viewportForRangePreset('30m', fullDomain)).toEqual({
      startSeconds: 27_000,
      endSeconds: 28_800,
    })
    expect(rangeNavigation('full', fullDomain).rangeValue).toBe('full')
  })

  it('marks button zoom as Custom and lets minus grow beyond a non-Full source', () => {
    const initial = rangeNavigation('30m', fullDomain)
    const zoomedIn = zoomNavigation({
      viewport: initial.viewport,
      sourceWindow: initial.sourceWindow,
      domain: fullDomain,
      direction: 'in',
    })
    expect(zoomedIn.rangeValue).toBe('custom')
    expect(zoomedIn.sourceWindow).toBe('30m')

    const zoomedOut = zoomNavigation({
      viewport: initial.viewport,
      sourceWindow: initial.sourceWindow,
      domain: fullDomain,
      direction: 'out',
    })
    expect(zoomedOut.rangeValue).toBe('custom')
    expect(zoomedOut.sourceWindow).toBe('60m')
    expect(zoomedOut.viewport.endSeconds - zoomedOut.viewport.startSeconds).toBe(3600)
  })

  it('reaches Full and disables further expansion by domain truth', () => {
    const next = zoomNavigation({
      viewport: { startSeconds: 7200, endSeconds: 28_800 },
      sourceWindow: '4h',
      domain: fullDomain,
      direction: 'out',
    })
    expect(next.rangeValue).toBe('full')
    expect(next.sourceWindow).toBe('full')
    expect(isViewportFullDomain(next.viewport, fullDomain)).toBe(true)
  })

  it('honors a late-coverage domain when zooming and centering', () => {
    const domain = { startSeconds: 7200, endSeconds: 14_400 }
    const zoomed = zoomViewportInDomain({
      viewport: domain,
      zoomSeconds: 1800,
      domain,
    })
    expect(zoomed.startSeconds).toBeGreaterThanOrEqual(domain.startSeconds)
    expect(centerViewportOnOffset({
      viewport: zoomed,
      offsetSeconds: 100,
      domain,
    }).startSeconds).toBe(domain.startSeconds)
  })

  it('only promotes source windows and never shrinks already loaded history', () => {
    expect(sourceWindowForDuration(7200, '30m', fullDomain)).toBe('2h')
    expect(sourceWindowForDuration(900, '4h', fullDomain)).toBe('4h')
    expect(sourceWindowForDuration(25_000, '4h', fullDomain)).toBe('full')
  })

  it('reveals off-screen selections and restores the original preset view', () => {
    const original = viewportForRangePreset('15m', fullDomain)
    const revealed = revealSelectionNavigation({
      state: EMPTY_CHART_SELECTION_NAVIGATION,
      viewport: original,
      rangeValue: '15m',
      offsetSeconds: 3600,
      domain: fullDomain,
    })
    expect(revealed.cause).toBe('selection')
    expect(revealed.rangeValue).toBe('custom')
    expect(revealed.viewport.startSeconds).toBeLessThanOrEqual(3600)
    expect(revealed.viewport.endSeconds).toBeGreaterThanOrEqual(3600)

    const restored = clearSelectionNavigation({
      state: revealed.state,
      viewport: revealed.viewport,
      rangeValue: revealed.rangeValue,
      domain: fullDomain,
    })
    expect(restored.cause).toBe('restore')
    expect(restored.viewport).toEqual(original)
    expect(restored.rangeValue).toBe('15m')
  })

  it('keeps the first restore view while switching selected moments', () => {
    const original = { startSeconds: 20_000, endSeconds: 21_800 }
    const first = revealSelectionNavigation({
      state: EMPTY_CHART_SELECTION_NAVIGATION,
      viewport: original,
      rangeValue: 'custom',
      offsetSeconds: 3600,
      domain: fullDomain,
    })
    const second = revealSelectionNavigation({
      state: first.state,
      viewport: first.viewport,
      rangeValue: first.rangeValue,
      offsetSeconds: 12_000,
      domain: fullDomain,
    })
    expect(second.state.restore?.viewport).toEqual(original)
    expect(second.viewport.startSeconds).toBeLessThanOrEqual(12_000)
    expect(second.viewport.endSeconds).toBeGreaterThanOrEqual(12_000)
  })

  it('cancels restoration after deliberate manual navigation', () => {
    const revealed = revealSelectionNavigation({
      state: EMPTY_CHART_SELECTION_NAVIGATION,
      viewport: { startSeconds: 20_000, endSeconds: 21_800 },
      rangeValue: 'custom',
      offsetSeconds: 3600,
      domain: fullDomain,
    })
    const manualViewport = { startSeconds: 9000, endSeconds: 10_800 }
    const cleared = clearSelectionNavigation({
      state: cancelSelectionNavigation(),
      viewport: manualViewport,
      rangeValue: 'custom',
      domain: fullDomain,
    })
    expect(revealed.state.restore).not.toBeNull()
    expect(cleared.cause).toBeNull()
    expect(cleared.viewport).toEqual(manualViewport)
  })
})
