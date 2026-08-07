import { describe, expect, it } from 'vitest'
import {
  canLockChartBucket,
  resolveChartInspectionTarget,
  resolveChartPointerIntent,
  resolveChartSelectionAction,
} from '../src/ui/chartPointerIntent.ts'

describe('resolveChartPointerIntent', () => {
  it('rejects missing buckets for locks while allowing measured zeroes', () => {
    expect(canLockChartBucket({ missing: true })).toBe(false)
    expect(canLockChartBucket({ missing: false })).toBe(true)
    expect(canLockChartBucket({})).toBe(true)
    expect(canLockChartBucket(undefined)).toBe(false)
  })

  it('defers capture until horizontal movement crosses six pixels', () => {
    expect(resolveChartPointerIntent(10, 10, 15, 10)).toBe('pending')
    expect(resolveChartPointerIntent(10, 10, 17, 11)).toBe('horizontal')
  })

  it('leaves vertical touch movement available for page scrolling', () => {
    expect(resolveChartPointerIntent(10, 10, 11, 17)).toBe('vertical')
  })

  it('resolves inspection target priority from local hover to external preview to lock', () => {
    expect(resolveChartInspectionTarget({
      localHoverOffset: 300,
      externalPreviewOffset: 180,
      lockedOffset: 60,
    })).toBe(300)
    expect(resolveChartInspectionTarget({
      localHoverOffset: null,
      externalPreviewOffset: 180,
      lockedOffset: 60,
    })).toBe(180)
    expect(resolveChartInspectionTarget({
      localHoverOffset: null,
      externalPreviewOffset: null,
      lockedOffset: 60,
    })).toBe(60)
    expect(resolveChartInspectionTarget({
      localHoverOffset: null,
      externalPreviewOffset: null,
      lockedOffset: null,
    })).toBeNull()
  })

  it('clears the same locked point and locks a different release bucket', () => {
    expect(resolveChartSelectionAction({ index: 3, selectedIndex: 3, lockedIndex: null })).toBe('clear')
    expect(resolveChartSelectionAction({ index: 3, selectedIndex: null, lockedIndex: 3 })).toBe('clear')
    expect(resolveChartSelectionAction({ index: 4, selectedIndex: 3, lockedIndex: 3 })).toBe('lock')
  })

  it('keeps an unmeasured preview from becoming a lock request', () => {
    expect(canLockChartBucket({ missing: true })).toBe(false)
    expect(resolveChartSelectionAction({ index: 4, selectedIndex: null, lockedIndex: null })).toBe('lock')
  })
})
