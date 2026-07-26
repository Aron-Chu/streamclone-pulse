import { describe, expect, it } from 'vitest'
import { parseBackgroundRequest } from '../src/shared/parseBackgroundRequest.ts'

describe('parseBackgroundRequest', () => {
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
    expect(parseBackgroundRequest({ type: 'HEALTH' })).toEqual({ type: 'HEALTH' })
  })

  it('rejects non-objects, unknown types, and invalid logins', () => {
    expect(parseBackgroundRequest(null)).toBeNull()
    expect(parseBackgroundRequest('TRACK')).toBeNull()
    expect(parseBackgroundRequest({ type: 'EXPLODE' })).toBeNull()
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
