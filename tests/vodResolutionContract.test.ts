import { describe, expect, it } from 'vitest'
import {
  normalizeVodPulseHttpResponse,
  resolveVodPulseState,
} from '../src/vod/normalizeVodPulseFetch.ts'
import { vodPulseToChannelPayload } from '../src/vod/vodPulseToChannelPayload.ts'
import type { LiveDvrExtensionVodPulseResponse } from '../src/types/vodPulseTypes.ts'
import { resolvePulseLiveAccess, pulseLiveAccessAllowsChart } from '../src/ui/resolvePulseLiveAccess.ts'
import { resolveJumpMomentAction } from '../src/ui/jumpMomentAction.ts'

const liveResponse = (): LiveDvrExtensionVodPulseResponse => ({
  mode: 'live_dvr',
  vodId: null,
  provisional: true,
  resolutionState: 'live_stream_validated',
  retryable: true,
  streamId: '319652365022',
  login: 'xqc',
  channelLogin: 'xqc',
  isLive: true,
  tracking: true,
  currentOffsetSeconds: 1_200,
  startedAt: '2026-08-04T10:00:00.000Z',
  rollups: [
    { offsetSeconds: 1_140, chatCount: 42, sevenTvEmoteCount: 8 },
  ],
  lanes: { composite: [42], chat: [42], seventv: [8] },
  peaks: [{ offsetSeconds: 1_140, score: 9, reasons: ['chat_spike'], dominantSignal: 'chat' }],
  coverage: {
    state: 'live',
    coverageStartOffsetSeconds: 180,
    coverageEndOffsetSeconds: 1_200,
    hasFullStreamCoverage: false,
    hasGaps: true,
    canBackfill: false,
    missingRanges: [{ fromOffsetSeconds: 0, toOffsetSeconds: 120 }],
    message: 'Live IRC is available from 03:00.',
  },
  rosterEligible: true,
  top500Eligible: true,
})

function responseForHttp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...liveResponse(), ...overrides }
}

