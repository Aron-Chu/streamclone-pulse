import { describe, expect, it } from 'vitest'
import { applyOverlayPayloadUpdate } from '../src/content/mount.tsx'
import type { PulsePayload } from '../src/shared/messages.ts'

function payload(streamId?: string): PulsePayload {
  return {
    login: 'xqc',
    isLive: true,
    tracking: true,
    streamId,
    currentOffsetSeconds: 120,
    rollups: [],
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
  }
}

describe('content stream identity acceptance', () => {
  it('rejects missing or mismatched stream identities for non-authoritative updates', () => {
    const previous = payload('stream-a')
    expect(applyOverlayPayloadUpdate(previous, payload())).toBe(previous)
    expect(applyOverlayPayloadUpdate(previous, payload('stream-b'))).toBe(previous)
  })

  it('allows a direct authoritative response to establish a new stream', () => {
    const next = payload('stream-b')
    expect(applyOverlayPayloadUpdate(payload('stream-a'), next, { allowStreamChange: true })).toBe(next)
  })

  it('keeps the activation full source when a recent poll follows it', () => {
    const previous = payload('stream-a')
    previous.fullRollups = [
      { offsetSeconds: 0, chatCount: 3, sevenTvEmoteCount: 1 },
      { offsetSeconds: 60, chatCount: 9, sevenTvEmoteCount: 4 },
    ]
    const incoming = {
      ...payload('stream-a'),
      currentOffsetSeconds: 180,
      rollups: [{ offsetSeconds: 180, chatCount: 15, sevenTvEmoteCount: 6 }],
    }

    const merged = applyOverlayPayloadUpdate(previous, incoming)

    expect(merged?.currentOffsetSeconds).toBe(180)
    expect(merged?.fullRollups).toEqual(previous.fullRollups)
    expect(merged?.rollups).toEqual([
      ...previous.rollups,
      ...incoming.rollups,
    ])
  })
})
