import { describe, expect, it } from 'vitest'
import { resolveJumpMomentAction } from '../src/ui/jumpMomentAction.ts'

describe('resolveJumpMomentAction', () => {
  it('prefers same-player DVR when effective-live even if a VOD is linked', () => {
    const action = resolveJumpMomentAction({
      context: { kind: 'channel', vodId: '999' },
      payloadVodId: '999',
      effectiveIsLive: true,
      payloadIsLive: false,
      liveCurrentOffset: 3600,
      offsetSeconds: 3400,
    })
    expect(action).toEqual({
      kind: 'seek-live-dvr',
      offsetSeconds: 3400,
      liveCurrentOffset: 3600,
    })
  })

  it('does not silent-redirect to VOD when raw-live is false but effective-live is true', () => {
    const action = resolveJumpMomentAction({
      context: { kind: 'channel' },
      payloadVodId: '111',
      effectiveIsLive: true,
      payloadIsLive: false,
      liveCurrentOffset: 120,
      offsetSeconds: 60,
    })
    expect(action.kind).toBe('seek-live-dvr')
  })

  it('uses delayed viewer liveCurrentOffset for DVR targets', () => {
    const action = resolveJumpMomentAction({
      context: { kind: 'channel' },
      effectiveIsLive: true,
      liveCurrentOffset: 900,
      offsetSeconds: 700,
    })
    expect(action).toMatchObject({ kind: 'seek-live-dvr', liveCurrentOffset: 900 })
  })

  it('outside-buffer explains via live-outside-buffer and keeps VOD secondary', () => {
    const action = resolveJumpMomentAction({
      context: { kind: 'channel' },
      payloadVodId: '222',
      effectiveIsLive: true,
      offsetSeconds: 10,
    })
    expect(action).toEqual({
      kind: 'live-outside-buffer',
      offsetSeconds: 10,
      secondaryVodId: '222',
    })
  })

  it('opens VOD tab only when not live and VOD identity is present', () => {
    const action = resolveJumpMomentAction({
      context: { kind: 'channel' },
      payloadVodId: '333',
      effectiveIsLive: false,
      payloadIsLive: false,
      offsetSeconds: 40,
    })
    expect(action).toEqual({ kind: 'open-vod-tab', vodId: '333', offsetSeconds: 40 })
  })

  it('falls back to analytics when offline without VOD', () => {
    const action = resolveJumpMomentAction({
      context: { kind: 'channel' },
      effectiveIsLive: false,
      offsetSeconds: 40,
    })
    expect(action).toEqual({ kind: 'open-analytics', offsetSeconds: 40 })
  })

  it('seeks in-player on VOD pages', () => {
    const action = resolveJumpMomentAction({
      context: { kind: 'vod', vodId: '444' },
      offsetSeconds: 12,
    })
    expect(action).toEqual({ kind: 'seek-vod', offsetSeconds: 12 })
  })
})
