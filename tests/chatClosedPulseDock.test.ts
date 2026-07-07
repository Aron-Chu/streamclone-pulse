import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CHAT_CLOSED_PULSE_DOCK_ENABLED,
  resolveChatClosedPulseDockEnabled,
} from '../src/shared/storage.ts'

describe('resolveChatClosedPulseDockEnabled', () => {
  it('defaults to false for new installs', () => {
    expect(DEFAULT_CHAT_CLOSED_PULSE_DOCK_ENABLED).toBe(false)
    expect(resolveChatClosedPulseDockEnabled(undefined)).toBe(false)
  })

  it('respects an explicit stored value', () => {
    expect(resolveChatClosedPulseDockEnabled(true)).toBe(true)
    expect(resolveChatClosedPulseDockEnabled(false)).toBe(false)
  })
})
