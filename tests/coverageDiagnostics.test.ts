import { describe, expect, it } from 'vitest'
import { coverageDiagnostics } from '../src/ui/coverageDiagnostics.ts'

describe('coverageDiagnostics', () => {
  it('flags missing VOD on live partial coverage', () => {
    const result = coverageDiagnostics({
      isLive: true,
      tracking: true,
      streamId: 's1',
      coverageStartOffsetSeconds: 900,
      coverage: {
        state: 'waiting_for_vod',
        coverageStartOffsetSeconds: 900,
        coverageEndOffsetSeconds: 4500,
        hasFullStreamCoverage: false,
        hasGaps: true,
        canBackfill: false,
        message: 'waiting',
      },
    })
    expect(result.checks.some(c => c.label === 'Twitch VOD link' && !c.ok)).toBe(true)
    expect(result.fixHint).toMatch(/VOD ID/)
  })

  it('shows backfill progress in status line', () => {
    const result = coverageDiagnostics(
      { tracking: true, streamId: 's1', isLive: true },
      {
        jobId: 'j1',
        status: 'fetching_chat',
        message: 'Fetching chat',
        progress: { percent: 42 },
        range: { fromOffsetSeconds: 0, toOffsetSeconds: 840 },
        streamId: 's1',
        login: 'chan',
      },
      Date.now() - 5000,
    )
    expect(result.statusLine).toContain('42%')
  })
})
