import { describe, expect, it } from 'vitest'
import { isTracked, trackLogin, untrackLogin } from '../src/background/tracking.ts'

describe('tracking dedupe', () => {
  it('tracks login once until untrack', () => {
    untrackLogin('xqc')
    trackLogin('xqc')
    expect(isTracked('xqc')).toBe(true)
    trackLogin('xqc')
    expect(isTracked('xqc')).toBe(true)
    untrackLogin('xqc')
    expect(isTracked('xqc')).toBe(false)
  })
})
