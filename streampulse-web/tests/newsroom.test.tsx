import { describe, expect, it } from 'vitest'
import { normalizeNewsroomEnvelope } from '../src/lib/newsroom'

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
  it.each(['0001-01-01T00:00:00Z', '2099-01-01T00:00:00Z'])('rejects sentinel or future observation times: %s', timestamp => {
    for (const field of ['generatedAt', 'snapshotAt', 'dataThrough']) {
      expect(normalizeNewsroomEnvelope({ ...rawEnvelope(), [field]: timestamp })).toBeNull()
    }
  })
  it('strictly accepts the versioned server-owned story and ignores unknown additions', () => {
    const raw = { ...(rawEnvelope() as Record<string, unknown>), futureField: 'ignored' }
    const envelope = normalizeNewsroomEnvelope(raw)
    expect(envelope?.schemaVersion).toBe(1)
    expect(envelope?.stories[0].leadUpdate.momentRef.publicMomentId).toBe('moment-story-1')
    expect(envelope?.stories[0].leadUpdate.sparkline).toHaveLength(4)
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
  })
})
