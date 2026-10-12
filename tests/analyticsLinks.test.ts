import { describe, expect, it } from 'vitest'
import {
  buildAnalyticsUrl,
  buildHubAnalyticsUrl,
  defaultWebAnalyticsBaseUrlForApi,
  resolveStreamAnalyticsHref,
  resolveWebAnalyticsHref,
} from '../src/shared/analyticsLinks.ts'

describe('defaultWebAnalyticsBaseUrlForApi', () => {
  it('maps local API to streampulse-web dev port', () => {
    expect(defaultWebAnalyticsBaseUrlForApi('http://localhost:8081')).toBe('http://localhost:5173')
  })

  it('maps hosted API to streampulse.stream', () => {
    expect(defaultWebAnalyticsBaseUrlForApi('https://api.streampulse.stream')).toBe('https://streampulse.stream')
  })
})

describe('buildHubAnalyticsUrl', () => {
  it('returns public hub landing path', () => {
    expect(buildHubAnalyticsUrl('https://streampulse.stream')).toBe('https://streampulse.stream/analytics')
    expect(buildHubAnalyticsUrl('http://localhost:5173/')).toBe('http://localhost:5173/analytics')
  })

  it('returns null for empty base', () => {
    expect(buildHubAnalyticsUrl('')).toBeNull()
    expect(buildHubAnalyticsUrl('   ')).toBeNull()
  })
})

describe('buildAnalyticsUrl', () => {
  const web = 'https://streampulse.stream'

  it('uses canonical web session route with hash offset', () => {
    expect(buildAnalyticsUrl({
      webAnalyticsBaseUrl: web,
      channelLogin: 'xqc',
      streamId: '319abc',
    })).toBe('https://streampulse.stream/analytics/xqc/319abc')
    expect(buildAnalyticsUrl({
      webAnalyticsBaseUrl: web,
      channelLogin: 'xqc',
      streamId: '319abc',
      offsetSeconds: 18840,
    })).toBe('https://streampulse.stream/analytics/xqc/319abc#t=18840')
  })

  it('does not use api origin', () => {
    const href = buildAnalyticsUrl({
      webAnalyticsBaseUrl: web,
      channelLogin: 'xqc',
      streamId: '319abc',
    })
    expect(href).not.toContain('api.streampulse.stream')
    expect(href).not.toContain('localhost:8081')
  })

  it('returns null when channel login missing', () => {
    expect(buildAnalyticsUrl({ webAnalyticsBaseUrl: web, streamId: '319abc' })).toBeNull()
  })

  it('returns null when stream id missing for partial args', () => {
    expect(buildAnalyticsUrl({ webAnalyticsBaseUrl: web, channelLogin: 'xqc' }))
      .toBe('https://streampulse.stream/analytics/xqc')
  })

  it('does not generate undefined routes', () => {
    expect(buildAnalyticsUrl({
      webAnalyticsBaseUrl: web,
      channelLogin: 'xqc',
      streamId: undefined,
    })).toBe('https://streampulse.stream/analytics/xqc')
    expect(buildAnalyticsUrl({
      webAnalyticsBaseUrl: web,
      channelLogin: 'xqc',
      streamId: 'undefined',
    })).toBe('https://streampulse.stream/analytics/xqc/undefined')
  })
})

describe('moment offsets on analytics links', () => {
  const web = 'https://streampulse.stream'

  it('keeps offset 0, the first minute, so a "from stream start" link selects it', () => {
    expect(buildAnalyticsUrl({ webAnalyticsBaseUrl: web, channelLogin: 'xqc', streamId: '319abc', offsetSeconds: 0 }))
      .toBe('https://streampulse.stream/analytics/xqc/319abc#t=0')
    expect(resolveStreamAnalyticsHref({ apiBaseUrl: 'https://api.streampulse.stream', channelLogin: 'xqc', streamId: '319abc', offsetSeconds: 0 }))
      .toBe('https://streampulse.stream/analytics/xqc/319abc#t=0')
  })

  it('opens the stream itself when no offset is given', () => {
    expect(resolveStreamAnalyticsHref({ apiBaseUrl: 'https://api.streampulse.stream', channelLogin: 'xqc', streamId: '319abc', offsetSeconds: undefined }))
      .toBe('https://streampulse.stream/analytics/xqc/319abc')
    expect(buildAnalyticsUrl({ webAnalyticsBaseUrl: web, channelLogin: 'xqc', streamId: '319abc', offsetSeconds: Number.NaN }))
      .toBe('https://streampulse.stream/analytics/xqc/319abc')
    expect(buildAnalyticsUrl({ webAnalyticsBaseUrl: web, channelLogin: 'xqc', streamId: '319abc', offsetSeconds: -5 }))
      .toBe('https://streampulse.stream/analytics/xqc/319abc')
  })

  it('never puts a minute on the channel route, which opens the live or latest stream', () => {
    // Without a stream id the portal picks whichever stream is live or latest,
    // so `#t` would select that minute in a different stream.
    for (const offsetSeconds of [0, 754]) {
      expect(buildAnalyticsUrl({ webAnalyticsBaseUrl: web, channelLogin: 'xqc', offsetSeconds }))
        .toBe('https://streampulse.stream/analytics/xqc')
      expect(buildAnalyticsUrl({ webAnalyticsBaseUrl: web, channelLogin: 'xqc', streamId: '  ', offsetSeconds }))
        .toBe('https://streampulse.stream/analytics/xqc')
      expect(resolveStreamAnalyticsHref({ apiBaseUrl: 'https://api.streampulse.stream', channelLogin: 'xqc', offsetSeconds }))
        .toBe('https://streampulse.stream/analytics/xqc')
    }
  })
})

describe('resolveWebAnalyticsHref', () => {
  it('prefixes relative analytics paths with web origin', () => {
    expect(resolveWebAnalyticsHref(
      'https://streampulse.stream',
      '/analytics/xqc/123',
    )).toBe('https://streampulse.stream/analytics/xqc/123')
    expect(resolveWebAnalyticsHref(
      'https://streampulse.stream',
      '/analytics/xqc/s/123',
    )).toBe('https://streampulse.stream/analytics/xqc/s/123')
  })

  it('rejects non-analytics paths', () => {
    expect(resolveWebAnalyticsHref('https://streampulse.stream', '/v1/extension/health')).toBeNull()
  })

  it('rejects unsafe analytics origins before opening a URL sink', () => {
    expect(resolveWebAnalyticsHref('javascript:alert(1)', '/analytics/xqc/123')).toBeNull()
    expect(resolveWebAnalyticsHref('https://streampulse.stream.evil', '/analytics/xqc/123')).toBeNull()
    expect(buildAnalyticsUrl({
      webAnalyticsBaseUrl: 'https://evil.example',
      channelLogin: 'xqc',
    })).toBeNull()
  })
})

describe('resolveStreamAnalyticsHref', () => {
  it('maps API base to portal analytics route', () => {
    expect(resolveStreamAnalyticsHref({
      apiBaseUrl: 'https://api.streampulse.stream',
      channelLogin: 'xqc',
      streamId: '319abc',
      offsetSeconds: 960,
    })).toBe('https://streampulse.stream/analytics/xqc/319abc#t=960')
  })

  it('never returns an api.streampulse.stream href', () => {
    const href = resolveStreamAnalyticsHref({
      apiBaseUrl: 'https://api.streampulse.stream',
      channelLogin: 'xqc',
      streamId: '319abc',
    })
    expect(href).not.toContain('api.streampulse.stream')
  })
})
