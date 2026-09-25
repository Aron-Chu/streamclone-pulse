import { describe, expect, it } from 'vitest'
import { optionsForBoundedActivityFallback } from '../src/lib/activityRangeCapabilities'

describe('bounded activity range capabilities', () => {
  it('keeps only the served range and an unsupported direct URL selection', () => {
    const options = ['30m', '24h', '7d', '1y'].map(key => ({ key, label: key }))
    expect(optionsForBoundedActivityFallback(options, '24h', '30m').map(option => option.key)).toEqual(['30m', '24h'])
    expect(optionsForBoundedActivityFallback(options, '30m', '30m').map(option => option.key)).toEqual(['30m'])
  })
})
