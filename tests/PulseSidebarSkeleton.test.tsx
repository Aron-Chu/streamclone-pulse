import { describe, expect, it } from 'vitest'
import {
  PULSE_SIDEBAR_SKELETON_MIN_HEIGHT,
  pulseSidebarSkeletonStatusCopy,
} from '../src/ui/PulseSidebarSkeleton.tsx'

describe('PulseSidebarSkeleton', () => {
  it('uses hosted loading copy when payload is not available', () => {
    const copy = pulseSidebarSkeletonStatusCopy(true)
    expect(copy.title).toBe('Loading Pulse')
    expect(copy.detail).toContain('Fetching live analytics from StreamPulse')
    expect(copy.detail).not.toContain('Connecting to Streamclone')
  })

  it('reserves stable layout height for sidebar body', () => {
    expect(PULSE_SIDEBAR_SKELETON_MIN_HEIGHT).toBeGreaterThanOrEqual(360)
  })
})
