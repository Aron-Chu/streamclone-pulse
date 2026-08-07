import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchPulseChannel,
  fetchPulseArchiveCandidate,
  fetchPulseStream,
  PULSE_REQUEST_TIMEOUT_MS,
  postVodHint,
  setAlwaysTracked,
} from '../src/background/api.ts'
import { PulseRequestError } from '../src/shared/pulseError.ts'

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

describe('bounded Pulse API requests', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('classifies HTTP failures without exposing a raw fetch error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'fixture' }, 503)))

    await expect(fetchPulseChannel('fixturechan', { baseUrl: 'https://api.example.test' }))
      .rejects.toMatchObject({ kind: 'http', status: 503, message: 'pulse 503' })
  })

  it('rejects malformed pulse envelopes as invalid responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ rollups: [] })))

    await expect(fetchPulseChannel('fixturechan', { baseUrl: 'https://api.example.test' }))
      .rejects.toMatchObject({ kind: 'invalid_response' })
  })

  it('aborts a hung request at the fixed timeout boundary', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    )))

    const pending = fetchPulseChannel('fixturechan', { baseUrl: 'https://api.example.test' })
    const settled = pending.then(() => null, error => error)
    await vi.advanceTimersByTimeAsync(PULSE_REQUEST_TIMEOUT_MS)

    const error = await settled
    expect(error).toBeInstanceOf(PulseRequestError)
    expect(error).toMatchObject({ kind: 'timeout' })
  })

  it('bounds always-tracked writes with the same request wrapper', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'fixture' }, 503)))

    await expect(setAlwaysTracked('fixturechan', true, 'https://api.example.test'))
      .rejects.toMatchObject({ kind: 'http', status: 503, message: 'always_tracked_set 503' })
  })

  it('treats hosted vod-hint auth as a non-blocking result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'unauthorized' }, 401)))

    await expect(postVodHint(
      'xqc',
      { streamId: '319780491228', vodId: '2838742057' },
      'https://api.example.test',
    )).resolves.toMatchObject({
      ok: false,
      status: 401,
      error: 'vod_hint_auth_required',
    })
  })

  it('fetches a validated provisional live bridge with exact identity parameters', async () => {
    const payload = {
      login: 'hasanabi',
      streamId: '318702573527',
      isLive: true,
      tracking: true,
      rollups: [],
      mode: 'live_dvr',
      provisional: true,
      resolutionState: 'live_stream_validated',
      retryable: true,
    }
    const fetchMock = vi.fn(async () => response(payload))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchPulseStream(' 318702573527 ', {
      broadcasterLogin: ' HasanAbi ',
      window: 'full',
      baseUrl: 'https://api.example.test',
    })

    expect(result).toMatchObject({
      streamId: '318702573527',
      mode: 'live_dvr',
      provisional: true,
      resolutionState: 'live_stream_validated',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/v1/extension/pulse/streams/318702573527?login=hasanabi&allowLiveBridge=true&window=full',
      expect.objectContaining({ headers: {}, signal: expect.any(AbortSignal) }),
    )
  })

  it('rejects a provisional bridge response for a different stream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      login: 'hasanabi',
      streamId: 'different-stream',
      isLive: true,
      tracking: true,
      rollups: [],
    })))

    await expect(fetchPulseStream('318702573527', {
      broadcasterLogin: 'hasanabi',
      baseUrl: 'https://api.example.test',
    })).rejects.toThrow('pulse_stream_identity_mismatch')
  })

  it('rejects an archive candidate response for a different stream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      streamId: 'different-stream',
      navigationValidated: true,
      navigationVodId: 'vod-1',
      analyticsResolutionState: 'resolved',
      analyticsAvailable: true,
      persisted: false,
    })))

    await expect(fetchPulseArchiveCandidate(
      '318702573527',
      'hasanabi',
      'https://api.example.test',
    )).rejects.toThrow('pulse_archive_identity_mismatch')
  })

  it('rejects a validated archive candidate with a non-numeric VOD id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      streamId: '318702573527',
      navigationValidated: true,
      navigationVodId: 'not-a-vod',
      analyticsResolutionState: 'ready',
      analyticsAvailable: true,
      persisted: false,
    })))

    await expect(fetchPulseArchiveCandidate(
      '318702573527',
      'hasanabi',
      'https://api.example.test',
    )).rejects.toMatchObject({ kind: 'invalid_response' })
  })

  it('classifies an older backend without archive-candidate support', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'not_found' }, 404)))

    await expect(fetchPulseArchiveCandidate(
      '318702573527',
      'hasanabi',
      'https://api.example.test',
    )).rejects.toThrow('archive_candidate_unavailable')
  })

  it('rejects an unvalidated archive candidate carrying a VOD id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({
      streamId: '318702573527',
      navigationValidated: false,
      navigationVodId: '2838281809',
      analyticsResolutionState: 'archive_not_published',
      analyticsAvailable: false,
      persisted: false,
    })))

    await expect(fetchPulseArchiveCandidate(
      '318702573527',
      'hasanabi',
      'https://api.example.test',
    )).rejects.toMatchObject({ kind: 'invalid_response' })
  })

  it('classifies hosted backfill auth as a stable non-retryable error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: 'unauthorized' }, 401)))

    const { postPulseBackfill } = await import('../src/background/api.ts')
    await expect(postPulseBackfill(
      'xqc',
      { streamId: '319780491228', vodId: '2839002231' },
      'https://api.example.test',
    )).rejects.toThrow('backfill_auth_required')
  })
})
