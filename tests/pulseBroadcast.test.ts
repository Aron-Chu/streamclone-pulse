import { describe, expect, it } from 'vitest'
import {
  shouldSendPulseRuntimeBroadcast,
  shouldSendPulseToTab,
} from '../src/background/pulseBroadcast.ts'

describe('pulse broadcast targeting', () => {
  it('suppresses the runtime broadcast when the requester gets the direct response', () => {
    expect(shouldSendPulseRuntimeBroadcast()).toBe(true)
    expect(shouldSendPulseRuntimeBroadcast({ excludeTabId: 7 })).toBe(false)
  })

  it('skips only the requesting tab while preserving other Twitch tabs', () => {
    const options = { excludeTabId: 7 }
    expect(shouldSendPulseToTab(7, options)).toBe(false)
    expect(shouldSendPulseToTab(8, options)).toBe(true)
    expect(shouldSendPulseToTab(undefined, options)).toBe(false)
  })
})
