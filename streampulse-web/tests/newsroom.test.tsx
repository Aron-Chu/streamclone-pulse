import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import {
  newsroomDataThroughAge,
  newsroomReasonCopy,
  newsroomWatchAction,
  normalizeNewsroomEnvelope,
  type NewsroomEnvelope,
  type NewsroomStory,
} from '../src/lib/newsroom'
import { ActivityContextRail } from '../src/ui/components/analytics/ActivityContextRail'
import { LiveDeskRail } from '../src/ui/components/newsroom/LiveDeskRail'
import { StoryComparison, StoryComparisonTimeline } from '../src/ui/components/newsroom/StoryComparison'
import { StorySparkline } from '../src/ui/components/newsroom/StorySparkline'
import { StorySourceBadges, StorySources } from '../src/ui/components/newsroom/StorySources'
import { StoryTimeline } from '../src/ui/components/newsroom/StoryTimeline'

const eventAt = Date.UTC(2026, 7, 27, 12, 40, 30)
const baselineEnd = Math.floor(eventAt / 60_000) * 60_000

function comparison() {
  const metric = {
    state: 'ready',
    currentPerMin: 120,
    baselinePerMin: 40,
    absoluteDeltaPerMin: 80,
    changePct: 200,
    multiplier: 3,
    currentMeasuredMinutes: 1,
    currentExpectedMinutes: 1,
    baselineMeasuredMinutes: 20,
    baselineExpectedMinutes: 20,
    baselineCoveragePct: 100,
  }
  return {
    baselineKind: 'current_stream_measured_average_before_event',
    eventAt,
    baselineWindow: {
      start: baselineEnd - 20 * 60_000,
      end: baselineEnd,
      expectedMinutes: 20,
      measuredMinutes: 20,
      coveragePct: 100,
    },
    chat: metric,
    emotes: { ...metric, currentPerMin: 80, baselinePerMin: 20, multiplier: 4 },
    evidence: {
      ircBound: true,
      eventRollupAvailable: true,
      streamIdentityMatched: true,
      rollupChatSource: 'irc',
      rollupSourceConfidence: 'verified',
      rollupSourceDetail: 'closed minute IRC rollup',
      metadataStreamMatched: true,
      metadataSampledAt: eventAt - 30_000,
      baselineMeasuredMinutes: 20,
      baselineExpectedMinutes: 20,
      baselineCoveragePct: 100,
    },
  }
}

function rawStory(id = 'story-1', login = 'xqc') {
  return {
    id,
    login,
    displayName: login === 'xqc' ? 'xQc' : login,
    category: 'Just Chatting',
    streamId: `stream-${id}`,
    lifecycle: 'confirmed',
    primarySignal: 'emotes',
    headline: `${login} emote reaction keeps building`,
    summary: 'A second measured emote episode confirmed the developing story.',
    revision: 2,
    createdAt: new Date(eventAt - 5 * 60_000).toISOString(),
    lastPublishedAt: new Date(eventAt).toISOString(),
    leadUpdate: {
      id: `update-${id}`,
      revision: 2,
      detectorEventKey: `episode-${id}`,
      updateKind: 'lifecycle',
      occurredAt: new Date(eventAt).toISOString(),
      publishedAt: new Date(eventAt + 1_000).toISOString(),
      signal: 'emotes',
      lifecycle: 'confirmed',
      headline: `${login} emote reaction keeps building`,
      summary: 'The stream registered another material episode.',
      comparison: comparison(),
      evidence: comparison().evidence,
      topEmotes: [{ name: 'KEKW', provider: '7TV', count: 80, sharePct: 50 }],
      momentRef: {
        publicMomentId: `moment-${id}`,
        streamId: `stream-${id}`,
        occurrenceAt: eventAt,
        offsetSeconds: 240,
      },
      notificationEligible: true,
      isLate: false,
      sparkline: [
        { at: eventAt - 3 * 60_000, currentPerMin: 20, baselinePerMin: 20 },
        { at: eventAt - 2 * 60_000, currentPerMin: 35, baselinePerMin: 20 },
        { at: eventAt - 60_000, currentPerMin: 80, baselinePerMin: 20 },
        { at: eventAt, currentPerMin: 120, baselinePerMin: 20 },
      ],
    },
  }
}