describe('live DVR VOD-resolution contract', () => {
  it('keeps archive-not-visible pending and leaves the route candidate untrusted', async () => {
    const response = await normalizeVodPulseHttpResponse(
      '2806037629',
      new Response(JSON.stringify({
        error: 'live_archive_not_visible',
        resolutionState: 'live_archive_not_visible',
        retryable: true,
      }), { status: 404 }),
    )

    expect(response).toMatchObject({
      mode: 'vod',
      vodId: null,
      resolutionState: 'live_archive_not_visible',
      retryable: true,
      coverageStatus: 'syncing',
    })
    expect(response.coverageMessage).toBe('Archive not verified yet. Twitch may still be publishing it.')
    expect(resolveVodPulseState(response).status).toBe('syncing')
  })

  it('keeps provider-unavailable pending and leaves the route candidate untrusted', async () => {
    const response = await normalizeVodPulseHttpResponse(
      '2806037629',
      new Response(JSON.stringify({
        error: 'live_archive_provider_unavailable',
        resolutionState: 'live_archive_provider_unavailable',
        retryable: true,
      }), { status: 503 }),
    )

    expect(response).toMatchObject({
      mode: 'vod',
      vodId: null,
      resolutionState: 'live_archive_provider_unavailable',
      retryable: true,
      coverageStatus: 'syncing',
    })
    expect(response.coverageMessage).toBe('Archive verification is temporarily unavailable. Live analytics are unaffected.')
    expect(resolveVodPulseState(response).status).toBe('syncing')
  })

  it('keeps an unmatched live-stream identity pending instead of reporting a missing VOD', async () => {
    const response = await normalizeVodPulseHttpResponse(
      '2806037629',
      new Response(JSON.stringify({
        error: 'live_stream_identity_not_found',
        mode: 'vod',
        vodId: null,
        streamId: '319652365022',
        resolutionState: 'live_stream_pending',
        retryable: true,
      }), { status: 404 }),
    )

    expect(response).toMatchObject({
      mode: 'vod',
      vodId: null,
      resolutionState: 'live_stream_pending',
      retryable: true,
      coverageStatus: 'syncing',
    })
    expect(resolveVodPulseState(response).status).toBe('syncing')
  })

  it('reports a proven identity conflict as an error without trusting the route candidate', async () => {
    const response = await normalizeVodPulseHttpResponse(
      '2806037629',
      new Response(JSON.stringify({
        error: 'vod_broadcaster_mismatch',
        mode: 'vod',
        vodId: null,
        streamId: '319652365022',
        resolutionState: 'identity_mismatch',
        retryable: false,
      }), { status: 409 }),
    )

    expect(response).toMatchObject({
      mode: 'vod',
      vodId: null,
      resolutionState: 'identity_mismatch',
      retryable: false,
      coverageStatus: 'error',
    })
    expect(resolveVodPulseState(response).status).toBe('error')
  })

  it('accepts a backend-validated growing archive without persisting the association', async () => {
    const response = await normalizeVodPulseHttpResponse(
      '2806037629',
      new Response(JSON.stringify(responseForHttp({
        vodId: '2806037629',
        vodOriginDeltaSeconds: 4,
        resolutionState: 'live_archive_validated',
        archiveValidation: {
          source: 'helix_video_by_id',
          state: 'validated_read_only',
          type: 'archive',
          streamId: '319652365022',
          broadcasterId: '71092938',
          persisted: false,
          streamOpen: true,
        },
      })), { status: 200 }),
    )

    expect(response).toMatchObject({
      mode: 'live_dvr',
      vodId: '2806037629',
      streamId: '319652365022',
      resolutionState: 'live_archive_validated',
      archiveValidation: { persisted: false, type: 'archive' },
      vodOriginDeltaSeconds: 4,
    })
    expect(resolveVodPulseState(response).status).toBe('live_dvr')
  })

  it('treats the validated live tuple as a successful response with no permanent VOD', async () => {
    const response = await normalizeVodPulseHttpResponse(
      'untrusted-route-candidate',
      new Response(JSON.stringify(responseForHttp()), { status: 200 }),
    )

    expect(response).toMatchObject({
      mode: 'live_dvr',
      resolutionState: 'live_stream_validated',
      streamId: '319652365022',
      vodId: null,
    })
    expect(response.coverageStatus).not.toBe('missing')
    expect(resolveVodPulseState(response).status).toBe('live_dvr')
  })

  it('keeps a healthy null-VOD live response in neutral archive-pending state', async () => {
    const response = await normalizeVodPulseHttpResponse(
      '2806037629',
      new Response(JSON.stringify(responseForHttp({ vodId: null })), { status: 200 }),
    )

    expect(response.mode).toBe('live_dvr')
    expect(response.vodId).toBeNull()
    expect(resolveVodPulseState(response).status).toBe('live_dvr')
    expect(response.coverageStatus).not.toBe('missing')
  })

  it('does not promote the VOD route candidate into the live response identity', async () => {
    const response = await normalizeVodPulseHttpResponse(
      '2806037629',
      new Response(JSON.stringify(responseForHttp()), { status: 200 }),
    )

    expect(response.mode).toBe('live_dvr')
    expect(response.vodId).toBeNull()
    expect(response.streamId).toBe('319652365022')
  })

  it('maps live rollups, peaks, coverage, and tracking into chartable channel payload', () => {
    const payload = vodPulseToChannelPayload(liveResponse())

    expect(payload).toMatchObject({
      mode: 'live_dvr',
      login: 'xqc',
      streamId: '319652365022',
      vodId: null,
      isLive: true,
      tracking: true,
      resolutionState: 'live_stream_validated',
    })
    expect(payload?.rollups).toHaveLength(1)
    expect(payload?.peaks).toHaveLength(1)
    expect(payload?.coverage?.missingRanges).toEqual([{ fromOffsetSeconds: 0, toOffsetSeconds: 120 }])
  })

  it('allows live charts when only the pre-collection prefix is waiting for VOD chat', () => {
    const payload = vodPulseToChannelPayload(liveResponse())
    const access = resolvePulseLiveAccess({ payload, pageIsLive: true })

    expect(access.state).toBe('full_live')
    expect(pulseLiveAccessAllowsChart(access.state)).toBe(true)
    expect(payload?.coverage?.canBackfill).toBe(false)
  })

  it('seeks the validated growing VOD on its canonical URL', async () => {
    const action = resolveJumpMomentAction({
      context: { kind: 'vod', vodId: '2806037629' },
      payloadMode: 'live_dvr',
      payloadVodId: '2806037629',
      vodOriginDeltaSeconds: 4,
      liveCurrentOffset: 1_200,
      offsetSeconds: 1_140,
    })

    expect(action).toEqual({
      kind: 'seek-vod',
      offsetSeconds: 1_136,
    })
  })

  it('does not offer permanent VOD navigation while the live moment is in the player buffer', () => {
    const action = resolveJumpMomentAction({
      context: { kind: 'channel', vodId: null },
      payloadMode: 'live_dvr',
      payloadVodId: null,
      liveCurrentOffset: 1_200,
      offsetSeconds: 1_140,
    })

    expect(action.kind).not.toBe('open-vod-tab')
  })

  it('keeps a permanent VOD contract separate from provisional live mode', async () => {
    const response = await normalizeVodPulseHttpResponse(
      '2806037629',
      new Response(JSON.stringify({
        mode: 'vod',
        vodId: '2806037629',
        coverageStatus: 'ready',
        channelLogin: 'xqc',
      }), { status: 200 }),
    )

    expect(response.mode).toBe('vod')
    expect(response.vodId).toBe('2806037629')
    expect(resolveVodPulseState(response).status).toBe('ready')
  })
})
