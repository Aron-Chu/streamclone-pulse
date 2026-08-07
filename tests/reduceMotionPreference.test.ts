import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REDUCE_MOTION_PREFERENCE,
  resolveReduceMotionPreference,
  resolveReducedMotionEnabled,
} from '../src/shared/storage.ts'

describe('resolveReduceMotionPreference', () => {
  it('defaults to system for new installs', () => {
    expect(DEFAULT_REDUCE_MOTION_PREFERENCE).toBe('system')
    expect(resolveReduceMotionPreference(undefined)).toBe('system')
    expect(resolveReduceMotionPreference(null)).toBe('system')
    expect(resolveReduceMotionPreference('nope')).toBe('system')
  })

  it('respects an explicit stored value', () => {
    expect(resolveReduceMotionPreference('system')).toBe('system')
    expect(resolveReduceMotionPreference('on')).toBe('on')
    expect(resolveReduceMotionPreference('off')).toBe('off')
  })
})

describe('resolveReducedMotionEnabled', () => {
  it('follows the OS only when preference is system', () => {
    expect(resolveReducedMotionEnabled('system', true)).toBe(true)
    expect(resolveReducedMotionEnabled('system', false)).toBe(false)
  })

  it('forces on/off regardless of the OS setting', () => {
    expect(resolveReducedMotionEnabled('on', false)).toBe(true)
    expect(resolveReducedMotionEnabled('on', true)).toBe(true)
    expect(resolveReducedMotionEnabled('off', true)).toBe(false)
    expect(resolveReducedMotionEnabled('off', false)).toBe(false)
  })
})
