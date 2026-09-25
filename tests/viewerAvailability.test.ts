import { describe, expect, it } from 'vitest'
import { classifyViewerAvailability } from '../src/ui/viewerAvailability.ts'

describe('viewer availability classification', () => {
  it('shows a sampled viewer lane when samples intersect the viewport', () => {
    expect(classifyViewerAvailability({
      sampleCount: 18,
      samplesInRange: 4,
      isLive: true,
      latestSampleOffsetSeconds: 5421,
      currentOffsetSeconds: 5500,
    })).toBe('visible')
  })

  it('marks a live timeline paused when the last sample is stale', () => {
    expect(classifyViewerAvailability({
      sampleCount: 18,
      samplesInRange: 4,
      isLive: true,
      latestSampleOffsetSeconds: 5421,
      currentOffsetSeconds: 7000,
    })).toBe('paused')
  })

  it('distinguishes historical samples from a missing viewer timeline', () => {
    expect(classifyViewerAvailability({
      sampleCount: 18,
      samplesInRange: 0,
      isLive: true,
    })).toBe('historical')
    expect(classifyViewerAvailability({
      sampleCount: 0,
      samplesInRange: 0,
      isLive: true,
    })).toBe('absent')
  })
})
