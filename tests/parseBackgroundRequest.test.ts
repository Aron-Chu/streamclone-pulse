import { describe, expect, it } from 'vitest'
import { parseBackgroundRequest } from '../src/shared/parseBackgroundRequest.ts'

describe('parseBackgroundRequest', () => {
  it('preserves clip stream identity across the background boundary', () => {
    const request = {
      type: 'GET_CLIP', login: 'xqc', streamId: 'stream-1', vodId: '123',
      startedAt: '2026-09-17T12:00:00Z', endedAt: '2026-09-17T14:00:00Z', isLive: false,
    }
    expect(parseBackgroundRequest({ ...request, pageText: 'discard' })).toEqual(request)
  })
  it('accepts known typed messages with valid logins', () => {
    expect(parseBackgroundRequest({ type: 'TRACK', login: 'xQc' })).toEqual({
      type: 'TRACK',
      login: 'xqc',
    })
    expect(parseBackgroundRequest({ type: 'GET_PULSE', login: 'xqc', window: 'full' })).toEqual({
      type: 'GET_PULSE',
      login: 'xqc',
      watch: undefined,
      window: 'full',
      streamId: undefined,
    })
    expect(parseBackgroundRequest({ type: 'HEALTH' })).toEqual({ type: 'HEALTH', force: undefined })
    expect(parseBackgroundRequest({ type: 'HEALTH', force: true })).toEqual({ type: 'HEALTH', force: true })
    expect(parseBackgroundRequest({ type: 'GET_UPDATE_CHECK_CAPABILITY' })).toEqual({ type: 'GET_UPDATE_CHECK_CAPABILITY' })
    expect(parseBackgroundRequest({ type: 'CHECK_FOR_UPDATE' })).toEqual({ type: 'CHECK_FOR_UPDATE' })
    expect(parseBackgroundRequest({ type: 'OPEN_SETTINGS_HOST' })).toEqual({ type: 'OPEN_SETTINGS_HOST' })
    expect(parseBackgroundRequest({ type: 'OPEN_SETTINGS_HOST', section: 'updates' })).toEqual({
      type: 'OPEN_SETTINGS_HOST',
      section: 'updates',
    })
    expect(parseBackgroundRequest({
      type: 'GET_PULSE_VOD',
      vodId: '2806037629',
      streamId: '317150146039',
      window: 'recent',
    })).toEqual({
      type: 'GET_PULSE_VOD',
      vodId: '2806037629',
      streamId: '317150146039',
      window: 'recent',
    })
  })

  it('drops raw page and chat fields from outbound pulse requests', () => {
    expect(parseBackgroundRequest({
      type: 'GET_PULSE',
      login: 'xQc',
      window: 'recent',
      streamId: 'stream-1',
      rawPageHtml: '<main>private</main>',
      chatMessages: [{ text: 'private message' }],
      pageText: 'private page copy',
    })).toEqual({
      type: 'GET_PULSE',
      login: 'xqc',
      watch: undefined,
      window: 'recent',
      streamId: 'stream-1',
    })
  })

  it('rejects non-objects, unknown types, and invalid logins', () => {
    expect(parseBackgroundRequest(null)).toBeNull()
    expect(parseBackgroundRequest('TRACK')).toBeNull()
    expect(parseBackgroundRequest({ type: 'EXPLODE' })).toBeNull()
    expect(parseBackgroundRequest({ type: 'OPEN_OPTIONS' })).toBeNull()
    expect(parseBackgroundRequest({ type: 'OPEN_SETTINGS_HOST', url: 'https://attacker.example' })).toBeNull()
    expect(parseBackgroundRequest({ type: 'OPEN_SETTINGS_HOST', path: '/attacker' })).toBeNull()
    expect(parseBackgroundRequest({ type: 'OPEN_SETTINGS_HOST', section: 'attacker' })).toBeNull()
    expect(parseBackgroundRequest({ type: 'TRACK', login: '../../etc' })).toBeNull()
    expect(parseBackgroundRequest({ type: 'TRACK', login: 'a' })).toBeNull()
  })

  it('validates FETCH_EMOTE_IMAGE url presence (host checks happen in fetch)', () => {
    expect(parseBackgroundRequest({ type: 'FETCH_EMOTE_IMAGE' })).toBeNull()
    expect(parseBackgroundRequest({ type: 'FETCH_EMOTE_IMAGE', url: '  ' })).toBeNull()
    expect(parseBackgroundRequest({ type: 'FETCH_EMOTE_IMAGE', url: 'https://cdn.7tv.app/x.webp' })).toEqual({
      type: 'FETCH_EMOTE_IMAGE',
      url: 'https://cdn.7tv.app/x.webp',
    })
  })

  it('requires stream/vod ids for hint and backfill messages', () => {
    expect(parseBackgroundRequest({ type: 'HINT_VOD', login: 'xqc' })).toBeNull()
    expect(
      parseBackgroundRequest({ type: 'HINT_VOD', login: 'xqc', streamId: '1', vodId: 'v1' }),
    ).toEqual({ type: 'HINT_VOD', login: 'xqc', streamId: '1', vodId: 'v1' })
    expect(parseBackgroundRequest({ type: 'LOAD_MISSED_MOMENTS', login: 'xqc' })).toBeNull()
    expect(
      parseBackgroundRequest({ type: 'LOAD_MISSED_MOMENTS', login: 'xqc', streamId: '1' }),
    ).toEqual({
      type: 'LOAD_MISSED_MOMENTS',
      login: 'xqc',
      streamId: '1',
      vodId: undefined,
      fromOffsetSeconds: undefined,
      toOffsetSeconds: undefined,
    })
  })

  it('requires login binding for always-tracked and backfill status requests', () => {
    expect(parseBackgroundRequest({ type: 'GET_ALWAYS_TRACKED' })).toBeNull()
    expect(parseBackgroundRequest({ type: 'GET_PULSE_BACKFILL_STATUS', jobId: 'job-1' })).toBeNull()
    expect(parseBackgroundRequest({ type: 'GET_ALWAYS_TRACKED', login: 'XQC' })).toEqual({
      type: 'GET_ALWAYS_TRACKED',
      login: 'xqc',
    })
    expect(parseBackgroundRequest({
      type: 'GET_PULSE_BACKFILL_STATUS',
      jobId: 'job-1',
      login: 'XQC',
    })).toEqual({
      type: 'GET_PULSE_BACKFILL_STATUS',
      jobId: 'job-1',
      login: 'xqc',
    })
  })

  it('normalizes optional LIST_BOOKMARKS login and rejects invalid logins', () => {
    expect(parseBackgroundRequest({ type: 'LIST_BOOKMARKS' })).toEqual({
      type: 'LIST_BOOKMARKS',
      login: undefined,
      streamId: undefined,
      vodId: undefined,
    })
    expect(parseBackgroundRequest({ type: 'LIST_BOOKMARKS', login: 'XQC' })).toEqual({
      type: 'LIST_BOOKMARKS',
      login: 'xqc',
      streamId: undefined,
      vodId: undefined,
    })
    expect(parseBackgroundRequest({ type: 'LIST_BOOKMARKS', login: 'a' })).toBeNull()
  })

  it('keeps bookmark sender VOD context separate from list filters', () => {
    expect(parseBackgroundRequest({ type: 'LIST_BOOKMARKS', login: 'xqc', streamId: '123', contextVodId: '987' }))
      .toEqual({ type: 'LIST_BOOKMARKS', login: 'xqc', streamId: '123', vodId: undefined, contextVodId: '987' })
    for (const contextVodId of ['', 'abc', 987, null]) {
      expect(parseBackgroundRequest({ type: 'LIST_BOOKMARKS', contextVodId })).toBeNull()
    }
  })

  it('accepts APPEND_PULSE_DEBUG and CLEAR_PULSE_DEBUG_LOG', () => {
    expect(parseBackgroundRequest({ type: 'CLEAR_PULSE_DEBUG_LOG' })).toEqual({
      type: 'CLEAR_PULSE_DEBUG_LOG',
    })
    expect(parseBackgroundRequest({ type: 'APPEND_PULSE_DEBUG' })).toBeNull()
    expect(
      parseBackgroundRequest({
        type: 'APPEND_PULSE_DEBUG',
        entry: { ts: 1, step: 'ui.coverage', message: 'hi', level: 'info' },
      }),
    ).toEqual({
      type: 'APPEND_PULSE_DEBUG',
      entry: { ts: 1, step: 'ui.coverage', message: 'hi', level: 'info' },
    })
  })

  it('accepts REPORT_EXTENSION_DIAGNOSTIC without trusting payload surface/release', () => {
    expect(
      parseBackgroundRequest({
        type: 'REPORT_EXTENSION_DIAGNOSTIC',
        feature: 'overlay',
        event: 'render_error',
        error: 'type_error',
        surface: 'popup',
        release: 'evil@9.9.9',
        frames: [{ bundle: 'content/twitch.js', line: 1, column: 2 }],
      }),
    ).toEqual({
      type: 'REPORT_EXTENSION_DIAGNOSTIC',
      feature: 'overlay',
      event: 'render_error',
      error: 'type_error',
      frames: [{ bundle: 'content/twitch.js', line: 1, column: 2 }],
    })
  })
})
