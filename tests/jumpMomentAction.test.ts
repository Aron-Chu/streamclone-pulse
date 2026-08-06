import { describe, expect, it } from 'vitest'
import { resolveJumpMomentAction } from '../src/ui/jumpMomentAction.ts'

describe('resolveJumpMomentAction', () => {
  it('opens a validated VOD from a live channel moment', () => {
    const action = resolveJumpMomentAction({
      context: { kind: 'channel', vodId: '999' },
      payloadVodId: '999',
      effectiveIsLive: true,
      payloadIsLive: false,
      liveCurrentOffset: 3600,
      offsetSeconds: 3400,
    })
    expect(action).toEqual({ kind: 'open-vod-tab', vodId: '999', offsetSeconds: 3400 })
  })

  it('uses the validated VOD when raw-live is false but the channel is still live', () => {
    const action = resolveJumpMomentAction({
      context: { kind: 'channel' },
      payloadVodId: '111',
      effectiveIsLive: true,
      payloadIsLive: false,
      liveCurrentOffset: 120,
      offsetSeconds: 60,
    })
    expect(action).toEqual({ kind: 'open-vod-tab', vodId: '111', offsetSeconds: 60 })
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

  it('opens the validated VOD instead of treating it as a secondary fallback', () => {
    const action = resolveJumpMomentAction({
      context: { kind: 'channel' },
      payloadVodId: '222',
      effectiveIsLive: true,
      offsetSeconds: 10,
    })
    expect(action).toEqual({ kind: 'open-vod-tab', vodId: '222', offsetSeconds: 10 })
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
      payloadVodId: '444',
      payloadMode: 'vod',
      offsetSeconds: 12,
    })
    expect(action).toEqual({ kind: 'seek-vod', offsetSeconds: 12 })
  })

  it('uses the validated VOD origin delta for navigation timestamps', () => {
    const action = resolveJumpMomentAction({
      context: { kind: 'channel' },
      payloadVodId: '555',
      payloadMode: 'live_dvr',
      vodOriginDeltaSeconds: 4,
      offsetSeconds: 343,
    })
    expect(action).toEqual({ kind: 'open-vod-tab', vodId: '555', offsetSeconds: 339 })
  })

  it('does not seek a VOD route from its unvalidated URL candidate', () => {
    const action = resolveJumpMomentAction({
      context: { kind: 'vod', vodId: '666' },
      payloadMode: 'live_dvr',
      liveCurrentOffset: 500,
      offsetSeconds: 400,
    })
    expect(action).toEqual({ kind: 'open-analytics', offsetSeconds: 400 })
  })
})
