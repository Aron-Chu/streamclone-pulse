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

describe('pulseDebug VOD diagnostics', () => {
  it('labels blocked GQL as optional and does not invent an API failure', () => {
    const summary = interpretVodDebugBlockers([gqlBlockedEntry])
    expect(summary).toContain('Optional Twitch GQL was blocked')
    expect(summary).toContain('live analytics are unaffected')
    expect(summary).not.toContain('API vodId')
  })

  it('keeps blocked GQL as an optional local note when the backend resolved the VOD', () => {
    const summary = summarizeVodDebugBlockersFromEntries([gqlBlockedEntry], { backendVodResolved: true })
    expect(summary).toContain('Optional Twitch GQL was blocked')
    expect(summary).not.toContain('API vodId')
  })

  it('reports null VOD as archive-pending when live DVR analytics are active', () => {
    const summary = interpretVodDebugBlockers([{
      ts: Date.now(),
      step: 'vod.pulse.api',
      message: 'vod pulse payload received',
      data: { mode: 'live_dvr', resolutionState: 'live_stream_validated', vodId: null },
      level: 'info',
    }])
    expect(summary).toContain('Live analytics active; archive validation pending')
    expect(summary).not.toContain('failure')
  })

  it('returns null local discovery note when page discovery succeeded', () => {
    expect(vodLocalDiscoveryDiagnostic([])).toBeNull()
  })
})
