import { describe, expect, it } from 'vitest'
import { normalizeHubLiveActivity, type HubLifecycleEvent } from '../src/lib/publicHub'

describe('public lifecycle normalization', () => {
  it('rejects unconfirmed ends, invalid clocks and unsupported event kinds', () => {
    const now = new Date().toISOString()
    const start: HubLifecycleEvent = { id: 'start', kind: 'went_live', channel: { id: 'c', login: 'creator' }, streamId: 's', occurredAt: now, detectedAt: now, timestampPrecision: 'twitch_started_at' }
    const result = normalizeHubLiveActivity({ status: 'ready', asOf: now, events: [start, start, { ...start, id: 'end', kind: 'went_offline', timestampPrecision: 'observed_after_confirmation' }, { ...start, id: 'bad-clock', occurredAt: 'invalid' }] })
    expect(result?.events).toEqual([start])
  })
})
