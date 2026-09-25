import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { NewsroomStory } from '../src/lib/newsroom'
import { LeadStoryCard } from '../src/ui/components/newsroom/LeadStoryCard'

const at = Date.now()

function discoveryStory(): NewsroomStory {
  const evidence = {
    ircBound: true,
    eventRollupAvailable: true,
    streamIdentityMatched: true,
    metadataStreamMatched: true,
    baselineMeasuredMinutes: 12,
    baselineExpectedMinutes: 12,
    baselineCoveragePct: 100,
  }
  const metric = {
    state: 'ready' as const,
    currentPerMin: 133,
    baselinePerMin: 32,
    absoluteDeltaPerMin: 101,
    changePct: 315.6,
    multiplier: 4.2,
    currentMeasuredMinutes: 1,
    currentExpectedMinutes: 1,
    baselineMeasuredMinutes: 12,
    baselineExpectedMinutes: 12,
    baselineCoveragePct: 100,
  }
  return {
    id: 'story-xqc',
    login: 'xqc',
    displayName: 'xQc',
    profileImageUrl: 'https://static-cdn.example/xqc.png',
    category: 'Just Chatting',
    streamId: 'stream-1',
    lifecycle: 'confirmed',
    primarySignal: 'emotes',
    headline: 'xQc emote reaction keeps building',
    summary: 'A measured creator moment is holding above the earlier stream baseline.',
    revision: 2,
    createdAt: new Date(at - 120_000).toISOString(),
    lastPublishedAt: new Date(at).toISOString(),
    leadUpdate: {
      id: 'update-1',
      revision: 2,
      detectorEventKey: 'episode-1',
      updateKind: 'lifecycle',
      occurredAt: new Date(at).toISOString(),
      publishedAt: new Date(at).toISOString(),
      signal: 'emotes',
      lifecycle: 'confirmed',
      headline: 'xQc emote reaction keeps building',
      summary: 'Measured emote activity remains elevated.',
      comparison: {
        baselineKind: 'current_stream_measured_average_before_event',
        eventAt: at,
        baselineWindow: { start: at - 720_000, end: at, expectedMinutes: 12, measuredMinutes: 12, coveragePct: 100 },
        chat: { ...metric, currentPerMin: 80 },
        emotes: metric,
        evidence,
      },
      evidence,
      topEmotes: [{ name: 'KEKW', provider: '7TV', count: 80, sharePct: 50 }],
      momentRef: { publicMomentId: 'moment-1', streamId: 'stream-1', occurrenceAt: at, offsetSeconds: 240 },
      notificationEligible: true,
      isLate: false,
      sparkline: [
        { at: at - 120_000, currentPerMin: 32, baselinePerMin: 32 },
        { at: at - 60_000, currentPerMin: 78, baselinePerMin: 32 },
        { at, currentPerMin: 133, baselinePerMin: 32 },
      ],
    },
  }
}

describe('Newsroom visual discovery cards', () => {
  it('connects a featured story to its creator and uses only the supplied measured visual', () => {
    const story = discoveryStory()
    const { container } = render(<MemoryRouter><LeadStoryCard story={story} display="feature" headingLevel={2} /></MemoryRouter>)

    expect(screen.getByRole('link', { name: 'Open xQc analytics' }).getAttribute('href')).toBe('/analytics/xqc')
    expect(screen.getByRole('link', { name: 'xQc' }).getAttribute('href')).toBe('/analytics/xqc')
    expect(screen.getByLabelText('Primary measured fact').textContent).toContain('133/min')
    expect(screen.getByLabelText('Primary measured fact').textContent).toContain('Emotes at this moment')
    expect(screen.getByLabelText('Primary measured fact').textContent).not.toMatch(/\bnow\b/i)
    expect(screen.getByRole('img', { name: /emotes trend over 3 measured minutes/i })).toBeTruthy()
    expect(container.querySelector('.newsroom-lead--feature')).toBeTruthy()
    expect(container.querySelector('.newsroom-lead__comparisons')).toBeNull()
  })

  it('keeps a secondary tile compact while retaining creator, primary fact, and real sparkline', () => {
    const story = discoveryStory()
    const { container } = render(<MemoryRouter><LeadStoryCard story={story} display="tile" /></MemoryRouter>)

    expect(container.querySelector('.newsroom-lead--tile')).toBeTruthy()
    expect(screen.queryByText(story.summary)).toBeNull()
    expect(screen.getByLabelText('Primary measured fact').textContent).toContain('Earlier 32/min')
    expect(container.querySelector('.newsroom-sparkline--compact')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View story' }).getAttribute('href')).toBe('/analytics/newsroom/story-xqc')
  })

  it('names the selected unit for a mixed signal instead of claiming generic activity', () => {
    const story = discoveryStory()
    story.primarySignal = 'mixed'
    story.leadUpdate.comparison.chat = { ...story.leadUpdate.comparison.chat, multiplier: 5 }
    render(<MemoryRouter><LeadStoryCard story={story} display="tile" /></MemoryRouter>)
    expect(screen.getByLabelText('Primary measured fact').textContent).toContain('Chat at this moment')
    expect(screen.getByLabelText('Primary measured fact').textContent).not.toContain('Leading activity')
  })
  it('shows real emote counts without inventing an unprovided share denominator', () => {
    const story = discoveryStory()
    story.leadUpdate.sparkline = []
    render(<MemoryRouter><LeadStoryCard story={story} display="feature" /></MemoryRouter>)
    expect(screen.getByLabelText('Top measured emotes').textContent).toContain('80 measured')
    expect(screen.getByLabelText('Top measured emotes').textContent).not.toContain('%')
  })
})