function rawEnvelope(): Record<string, any> {
  return {
    schemaVersion: 1,
    status: 'ready',
    generatedAt: new Date(eventAt + 2_000).toISOString(),
    dataThrough: new Date(eventAt).toISOString(),
    snapshotAt: new Date(eventAt + 2_000).toISOString(),
    window: 'live',
    leadStoryId: 'story-1',
    stories: [rawStory()],
    networkBrief: {
      currentStart: new Date(eventAt - 30 * 60_000).toISOString(),
      currentEnd: new Date(eventAt).toISOString(),
      baselineStart: new Date(eventAt - 60 * 60_000).toISOString(),
      baselineEnd: new Date(eventAt - 30 * 60_000).toISOString(),
      comparableChannels: 42,
      coveragePct: 95,
      chatChangePct: 18,
      emoteChangePct: 31,
    },
  }
}

describe('Pulse Newsroom contract', () => {
  it('strictly accepts the versioned server-owned story and ignores unknown additions', () => {
    const raw = { ...(rawEnvelope() as Record<string, unknown>), futureField: 'ignored' }
    const envelope = normalizeNewsroomEnvelope(raw)
    expect(envelope?.schemaVersion).toBe(1)
    expect(envelope?.stories[0].leadUpdate.momentRef.publicMomentId).toBe('moment-story-1')
    expect(envelope?.stories[0].leadUpdate.sparkline).toHaveLength(4)
    expect(envelope?.stories[0].sources).toEqual([])
  })

  it('accepts allowlisted external corroboration without folding it into reaction evidence', () => {
    const raw = rawEnvelope() as any
    raw.stories[0].sources = [
      {
        id: 'clip-1',
        source: 'twitch_clip',
        kind: 'clip',
        url: 'https://clips.twitch.tv/VerifiedClip',
        title: 'Public Twitch clip',
        author: 'clipper',
        occurredAt: new Date(eventAt).toISOString(),
        metrics: { views: 1200, unsupported: 99 },
        matchConfidence: 0.91,
        reliabilityWeight: 1,
      },
      {
        id: 'reddit-1',
        source: 'reddit',
        kind: 'post',
        url: 'https://www.reddit.com/r/LivestreamFail/comments/abc/story/',
        metrics: { score: 420, comments: 38 },
      },
    ]
    const story = normalizeNewsroomEnvelope(raw)?.stories[0]
    expect(story?.sources).toHaveLength(2)
    expect(story?.sources[0].metrics).toEqual({ views: 1200 })
    expect(story?.leadUpdate.comparison.emotes.multiplier).toBe(4)
  })

  it('fails closed for unsafe or source-spoofed external links', () => {
    for (const url of [
      'javascript:alert(1)',
      'https://clips.twitch.tv.example.com/spoof',
      'https://example.com/r/LivestreamFail/comments/abc/story/',
    ]) {
      const raw = rawEnvelope() as any
      raw.stories[0].sources = [{ id: 'unsafe', source: url.includes('reddit') ? 'reddit' : 'twitch_clip', kind: 'post', url, metrics: {} }]
      expect(normalizeNewsroomEnvelope(raw)).toBeNull()
    }
  })

  it('rejects an unbounded external-source list', () => {
    const raw = rawEnvelope() as any
    raw.stories[0].sources = Array.from({ length: 5 }, (_, index) => ({
      id: `clip-${index}`,
      source: 'twitch_clip',
      kind: 'clip',
      url: `https://clips.twitch.tv/VerifiedClip${index}`,
      metrics: {},
    }))
    expect(normalizeNewsroomEnvelope(raw)).toBeNull()
  })

  it('fails the entire response closed when comparison evidence or moment identity is malformed', () => {
    const raw = rawEnvelope() as any
    raw.stories[0].leadUpdate.comparison.evidence.baselineCoveragePct = 79
    expect(normalizeNewsroomEnvelope(raw)).toBeNull()
    const wrongStream = rawEnvelope() as any
    wrongStream.stories[0].leadUpdate.momentRef.streamId = 'another-stream'
    expect(normalizeNewsroomEnvelope(wrongStream)).toBeNull()
  })

  it('rejects out-of-order sparkline points instead of connecting a false trend', () => {
    const raw = rawEnvelope() as any
    raw.stories[0].leadUpdate.sparkline.reverse()
    expect(normalizeNewsroomEnvelope(raw)).toBeNull()
  })

  it('requires a real writer watermark for every versioned status', () => {
    const healthyWithoutWatermark = rawEnvelope() as Record<string, unknown>
    delete healthyWithoutWatermark.dataThrough
    expect(normalizeNewsroomEnvelope(healthyWithoutWatermark)).toBeNull()

    const unavailable: Record<string, unknown> = {
      ...rawEnvelope(),
      status: 'unavailable',
      stories: [],
      leadStoryId: undefined,
      reason: 'reads_disabled',
    }
    delete unavailable.dataThrough
    expect(normalizeNewsroomEnvelope(unavailable)).toBeNull()
    expect(normalizeNewsroomEnvelope({
      ...unavailable,
      dataThrough: rawEnvelope().dataThrough,
    })?.status).toBe('unavailable')
  })

  it('reports stale age from the writer watermark without inventing freshness', () => {
    expect(newsroomDataThroughAge(new Date(eventAt).toISOString(), eventAt + 5 * 60_000)).toBe('Data through 5m ago.')
    expect(newsroomDataThroughAge(undefined, eventAt)).toBeNull()
    expect(newsroomReasonCopy('reads_disabled')).toBe('Pulse Newsroom is not enabled for this API release yet.')
    expect(newsroomReasonCopy('404 page not found')).not.toContain('404')
  })

  it('accepts the detail envelope with an empty list and a matching lead story', () => {
    const detail = {
      ...rawEnvelope(),
      stories: [],
      story: rawStory(),
      updates: [rawStory().leadUpdate],
    }
    const normalized = normalizeNewsroomEnvelope(detail)
    expect(normalized?.stories).toEqual([])
    expect(normalized?.story?.id).toBe('story-1')
    expect(normalized?.leadStoryId).toBe('story-1')
    expect(normalizeNewsroomEnvelope({ ...detail, leadStoryId: 'another-story' })).toBeNull()
  })

  it('accepts a late correction revision without replacing or reordering the non-late lead', () => {
    const leadStory = rawStory()
    const correction = {
      ...leadStory.leadUpdate,
      id: 'correction-3',
      revision: 3,
      detectorEventKey: 'episode-story-1-correction',
      updateKind: 'correction',
      isLate: true,
      notificationEligible: false,
      occurredAt: new Date(eventAt - 2 * 60_000).toISOString(),
      publishedAt: new Date(eventAt + 3_000).toISOString(),
      comparison: {
        ...leadStory.leadUpdate.comparison,
        eventAt: eventAt - 2 * 60_000,
        baselineWindow: {
          ...leadStory.leadUpdate.comparison.baselineWindow,
          start: leadStory.leadUpdate.comparison.baselineWindow.start - 2 * 60_000,
          end: leadStory.leadUpdate.comparison.baselineWindow.end - 2 * 60_000,
        },
      },
      momentRef: { ...leadStory.leadUpdate.momentRef, occurrenceAt: eventAt - 2 * 60_000 },
    }
    const storyWithCorrection = { ...leadStory, revision: 3 }
    const detail = normalizeNewsroomEnvelope({
      ...rawEnvelope(),
      leadStoryId: storyWithCorrection.id,
      stories: [],
      story: storyWithCorrection,
      updates: [leadStory.leadUpdate, correction],
    })
    expect(detail?.story?.revision).toBe(3)
    expect(detail?.story?.leadUpdate.id).toBe(leadStory.leadUpdate.id)
    expect(detail?.updates?.find((update) => update.id === 'correction-3')?.isLate).toBe(true)
  })

  it('accepts a stream-ended lifecycle update with an explicit unavailable comparison', () => {
    const terminal: any = rawStory()
    const unavailableEvidence: any = {
      ircBound: false,
      eventRollupAvailable: false,
      streamIdentityMatched: true,
      metadataStreamMatched: false,
      baselineMeasuredMinutes: 0,
      baselineExpectedMinutes: 0,
      baselineCoveragePct: 0,
    }
    const unavailableMetric: any = {
      ...terminal.leadUpdate.comparison.chat,
      state: 'unavailable',
      reason: 'stream_ended',
      currentPerMin: undefined,
      baselinePerMin: undefined,
      absoluteDeltaPerMin: undefined,
      changePct: undefined,
      multiplier: undefined,
      currentMeasuredMinutes: 0,
      currentExpectedMinutes: 1,
      baselineMeasuredMinutes: 0,
      baselineExpectedMinutes: 0,
      baselineCoveragePct: 0,
    }
    terminal.lifecycle = 'resolved'
    terminal.resolvedReason = 'stream_ended'
    terminal.resolvedAt = new Date(eventAt + 60_000).toISOString()
    terminal.leadUpdate = {
      ...terminal.leadUpdate,
      updateKind: 'lifecycle',
      lifecycle: 'resolved',
      resolvedReason: 'stream_ended',
      resolvedAt: terminal.resolvedAt,
      vodId: '987654321',
      evidence: unavailableEvidence,
      comparison: {
        ...terminal.leadUpdate.comparison,
        evidence: unavailableEvidence,
        baselineWindow: {
          start: baselineEnd,
          end: baselineEnd,
          expectedMinutes: 0,
          measuredMinutes: 0,
          coveragePct: 0,
        },
        chat: unavailableMetric,
        emotes: unavailableMetric,
      },
    }
    const normalized = normalizeNewsroomEnvelope({
      ...rawEnvelope(),
      leadStoryId: terminal.id,
      stories: [terminal],
    })
    expect(normalized?.stories[0].resolvedReason).toBe('stream_ended')
    expect(normalized?.stories[0].leadUpdate.comparison.chat.state).toBe('unavailable')
    expect(newsroomWatchAction(normalized!.stories[0])?.label).toBe('Watch VOD')
  })
})

