import { describe, expect, it } from 'vitest'
import { buildChartHitRegions, chartHitRegionAtX } from '../src/chartHitRegions.ts'

describe('chart pointer hit regions', () => {
  it('resolves regular buckets with binary-searchable geometry', () => {
    const regions = buildChartHitRegions([
      { index: 0, centerX: 10 },
      { index: 1, centerX: 20 },
      { index: 2, centerX: 30 },
    ])

    expect(chartHitRegionAtX(regions, 20)?.index).toBe(1)
    expect(chartHitRegionAtX(regions, 29)?.index).toBe(2)
  })

  it('does not stretch a bucket across an irregular timestamp gap', () => {
    const regions = buildChartHitRegions([
      { index: 0, centerX: 10 },
      { index: 1, centerX: 20 },
      { index: 2, centerX: 100 },
      { index: 3, centerX: 110 },
    ])

    expect(chartHitRegionAtX(regions, 60)).toBeNull()
    expect(chartHitRegionAtX(regions, 100)?.index).toBe(2)
  })

  it('keeps authored missing buckets non-interactive', () => {
    const regions = buildChartHitRegions([
      { index: 0, centerX: 10 },
      { index: 1, centerX: 20, selectable: false },
      { index: 2, centerX: 30 },
    ])

    expect(chartHitRegionAtX(regions, 20)).toBeNull()
    expect(chartHitRegionAtX(regions, 30)?.index).toBe(2)
  })
})
