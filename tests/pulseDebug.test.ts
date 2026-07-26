import { describe, expect, it } from 'vitest'
import {
  interpretVodDebugBlockers,
  summarizeVodDebugBlockersFromEntries,
  vodLocalDiscoveryDiagnostic,
  type PulseDebugEntry,
} from '../src/shared/pulseDebug.ts'

const gqlBlockedEntry: PulseDebugEntry = {
  ts: Date.now(),
  step: 'vod.discover.gql',
  message: 'GQL returned no archive id',
  data: { gqlErrors: ['Failed to fetch'], source: null, streamId: '123' },
  level: 'warn',
}

describe('pulseDebug VOD blockers', () => {
  it('surfaces GQL blocked as primary when backend has not linked a VOD', () => {
    const summary = interpretVodDebugBlockers([gqlBlockedEntry])
    expect(summary).toContain('GQL blocked')
    expect(summary).toContain('API vodId still null')
  })

  it('demotes GQL blocked to a local discovery note when backend resolved the VOD', () => {
    const summary = summarizeVodDebugBlockersFromEntries([gqlBlockedEntry], { backendVodResolved: true })
    expect(summary).toContain('GQL blocked')
    expect(summary).not.toContain('API vodId still null')
  })

  it('returns null local discovery note when page discovery succeeded', () => {
    expect(vodLocalDiscoveryDiagnostic([])).toBeNull()
  })
})
