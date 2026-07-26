import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clipCandidateCanQueueReplayForge,
  clipCandidateConfidenceLabel,
  clipCandidateInboxLabel,
  clipCandidatePickReason,
  clipCandidateReasonLabel,
  clipCandidateRenderabilityLabel,
  clipJobDisplayStatus,
  fetchClipCandidates,
  refreshClipCandidateReplayForgeJob,
  sendClipCandidateToReplayForge,
  updateClipCandidateState,
  type ClipCandidate,
} from '../src/lib/clipCandidates'
import { setBetaKey } from '../src/lib/auth'

describe('clip candidate API client', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('fetches private candidates through the gated Pulse clips endpoint', async () => {
    await setBetaKey('secret-one')
    const candidate: ClipCandidate = {
      id: 'cc_1',
      login: 'xqc',
      streamId: 'stream-1',
      offsetSeconds: 120,
      startSeconds: 100,
      endSeconds: 160,
      score: 91,
      reason: 'chat_spike',
      sourceKind: 'recap',
      sourceStatus: 'available',
      topEmotes: [{ name: 'KEKW', provider: 'seventv', count: 44 }],
    }
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('X-Streamclone-Beta-Key')).toBe('secret-one')
      return new Response(JSON.stringify({ items: [candidate] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchClipCandidates({ status: 'new', limit: 25 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/v1/pulse/clips')
    expect(url).toContain('status=new')
    expect(url).toContain('limit=25')
    expect(result.items[0]).toMatchObject({ id: 'cc_1', reason: 'chat_spike' })
  })

  it('patches only private review state for a candidate', async () => {
    await setBetaKey('secret-one')
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('PATCH')
      expect(JSON.parse(String(init?.body))).toEqual({ status: 'saved', titleOverride: 'Good bit' })
      return new Response(
        JSON.stringify({
          id: 'ccs_1',
          candidateId: 'cc_1',
          status: 'saved',
          titleOverride: 'Good bit',
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const state = await updateClipCandidateState('cc_1', {
      status: 'saved',
      titleOverride: 'Good bit',
    })

    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/pulse/clips/cc_1')
    expect(state.status).toBe('saved')
  })

  it('sends a candidate to ReplayForge through the gated Pulse endpoint', async () => {
    await setBetaKey('secret-one')
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('X-Streamclone-Beta-Key')).toBe('secret-one')
      expect(init?.method).toBe('POST')
      return new Response(
        JSON.stringify({
          id: 'ccj_1',
          candidateId: 'cc_1',
          status: 'queued',
          replayForgeJobId: 'rf_1',
          replayForgeState: 'queued',
        }),
        { status: 202 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const job = await sendClipCandidateToReplayForge('cc_1')

    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/pulse/clips/cc_1/replayforge')
    expect(job.status).toBe('queued')
    expect(job.replayForgeJobId).toBe('rf_1')
  })

  it('refreshes a ReplayForge job through the gated Pulse endpoint', async () => {
    await setBetaKey('secret-one')
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('X-Streamclone-Beta-Key')).toBe('secret-one')
      expect(init?.method).toBeUndefined()
      return new Response(
        JSON.stringify({
          id: 'ccj_1',
          candidateId: 'cc_1',
          status: 'ready',
          replayForgeJobId: 'rf_1',
          replayForgeState: 'ready',
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const job = await refreshClipCandidateReplayForgeJob('cc_1')

    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/pulse/clips/cc_1/replayforge')
    expect(job.status).toBe('ready')
    expect(job.replayForgeState).toBe('ready')
  })

  it('maps inbox and renderability labels without claiming playback ready', () => {
    expect(clipCandidateInboxLabel('needs_source')).toBe('Needs source')
    expect(clipCandidateInboxLabel('low_confidence')).toBe('Low confidence')
    expect(clipCandidateRenderabilityLabel('worker_ready_unverified')).toBe(
      'Worker ready (playback not verified)',
    )
    expect(clipJobDisplayStatus({
      id: 'ccj_1',
      candidateId: 'cc_1',
      status: 'ready',
    })).toBe('Worker ready (playback not verified)')
    expect(clipCandidateReasonLabel('emote_spike_only')).toBe('Emote spike only')
    expect(clipCandidatePickReason({
      id: 'cc_1',
      login: 'xqc',
      streamId: 'stream-1',
      offsetSeconds: 120,
      startSeconds: 100,
      endSeconds: 160,
      score: 91,
      reason: 'emote_spike',
      pickReason: 'emote_spike_only',
      sourceKind: 'recap',
      sourceStatus: 'available',
    })).toBe('emote_spike_only')
    expect(clipCandidateConfidenceLabel(0.82, 'low')).toBe('Low confidence pick')
    expect(
      clipCandidateCanQueueReplayForge({
        id: 'cc_1',
        login: 'xqc',
        streamId: 'stream-1',
        vodId: 'vod-1',
        offsetSeconds: 120,
        startSeconds: 100,
        endSeconds: 160,
        score: 91,
        reason: 'chat_spike',
        sourceKind: 'recap',
        sourceStatus: 'available',
        renderabilityStatus: 'queueable',
      }),
    ).toBe(true)
    expect(
      clipCandidateCanQueueReplayForge({
        id: 'cc_2',
        login: 'xqc',
        streamId: 'stream-2',
        offsetSeconds: 120,
        startSeconds: 100,
        endSeconds: 160,
        score: 91,
        reason: 'chat_spike',
        sourceKind: 'recap',
        sourceStatus: 'missing',
        renderabilityStatus: 'not_renderable',
      }),
    ).toBe(false)
  })

})
