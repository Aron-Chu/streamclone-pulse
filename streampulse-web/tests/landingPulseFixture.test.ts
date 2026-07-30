import { describe, expect, it } from 'vitest'
import { fixtureEmoteImageUrl } from '../src/ui/components/landing/landingEmoteEnrich.ts'
import {
  LANDING_PAST_VODS,
  LANDING_PULSE_PAYLOAD,
  loadLandingPulseFixture,
} from '../src/ui/components/landing/landingPulseFixture.ts'

describe('landingPulseFixture', () => {
  it('enriches catalog emotes with https CDN URLs', () => {
    for (const emote of LANDING_PULSE_PAYLOAD.topEmotes ?? []) {
      const url = fixtureEmoteImageUrl(emote)
      expect(url, emote.name).toMatch(/^https:\/\//)
    }
  })

  it('populates peaks with moments and emote images', () => {
    expect(LANDING_PULSE_PAYLOAD.peaks.length).toBeGreaterThanOrEqual(8)
    for (const peak of LANDING_PULSE_PAYLOAD.peaks) {
      expect(peak.score).toBeGreaterThan(0)
      expect(peak.topEmotes?.length).toBeGreaterThan(0)
      for (const emote of peak.topEmotes ?? []) {
        const url = fixtureEmoteImageUrl(emote)
        expect(url, `${peak.offsetSeconds}:${emote.name}`).toMatch(/^https:\/\//)
      }
    }
  })

  it('includes past VOD thumbnails', () => {
    for (const row of LANDING_PAST_VODS) {
      expect(row.thumbnailUrl).toMatch(/^https:\/\//)
    }
  })

  it('clones fixture on load', () => {
    const a = loadLandingPulseFixture()
    const b = loadLandingPulseFixture()
    expect(a).not.toBe(b)
    expect(a.login).toBe('xqc')
    expect(a.peaks.length).toBe(LANDING_PULSE_PAYLOAD.peaks.length)
  })

  it('presents the primary landing demo as healthy full-stream tracking', () => {
    expect(LANDING_PULSE_PAYLOAD.coverage?.state).toBe('full_stream_tracked')
    expect(LANDING_PULSE_PAYLOAD.coverage?.coverageStartOffsetSeconds).toBe(0)
    expect(LANDING_PULSE_PAYLOAD.coverage?.hasFullStreamCoverage).toBe(true)
    expect(LANDING_PULSE_PAYLOAD.coverage?.trackedFromStart).toBe(true)
  })
})
