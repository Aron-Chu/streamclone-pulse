import { describe, expect, it } from 'vitest'
import { streamStateLabel } from '@streampulse/analytics-console/utils/consoleFormat'

describe('streamStateLabel', () => {
  it('shows live on session routes when stream is still live', () => {
    expect(streamStateLabel('live', true)).toBe('live')
  })

  it('shows historical on session routes when stream ended', () => {
    expect(streamStateLabel('historical', true)).toBe('historical')
  })
})
