import { describe, expect, it } from 'vitest'
import {
  mapPeakOffsetsToBucketedChartIndices,
  mapPeakOffsetsToChartIndices,
} from '../src/ui/chatActivityEmotes.ts'

describe('mapPeakOffsetsToChartIndices', () => {
  const chartOffsets = [0, 60, 120, 180, 240]

  it('maps peak offsets to nearest chart indices', () => {
    expect(mapPeakOffsetsToChartIndices([120, 240], chartOffsets)).toEqual([2, 4])
  })

  it('dedupes peaks that land on the same bar', () => {
    expect(mapPeakOffsetsToChartIndices([118, 122], chartOffsets)).toEqual([2])
  })

  it('skips peaks outside tolerance', () => {
    expect(mapPeakOffsetsToChartIndices([9999], chartOffsets)).toEqual([])
  })

  it('preserves score order when peaks map to distinct bars', () => {
    expect(mapPeakOffsetsToChartIndices([240, 60, 180], chartOffsets)).toEqual([4, 1, 3])
  })
})

describe('mapPeakOffsetsToBucketedChartIndices', () => {
  const wideOffsets = [0, 120, 240]

  it('maps peaks into wide buckets by containment', () => {
    expect(mapPeakOffsetsToBucketedChartIndices([100, 240], wideOffsets, [10, 20, 30])).toEqual([
      0, 2,
    ])
  })

  it('skips peaks that land on zero-activity buckets', () => {
    expect(mapPeakOffsetsToBucketedChartIndices([9999], wideOffsets, [0, 0, 0])).toEqual([])
  })

  it('dedupes peaks in the same bucket', () => {
    expect(mapPeakOffsetsToBucketedChartIndices([100, 110], wideOffsets, [10, 20, 30])).toEqual([0])
  })
})
