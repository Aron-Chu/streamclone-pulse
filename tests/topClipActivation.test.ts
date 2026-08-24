import { describe, expect, it } from 'vitest'
import { shouldApplyTopClipResponse } from '../src/ui/Overlay.tsx'

describe('top clip activation isolation', () => {
  it('rejects late responses from an older request or surface', () => {
    expect(shouldApplyTopClipResponse(1, 2)).toBe(false)
    expect(shouldApplyTopClipResponse(1, 1)).toBe(true)
  })
})
