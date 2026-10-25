import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PulseLiveUnavailablePanel } from '../src/ui/PulseLiveUnavailablePanel.tsx'
import { PulseNotTrackedPanel } from '../src/ui/PulseNotTrackedPanel.tsx'
import { PulseRosterUnsupportedPanel } from '../src/ui/PulseRosterUnsupportedPanel.tsx'
import { coverageCardCopy } from '../src/ui/missedMoments.ts'
import type { PulseCoverage } from '../src/shared/messages.ts'

/**
 * Cards a viewer sees when Pulse can't chart a stream, or joined it late. They
 * say what is missing in plain words: no pipeline terms (IRC pool, rollups,
 * roster, DVR) and, on the own-stack card, nothing about the hosted pool.
 */
const JARGON = /\bIRC\b|rollup|roster|sampler|\bDVR\b|VOD archive/i

function text(element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(element).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function lateCoverage(overrides: Partial<PulseCoverage> = {}): PulseCoverage {
  return {
    state: 'partial_tracking',
    coverageStartOffsetSeconds: 720,
    coverageEndOffsetSeconds: 3600,
    hasFullStreamCoverage: false,
    hasGaps: true,
    missingRanges: [{ fromOffsetSeconds: 0, toOffsetSeconds: 720 }],
    canBackfill: true,
    ...overrides,
  }
}

describe('viewer copy on the not-charting cards', () => {
  it('hosted not tracked: plain body and the live spots in use', () => {
    const counted = text(createElement(PulseNotTrackedPanel, { login: 'xqc', hostedActiveCount: 412, hostedActiveLimit: 500 }))
    expect(counted).toContain('StreamPulse isn’t reading xqc’s chat right now, so there’s no live chart.')
    expect(counted).toContain('412 of 500 live spots in use')
    const limitOnly = text(createElement(PulseNotTrackedPanel, { login: 'xqc', hostedActiveCount: null, hostedActiveLimit: 500 }))
    expect(limitOnly).toContain('Up to 500 live spots')
    expect(`${counted} ${limitOnly}`).not.toMatch(JARGON)
  })

  it('not on the tracked list', () => {
    const card = text(createElement(PulseRosterUnsupportedPanel, { login: 'xqc' }))
    expect(card).toMatch(/^Not on the tracked list/i)
    expect(card).toContain('Check back later.')
    expect(card).not.toMatch(JARGON)
  })

  it('own stack: says your stack is not reading the channel, and nothing about the hosted pool', () => {
    const card = text(createElement(PulseLiveUnavailablePanel, {
      variant: 'not_irc_tracked',
      login: 'xqc',
      coverageStartOffsetSeconds: 0,
      hostedActiveCount: 412,
      hostedActiveLimit: 500,
      onOpenSettings: () => {},
    }))
    expect(card).toMatch(/^Not tracked live/i)
    expect(card).toContain('xqc is live, but your StreamPulse stack isn’t reading this channel’s chat, so there’s no chart or moments here.')
    expect(card).toContain('Extension settings')
    expect(card).not.toMatch(/Hosted|412|500/)
    expect(card).not.toMatch(JARGON)
  })

  it('joined late: the replay fills the start, "From stream start" only moves the player', () => {
    const waiting = coverageCardCopy({ coverage: lateCoverage({ state: 'waiting_for_vod' }), isLive: true })
    expect(waiting).toEqual({
      title: 'Partial coverage',
      body: 'Live tracking from 00:12:00 → now',
      detail: 'Chat before 00:12:00 comes from the Twitch replay once it’s linked. “From stream start” only moves the player; it doesn’t fill the chart.',
    })
    const backfill = coverageCardCopy({ coverage: lateCoverage(), vodId: '2797507897', isLive: true })
    expect(backfill?.detail).toBe('Missing first 12:00 — loads chat from the Twitch replay.')
    expect(`${waiting?.body} ${waiting?.detail} ${backfill?.detail}`).not.toMatch(JARGON)
  })
})
