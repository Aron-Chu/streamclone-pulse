import { describe, expect, it } from 'vitest'
import {
  missingVodPulseResponse,
  normalizeVodPulseHttpResponse,
  resolveVodPulseState,
  sanitizeVodTransportError,
} from '../src/vod/normalizeVodPulseFetch.ts'
import type { ExtensionVodPulseResponse } from '../src/types/vodPulseTypes.ts'

function mockResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('sanitizeVodTransportError', () => {
  it('strips vod_pulse status codes', () => {
    expect(sanitizeVodTransportError('vod_pulse 404')).toBeNull()
    expect(sanitizeVodTransportError('vod_pulse 500')).toBeNull()
  })

  it('maps unknown transport errors to friendly copy', () => {
    expect(sanitizeVodTransportError('unexpected')).toContain('temporarily unavailable')
  })
})

describe('normalizeVodPulseHttpResponse', () => {
  it('maps 200 ready to ready payload', async () => {
    const res = await normalizeVodPulseHttpResponse('2806037629', mockResponse(200, {
      mode: 'vod',
      vodId: '2806037629',
      coverageStatus: 'ready',
      streamId: '319',
      channelLogin: 'xqc',
      games: [
        { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 3600 },
      ],
    }))
    expect(res.coverageStatus).toBe('ready')
    expect(res.streamId).toBe('319')
    expect(res.games?.[0]?.gameName).toBe('Just Chatting')
  })

  it('preserves empty games arrays without inventing segments', async () => {
    const res = await normalizeVodPulseHttpResponse('2806037629', mockResponse(200, {
      mode: 'vod',
      vodId: '2806037629',
      coverageStatus: 'ready',
      channelLogin: 'xqc',
      games: [],
    }))
    expect(res.games).toEqual([])
  })

  it('drops malformed games field', async () => {
    const res = await normalizeVodPulseHttpResponse('2806037629', mockResponse(200, {
      mode: 'vod',
      vodId: '2806037629',
      coverageStatus: 'syncing',
      games: 'nope',
    }))
    expect(res.games).toBeUndefined()
  })

  it('maps 200 missing to missing payload', async () => {
    const res = await normalizeVodPulseHttpResponse('2806037629', mockResponse(200, {
      mode: 'vod',
      vodId: '2806037629',
      coverageStatus: 'missing',
      coverageMessage: 'No replay analytics have been indexed for this VOD yet.',
    }))
    expect(res.coverageStatus).toBe('missing')
  })

  it('maps HTTP 404 to missing', async () => {
    const res = await normalizeVodPulseHttpResponse('2806037629', mockResponse(404, 'vod_pulse 404'))
    expect(res.coverageStatus).toBe('missing')
  })

  it('maps HTTP 500 to error payload', async () => {
    const res = await normalizeVodPulseHttpResponse('2806037629', mockResponse(500, { error: 'boom' }))
    expect(res.coverageStatus).toBe('error')
  })

  it('maps malformed JSON on success to error', async () => {
    const res = await normalizeVodPulseHttpResponse(
      '2806037629',
      new Response('not-json', { status: 200 }),
    )
    expect(res.coverageStatus).toBe('error')
  })
})

describe('resolveVodPulseState', () => {
  const ready: ExtensionVodPulseResponse = {
    mode: 'vod',
    vodId: '1',
    coverageStatus: 'ready',
    streamId: 's1',
    channelLogin: 'xqc',
  }

  it('maps ready coverage to ready state', () => {
    expect(resolveVodPulseState(ready).status).toBe('ready')
  })

  it('maps syncing coverage to syncing state', () => {
    const state = resolveVodPulseState({
      ...ready,
      coverageStatus: 'syncing',
      coverageMessage: 'Replay analytics are still syncing for this VOD.',
    })
    expect(state.status).toBe('syncing')
  })

  it('maps transport vod_pulse 404 error to missing when no data', () => {
    const state = resolveVodPulseState(null, 'vod_pulse 404', false, '2806037629')
    expect(state.status).toBe('missing')
    if (state.status === 'missing') {
      expect(state.reason).toContain('indexed')
    }
  })

  it('maps missing response to missing state', () => {
    const state = resolveVodPulseState(missingVodPulseResponse('2806037629'))
    expect(state.status).toBe('missing')
  })

  it('never surfaces raw vod_pulse transport codes as error message', () => {
    const state = resolveVodPulseState(null, 'vod_pulse 404', false, '2806037629')
    expect(state.status).not.toBe('error')
    if (state.status === 'missing') {
      expect(state.reason).not.toMatch(/vod_pulse/i)
    }
  })
})
