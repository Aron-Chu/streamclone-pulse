import { describe, expect, it } from 'vitest'
import {
  HOSTED_API_HOSTNAME,
  HOSTED_API_ORIGIN,
  isHostedApiUrl,
  textContainsHostedApiOrigin,
} from '../scripts/lib/hosted-api-origin.mjs'

describe('isHostedApiUrl', () => {
  it('accepts exact hosted HTTPS origin URLs', () => {
    expect(isHostedApiUrl(HOSTED_API_ORIGIN)).toBe(true)
    expect(isHostedApiUrl(`${HOSTED_API_ORIGIN}/v1/extension/health`)).toBe(true)
    expect(HOSTED_API_HOSTNAME).toBe('api.streampulse.stream')
  })

  it('rejects lookalike hosts and non-https', () => {
    expect(isHostedApiUrl('https://evil.api.streampulse.stream/v1')).toBe(false)
    expect(isHostedApiUrl('https://api.streampulse.stream.evil/v1')).toBe(false)
    expect(isHostedApiUrl('http://api.streampulse.stream/v1')).toBe(false)
    expect(isHostedApiUrl('https://example.com/?u=https://api.streampulse.stream')).toBe(false)
  })
})

describe('textContainsHostedApiOrigin', () => {
  it('matches boundary-aware hosted origin tokens', () => {
    expect(textContainsHostedApiOrigin(`connect-src 'self' ${HOSTED_API_ORIGIN}`)).toBe(true)
    expect(textContainsHostedApiOrigin(`fetch("${HOSTED_API_ORIGIN}/v1/x")`)).toBe(true)
  })

  it('does not match substring host spoofs', () => {
    expect(textContainsHostedApiOrigin('https://evil.api.streampulse.stream/x')).toBe(false)
    expect(textContainsHostedApiOrigin('https://api.streampulse.stream.evil/x')).toBe(false)
  })
})