describe('Pulse Newsroom components', () => {
  it('presents external coverage as labeled corroboration with safe public links', () => {
    const story = rawStory() as any
    story.sources = [
      {
        id: 'clip-1',
        source: 'twitch_clip',
        kind: 'clip',
        url: 'https://clips.twitch.tv/VerifiedClip',
        title: 'The reaction that set chat off',
        author: 'clipper',
        occurredAt: new Date(eventAt).toISOString(),
        metrics: { views: 18000 },
      },
      {
        id: 'reddit-1',
        source: 'reddit',
        kind: 'post',
        url: 'https://www.reddit.com/r/LivestreamFail/comments/abc/story/',
        title: 'LSF discussion follows the same moment',
        metrics: { score: 420, comments: 38 },
      },
    ]
    const normalized = normalizeNewsroomEnvelope({ ...rawEnvelope(), stories: [story] })!.stories[0]
    const { rerender } = render(<StorySourceBadges sources={normalized.sources} />)
    expect(screen.getByLabelText('External coverage sources').textContent).toContain('Twitch clip')
    expect(screen.getByLabelText('External coverage sources').textContent).toContain('LSF / Reddit')

    rerender(<StorySources sources={normalized.sources} />)
    expect(screen.getByText(/does not change its StreamPulse reaction score/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /The reaction that set chat off/i }).getAttribute('href')).toBe('https://clips.twitch.tv/VerifiedClip')
    expect(screen.getByText('18K views')).toBeTruthy()
  })

  it('switches the shared activity rail from Live Wire to preview and locked inspector states', () => {
    const onClear = vi.fn()
    const { container, rerender } = render(
      <ActivityContextRail mode="idle" idle={<div>Live Wire content</div>} inspector={<div>Bucket inspector</div>} onClear={onClear} />,
    )
    expect(container.querySelector('.activity-context-rail')?.getAttribute('data-activity-rail-view')).toBe('idle')
    expect(container.querySelector('.activity-context-rail__pane--wire')?.hasAttribute('aria-hidden')).toBe(false)
    expect(container.querySelector('.activity-context-rail__pane--inspector')?.getAttribute('aria-hidden')).toBe('true')

    rerender(<ActivityContextRail mode="preview" idle={<div>Live Wire content</div>} inspector={<div>Bucket inspector</div>} onClear={onClear} />)
    expect(container.querySelector('.activity-context-rail')?.getAttribute('data-activity-rail-view')).toBe('preview')
    expect(screen.queryByRole('button', { name: 'Back to Live Wire' })).toBeNull()

    rerender(<ActivityContextRail mode="locked" idle={<div>Live Wire content</div>} inspector={<div>Bucket inspector</div>} onClear={onClear} />)
    const back = screen.getByRole('button', { name: 'Back to Live Wire' })
    expect(document.activeElement).toBe(back)
    fireEvent.click(back)
    expect(onClear).toHaveBeenCalledOnce()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClear).toHaveBeenCalledTimes(2)
  })

  it('caps the compact desk at one lead and two secondary headlines with no score', () => {
    const base = normalizeNewsroomEnvelope(rawEnvelope())!
    const stories = [
      base.stories[0],
      normalizeNewsroomEnvelope({ ...rawEnvelope(), leadStoryId: 'story-2', stories: [rawStory('story-2', 'soda')] })!.stories[0],
      normalizeNewsroomEnvelope({ ...rawEnvelope(), leadStoryId: 'story-3', stories: [rawStory('story-3', 'maya')] })!.stories[0],
      normalizeNewsroomEnvelope({ ...rawEnvelope(), leadStoryId: 'story-4', stories: [rawStory('story-4', 'nick')] })!.stories[0],
    ]
    const data: NewsroomEnvelope = { ...base, leadStoryId: stories[0].id, stories }
    render(<MemoryRouter><LiveDeskRail data={data} loading={false} onSelectStory={vi.fn()} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: stories[0].headline })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /emote reaction keeps building/i })).toHaveLength(2)
    expect(screen.queryByText(/\/100/)).toBeNull()
  })

  it('does not claim a verified IRC rollup when terminal evidence is unavailable', () => {
    const active = normalizeNewsroomEnvelope(rawEnvelope())!.stories[0]
    const evidence = {
      ircBound: false,
      eventRollupAvailable: false,
      streamIdentityMatched: true,
      metadataStreamMatched: false,
      baselineMeasuredMinutes: 0,
      baselineExpectedMinutes: 0,
      baselineCoveragePct: 0,
    }
    const terminal: NewsroomStory = {
      ...active,
      lifecycle: 'resolved',
      resolvedReason: 'stream_ended',
      resolvedAt: new Date(eventAt + 60_000).toISOString(),
      leadUpdate: {
        ...active.leadUpdate,
        lifecycle: 'resolved',
        evidence,
        comparison: { ...active.leadUpdate.comparison, evidence },
      },
    }
    render(<MemoryRouter><LiveDeskRail data={{ ...normalizeNewsroomEnvelope(rawEnvelope())!, stories: [terminal], leadStoryId: terminal.id }} loading={false} onSelectStory={vi.fn()} /></MemoryRouter>)
    expect(screen.getByText(/Stream ended · event rollup unavailable/i)).toBeTruthy()
    expect(screen.queryByText(/Verified IRC rollup/i)).toBeNull()
  })

  it('does not render a ratio track for new activity and breaks sparkline gaps', () => {
    const metric = { ...comparison().emotes, state: 'new_activity' as const, baselinePerMin: 0, multiplier: undefined }
    const { container } = render(<StoryComparison label="Emotes" metric={metric} />)
    expect(screen.getByText('New activity · 0/min earlier')).toBeTruthy()
    expect(container.querySelector('.newsroom-comparison__track')).toBeNull()

    const spark = render(<StorySparkline signal="emotes" points={[
      { at: eventAt - 5 * 60_000, currentPerMin: 10 },
      { at: eventAt - 4 * 60_000, currentPerMin: 20 },
      { at: eventAt - 60_000, currentPerMin: 30 },
      { at: eventAt, currentPerMin: 40 },
    ]} />)
    expect(spark.container.querySelectorAll('.newsroom-sparkline__current')).toHaveLength(2)
  })

  it('breaks the dashed baseline at missing baseline samples', () => {
    const spark = render(<StorySparkline signal="chat" points={[
      { at: eventAt - 5 * 60_000, currentPerMin: 10, baselinePerMin: 12 },
      { at: eventAt - 4 * 60_000, currentPerMin: 20, baselinePerMin: 12 },
      { at: eventAt - 3 * 60_000, currentPerMin: 24 },
      { at: eventAt - 2 * 60_000, currentPerMin: 30 },
      { at: eventAt - 60_000, currentPerMin: 35, baselinePerMin: 12 },
      { at: eventAt, currentPerMin: 40, baselinePerMin: 12 },
    ]} />)
    expect(spark.container.querySelectorAll('.newsroom-sparkline__current')).toHaveLength(1)
    expect(spark.container.querySelectorAll('.newsroom-sparkline__baseline')).toHaveLength(2)
  })

  it('renders stacked chat and emote ratios on one event-time axis and omits new-activity ratios', () => {
    const story = normalizeNewsroomEnvelope(rawEnvelope())!.stories[0]
    const ready = story.leadUpdate
    const newActivity = {
      ...ready,
      id: 'update-new',
      revision: 1,
      occurredAt: new Date(eventAt - 60_000).toISOString(),
      publishedAt: new Date(eventAt - 59_000).toISOString(),
      comparison: {
        ...ready.comparison,
        eventAt: eventAt - 60_000,
        chat: { ...ready.comparison.chat, state: 'new_activity' as const, baselinePerMin: 0, multiplier: undefined },
        emotes: { ...ready.comparison.emotes, state: 'new_activity' as const, baselinePerMin: 0, multiplier: undefined },
      },
      momentRef: { ...ready.momentRef, occurrenceAt: eventAt - 60_000 },
    }
    const { container } = render(<StoryComparisonTimeline updates={[newActivity, ready]} />)
    expect(screen.getByRole('heading', { name: /Activity compared with earlier/i })).toBeTruthy()
    expect(screen.getByRole('img', { name: /Chat comparison timeline/i })).toBeTruthy()
    expect(screen.getByRole('img', { name: /Emotes comparison timeline/i })).toBeTruthy()
    expect(screen.getByText(/1 new-activity update shown without a ratio/i)).toBeTruthy()
    expect(container.querySelectorAll('.newsroom-ratio-timeline__point')).toHaveLength(2)
    expect(screen.getByText('Shared event-time axis')).toBeTruthy()
  })

  it('shows raw server rates for new activity and keeps same-minute corrections distinct', () => {
    const ready = normalizeNewsroomEnvelope(rawEnvelope())!.stories[0].leadUpdate
    const newActivity = {
      ...ready,
      id: 'update-new-activity',
      revision: 1,
      comparison: {
        ...ready.comparison,
        chat: { ...ready.comparison.chat, state: 'new_activity' as const, currentPerMin: 120, baselinePerMin: 0, multiplier: undefined },
        emotes: { ...ready.comparison.emotes, state: 'new_activity' as const, currentPerMin: 80, baselinePerMin: 0, multiplier: undefined },
      },
    }
    render(<StoryTimeline updates={[newActivity]} primarySignal="mixed" />)
    expect(screen.getByText('120/min')).toBeTruthy()
    expect(screen.getByText('80/min')).toBeTruthy()
    expect(screen.getAllByText('New activity · 0/min earlier')).toHaveLength(2)

    const correction = { ...ready, id: 'update-correction-same-minute', updateKind: 'correction' as const, revision: 2, isLate: true }
    const chart = render(<StoryComparisonTimeline updates={[ready, correction]} />)
    expect(chart.container.querySelectorAll('[data-update-id="update-story-1"]')).toHaveLength(2)
    expect(chart.container.querySelectorAll('[data-update-id="update-correction-same-minute"]')).toHaveLength(2)
  })

  it('keeps a stale zero-story desk stale rather than calling it quiet or live', () => {
    const base = normalizeNewsroomEnvelope(rawEnvelope())!
    const stale: NewsroomEnvelope = {
      ...base,
      status: 'stale',
      stories: [],
      leadStoryId: undefined,
      reason: 'refresh_unavailable',
    }
    render(<MemoryRouter><LiveDeskRail data={stale} loading={false} onSelectStory={vi.fn()} /></MemoryRouter>)
    expect(screen.getByText('Stale', { exact: true })).toBeTruthy()
    expect(screen.getByText(/Data through/i)).toBeTruthy()
    expect(screen.queryByText('Quiet now')).toBeNull()
    expect(screen.queryByText('Live', { exact: true })).toBeNull()
  })

  it('derives Watch destinations from stream resolution truth', () => {
    const active = normalizeNewsroomEnvelope(rawEnvelope())!.stories[0]
    expect(newsroomWatchAction(active)).toEqual({ href: 'https://www.twitch.tv/xqc', label: 'Watch live' })

    const resolved = (reason: 'quiet_30m' | 'stream_ended' | 'administrative', vodId?: string): NewsroomStory => ({
      ...active,
      lifecycle: 'resolved',
      resolvedReason: reason,
      resolvedAt: new Date(eventAt + 30 * 60_000).toISOString(),
      leadUpdate: { ...active.leadUpdate, lifecycle: 'resolved', vodId },
    })
    expect(newsroomWatchAction(resolved('quiet_30m'))).toEqual({ href: 'https://www.twitch.tv/xqc', label: 'Watch live' })
    expect(newsroomWatchAction(resolved('stream_ended', '12345'))).toEqual({ href: 'https://www.twitch.tv/videos/12345?t=240s', label: 'Watch VOD' })
    expect(newsroomWatchAction(resolved('stream_ended'))).toBeNull()
    expect(newsroomWatchAction(resolved('administrative'))).toBeNull()
  })
})
