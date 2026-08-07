import { describe, expect, it } from 'vitest'
import { PULSE_HOST_Z_INDEX } from '../src/content/overlayStacking'

describe('Pulse overlay stacking', () => {
  it('stays above ordinary page content without covering Twitch popovers', () => {
    expect(PULSE_HOST_Z_INDEX).toBeGreaterThan(0)
    expect(PULSE_HOST_Z_INDEX).toBeLessThan(1000)
  })
})
