import { describe, expect, it } from 'vitest'
import {
  alignSeriesToChartPoints,
  chatAreaFillAlpha,
  chatBarFillAlpha,
  chartRenderDensity,
  overlayLineAlpha,
  shouldDrawEmoteOverlays,
  shouldDrawIndividualBars,
  smoothChartSeries,
  useAreaSilhouette,
} from '../src/ui/chartRenderUtils.ts'

describe('chartRenderDensity', () => {
  it('uses bars for 60m windows', () => {
    expect(chartRenderDensity(60, '60m')).toBe('sparse')
  })

  it('uses medium blend for 4h windows', () => {
    expect(chartRenderDensity(200, '4h')).toBe('medium')
  })

  it('uses area silhouette for full stream timelines', () => {
    expect(chartRenderDensity(400, 'full')).toBe('dense')
  })
})

describe('chatBarFillAlpha', () => {
  it('lightens only the hovered bar', () => {
    expect(chatBarFillAlpha('dense', 4, 4, true)).toBeGreaterThan(chatBarFillAlpha('dense', 3, 4, true))
    expect(chatBarFillAlpha('dense', 3, 4, true)).toBeLessThan(chatBarFillAlpha('dense', 4, 4, true))
  })
})

describe('overlayLineAlpha', () => {
  it('keeps emote lines quieter on dense timelines', () => {
    expect(overlayLineAlpha('dense', false, false, false)).toBeLessThan(
      overlayLineAlpha('sparse', false, false, false),
    )
  })

  it('fades baseline overlays at 2h and 4h windows', () => {
    const sparse60 = overlayLineAlpha('sparse', true, false, false, '60m')
    const sparse2h = overlayLineAlpha('sparse', true, false, false, '2h')
    const sparse4h = overlayLineAlpha('sparse', true, false, false, '4h')
    expect(sparse2h).toBeLessThan(sparse60)
    expect(sparse4h).toBeLessThan(sparse2h)
  })

  it('keeps selected lane overlays brighter at 2h', () => {
    const baseline = overlayLineAlpha('medium', true, false, false, '2h')
    const lane = overlayLineAlpha('medium', true, true, false, '2h')
    expect(lane).toBeGreaterThan(baseline)
  })
})

describe('smoothChartSeries', () => {
  it('smooths full-window series without changing endpoints', () => {
    const input = [0, 10, 100, 20, 5]
    const smoothed = smoothChartSeries(input, 'full')
    expect(smoothed[0]).toBe(0)
    expect(smoothed[smoothed.length - 1]).toBe(5)
    expect(smoothed[2]).toBeLessThan(100)
    expect(smoothed[2]).toBeGreaterThan(20)
  })

  it('smooths 2h spikes at interior points', () => {
    const input = [0, 10, 100, 20, 5]
    const smoothed = smoothChartSeries(input, '2h')
    expect(smoothed[0]).toBe(0)
    expect(smoothed[smoothed.length - 1]).toBe(5)
    expect(smoothed[2]).toBeLessThan(100)
    expect(smoothed[2]).toBeGreaterThan(20)
  })

  it('applies stronger smoothing for 4h than 2h', () => {
    const input = [0, 10, 100, 20, 5]
    const smoothed2h = smoothChartSeries(input, '2h')
    const smoothed4h = smoothChartSeries(input, '4h')
    expect(smoothed4h[2]).toBeLessThan(smoothed2h[2]!)
  })

  it('leaves short windows unchanged', () => {
    const input = [1, 5, 9]
    expect(smoothChartSeries(input, '60m')).toEqual(input)
  })
})

describe('alignSeriesToChartPoints', () => {
  it('duplicates a single source minute to match chat points', () => {
    expect(alignSeriesToChartPoints([42], 2, 1)).toEqual([42, 42])
  })

  it('truncates long overlay series to target length', () => {
    expect(alignSeriesToChartPoints([1, 2, 3, 4, 5], 3, 5)).toEqual([3, 4, 5])
  })

  it('pads short overlay series with leading zeros', () => {
    expect(alignSeriesToChartPoints([7, 8], 4, 2)).toEqual([0, 0, 7, 8])
  })
})

describe('render mode helpers', () => {
  it('draws area underlay for long windows', () => {
    expect(useAreaSilhouette('dense')).toBe(true)
    expect(useAreaSilhouette('sparse')).toBe(false)
  })

  it('skips hairline bars when columns are sub-pixel', () => {
    expect(shouldDrawIndividualBars('dense', 1.8)).toBe(false)
    expect(shouldDrawIndividualBars('dense', 3)).toBe(true)
  })

  it('never draws individual bars on full stream', () => {
    expect(shouldDrawIndividualBars('dense', 8, 'full')).toBe(false)
    expect(shouldDrawIndividualBars('sparse', 12, 'full')).toBe(false)
  })

  it('uses silhouette-only line mode for 2h and 4h', () => {
    expect(shouldDrawIndividualBars('medium', 8, '2h')).toBe(false)
    expect(shouldDrawIndividualBars('medium', 8, '4h')).toBe(false)
    expect(shouldDrawIndividualBars('sparse', 12, '60m')).toBe(true)
  })

  it('uses softer fill on full stream silhouettes', () => {
    expect(chatAreaFillAlpha('medium', '4h')).toBeLessThan(chatAreaFillAlpha('medium', '2h'))
    expect(chatAreaFillAlpha('dense', 'full')).toBeLessThan(chatAreaFillAlpha('dense', '4h'))
  })

  it('hides emote overlays on full stream unless scrubbing', () => {
    expect(shouldDrawEmoteOverlays('dense', false, 'full')).toBe(false)
    expect(shouldDrawEmoteOverlays('dense', true, 'full')).toBe(true)
    expect(shouldDrawEmoteOverlays('medium', false, '4h')).toBe(true)
    expect(shouldDrawEmoteOverlays('dense', false, '4h')).toBe(false)
  })
})
