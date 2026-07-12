import { describe, expect, it } from 'vitest'
import {
  formatHubTrustLine,
  resolveHubTrustFreshness,
  HUB_TRUST_DELAYED_MS,
  HUB_TRUST_LIVE_MS,
} from '../src/lib/hubTrustLine'

const NOW = 1_700_000_000_000

describe('hubTrustLine', () => {
  it('is live when last poll is recent and healthy', () => {
    expect(
      resolveHubTrustFreshness({
        lastSuccessfulPollAt: NOW - 8_000,
        hubEndpointOk: true,
        hasError: false,
        nowMs: NOW,
      }),
    ).toBe('live')
  })

  it('is delayed when poll age exceeds live window', () => {
    expect(
      resolveHubTrustFreshness({
        lastSuccessfulPollAt: NOW - HUB_TRUST_LIVE_MS - 1_000,
        hubEndpointOk: true,
        hasError: false,
        nowMs: NOW,
      }),
    ).toBe('delayed')
  })

  it('is reconnecting when unhealthy and stale', () => {
    expect(
      resolveHubTrustFreshness({
        lastSuccessfulPollAt: NOW - HUB_TRUST_DELAYED_MS - 1_000,
        hubEndpointOk: false,
        hasError: true,
        nowMs: NOW,
      }),
    ).toBe('reconnecting')
  })

  it('never claims LIVE in reconnecting copy', () => {
    const line = formatHubTrustLine({
      collectorActive: 250,
      collectorMax: 250,
      lastSuccessfulPollAt: NOW - 3 * 60_000,
      freshness: 'reconnecting',
      nowMs: NOW,
    })
    expect(line).toContain('RECONNECTING')
    expect(line).not.toMatch(/\bLIVE\b/)
  })

  it('formats IRC coverage for live trust line', () => {
    const line = formatHubTrustLine({
      collectorActive: 250,
      collectorMax: 250,
      lastSuccessfulPollAt: NOW - 8_000,
      freshness: 'live',
      nowMs: NOW,
    })
    expect(line).toContain('IRC COVERAGE 250/250')
    expect(line).toContain('UPDATED 8S AGO')
    expect(line).toContain('LIVE')
  })
})
