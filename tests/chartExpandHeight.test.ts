import { describe, expect, it } from 'vitest'
import { chartExpandTargetHeight } from '../src/ui/chartExpandHeight.ts'

describe('chartExpandTargetHeight', () => {
  it('matches live dock Expand / Reset heights', () => {
    expect(chartExpandTargetHeight({ sidebarFill: false, expanded: false })).toBe(184)
    expect(chartExpandTargetHeight({ sidebarFill: false, expanded: true })).toBe(268)
  })

  it('matches live sidebar Expand / Reset heights', () => {
    expect(chartExpandTargetHeight({ sidebarFill: true, expanded: false })).toBe(216)
    expect(chartExpandTargetHeight({ sidebarFill: true, expanded: true })).toBe(312)
  })
})
