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
})
