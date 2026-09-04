import { describe, expect, it } from 'vitest'
import {
  normalizePortalVodId,
  portalDetailToAnalytics,
  portalLiveResponseToAnalytics,
} from './streamcloneAnalytics'

describe('normalizePortalVodId', () => {
  it('accepts a numeric Twitch VOD id and trims surrounding whitespace', () => {
    expect(normalizePortalVodId('  318299176935  ')).toBe('318299176935')
  })

  it.each([undefined, '', '   ', '123 456789012', 'https://www.twitch.tv/videos/318299176935', 'vod-318299176935', '1234', '123456789012345678901'])
    ('rejects invalid VOD candidate %j', (candidate) => {
      expect(normalizePortalVodId(candidate)).toBeUndefined()
    })
})

describe('portal VOD conversion', () => {
  const detail = (overrides: Record<string, unknown> = {}) => ({
    channel: 'forsen',
    state: 'ended',
    updatedAt: 1,
    stream: {
      streamId: '318299176935',
      login: 'forsen',
      startedAt: '2026-09-01T13:01:09Z',
      vodId: '  stream-vod  ',
    },
    ...overrides,
  })

  it('prefers availability VOD id over top-level and nested stream candidates', () => {
    const result = portalDetailToAnalytics(
      detail({
        vodId: '123456789012',
        availability: { vodId: ' 987654321098 ' },
      }),
      null,
      null,
    )

    expect(result.vodId).toBe('987654321098')
    expect(result.availability?.vodId).toBe('987654321098')
  })

  it('falls back from invalid availability to the top-level VOD id', () => {
    const result = portalDetailToAnalytics(
      detail({
        vodId: '123456789012',
        availability: { vodId: 'https://twitch.tv/videos/123456789012' },
      }),
      null,
      null,
    )

    expect(result.vodId).toBe('123456789012')
    expect(result.availability?.vodId).toBe('123456789012')
  })

  it('falls back to a valid nested stream VOD id when higher-priority values are invalid', () => {
    const result = portalDetailToAnalytics(
      detail({
        vodId: ' ',
        availability: { vodId: '' },
        stream: {
          streamId: '318299176935',
          login: 'forsen',
          startedAt: '2026-09-01T13:01:09Z',
          vodId: '123456789012',
        },
      }),
      null,
      null,
    )

    expect(result.vodId).toBe('123456789012')
    expect(result.stream?.vodId).toBe('123456789012')
  })

  it('keeps a resolving live DVR response without a VOD id linkless and truthful', () => {
    const result = portalLiveResponseToAnalytics({
      channel: 'forsen',
      state: 'ended',
      updatedAt: 1,
      vodId: ' ',
      stream: {
        streamId: '318299176935',
        login: 'forsen',
        startedAt: '2026-09-01T13:01:09Z',
        vodId: '',
      },
      availability: {
        liveDvrState: 'ended',
        vodState: 'resolving',
        vodId: null,
        vodMessage: 'Stream ended — waiting for Twitch VOD publication.',
      },
    })

    expect(result.vodId).toBeUndefined()
    expect(result.stream?.vodId).toBeUndefined()
    expect(result.availability).toMatchObject({
      liveDvrState: 'ended',
      vodState: 'resolving',
      vodMessage: 'Stream ended — waiting for Twitch VOD publication.',
      vodId: undefined,
    })
  })
})
