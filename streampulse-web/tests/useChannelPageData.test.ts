import { describe, expect, it } from 'vitest'
import {
  portalChannelStreamsPath,
  resolvePreferredChannelStreamId,
} from '../src/hooks/useChannelPageData'

describe('portalChannelStreamsPath', () => {
  it('uses the server-sanitized portal analytics channel route', () => {
    expect(portalChannelStreamsPath('Some Channel', 24)).toBe(
      '/v1/portal/analytics/channels/Some%20Channel/streams?limit=24',
    )
  })
})

describe('resolvePreferredChannelStreamId', () => {
  it('prefers the URL streamId even when it is absent from the recent strip', () => {
    expect(
      resolvePreferredChannelStreamId(
        [{ streamId: 'recent-1', live: true }, { streamId: 'recent-2' }],
        'deep-link-stream',
      ),
    ).toBe('deep-link-stream')
  })

  it('falls back to live then first strip item when no URL id is present', () => {
    expect(
      resolvePreferredChannelStreamId([
        { streamId: 'ended', live: false },
        { streamId: 'live-now', live: true },
      ]),
    ).toBe('live-now')
    expect(resolvePreferredChannelStreamId([{ streamId: 'only' }])).toBe('only')
  })
})
