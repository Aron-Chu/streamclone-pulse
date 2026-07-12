import { describe, expect, it } from 'vitest'
import { portalChannelStreamsPath } from '../src/hooks/useChannelPageData'

describe('portalChannelStreamsPath', () => {
  it('uses the server-sanitized portal analytics channel route', () => {
    expect(portalChannelStreamsPath('Some Channel', 24)).toBe(
      '/v1/portal/analytics/channels/Some%20Channel/streams?limit=24',
    )
  })
})
