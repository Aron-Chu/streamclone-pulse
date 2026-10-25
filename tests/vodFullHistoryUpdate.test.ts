import { describe, expect, it } from 'vitest'
import { hasValidatedFullHistory, makeFullHistoryActivation } from '../src/shared/fullHistoryAuth.ts'
import type { ExtensionRollup } from '../src/shared/messages.ts'
import type { ExtensionVodPulseResponse } from '../src/types/vodPulseTypes.ts'
import { vodFullHistoryUpdate } from '../src/vod/vodPulseToChannelPayload.ts'

function minutes(fromSeconds: number, toSeconds: number): ExtensionRollup[] {
  const rows: ExtensionRollup[] = []
  for (let offset = fromSeconds; offset <= toSeconds; offset += 60) {
    rows.push({ offsetSeconds: offset, chatCount: 40, sevenTvEmoteCount: 4, totalEmoteCount: 9 })
  }
  return rows
}

// A growing VOD two hours in: the recent window starts at 56:00, the full one at 0:50.
function growingVod(fullRollups?: ExtensionRollup[]): ExtensionVodPulseResponse {
  return {
    mode: 'live_dvr',
    vodId: '2903671992',
    provisional: false,
    resolutionState: 'live_archive_validated',
    retryable: false,
    streamId: 'stream-jerma',
    login: 'jerma985',
    isLive: true,
    tracking: true,
    currentOffsetSeconds: 7_730,
    coverageStartOffsetSeconds: 50,
    rollups: minutes(3_360, 7_710),
    fullRollups,
    lanes: { composite: [], chat: [], seventv: [] },
  } as ExtensionVodPulseResponse
}

describe('vodFullHistoryUpdate (VOD-5)', () => {
  it('turns a growing VOD full-window answer into a Full payload the chart accepts', () => {
    const update = vodFullHistoryUpdate(
      { type: 'VOD_PULSE_UPDATE', vodId: '2903671992', vodPulse: growingVod(minutes(50, 7_730)) },
      'jerma985',
    )
    expect(update).toMatchObject({ type: 'PULSE_UPDATE', login: 'jerma985', streamId: 'stream-jerma' })
    expect(update?.payload?.fullRollups?.[0]?.offsetSeconds).toBe(50)
    const activation = makeFullHistoryActivation({ login: 'jerma985', streamId: 'stream-jerma', vodId: '2903671992' })
    expect(hasValidatedFullHistory(update?.payload, activation)).toBe(true)
  })

  it('a recent-window answer has no full history to show', () => {
    const update = vodFullHistoryUpdate(
      { type: 'VOD_PULSE_UPDATE', vodId: '2903671992', vodPulse: growingVod() },
      'jerma985',
    )
    expect(hasValidatedFullHistory(update?.payload)).toBe(false)
  })

  it('returns nothing for a failed or foreign answer', () => {
    expect(vodFullHistoryUpdate({ type: 'VOD_PULSE_UPDATE', vodId: '1', vodPulse: null, error: 'pulse 503' })).toBeNull()
    expect(vodFullHistoryUpdate({ type: 'PULSE_UPDATE', login: 'x', payload: null })).toBeNull()
    expect(vodFullHistoryUpdate(null)).toBeNull()
  })
})
