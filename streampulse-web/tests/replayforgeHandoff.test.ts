import { describe, expect, it } from 'vitest'
import { refreshedReplayforgeHandoffHref, replayforgeHandoffHref } from '../src/lib/replayforgeHandoff'

describe('ReplayForge navigation boundary', () => {
  it('requires both deployment opt-in and a server reference', () => {
    expect(replayforgeHandoffHref(undefined, 'https://clips.example')).toBeNull()
    expect(replayforgeHandoffHref('public-moment-id', 'https://clips.example')).toBeNull()
    expect(replayforgeHandoffHref('cr_Y2NfYWJj', '')).toBeNull()
    expect(replayforgeHandoffHref('cr_Y2NfYWJj', 'https://clips.example')).toBe('https://clips.example/handoff/streampulse/cr_Y2NfYWJj')
  })
  it('does not permit credentials, arbitrary paths, insecure remote origins, or encoded traversal', () => {
    for (const origin of ['http://clips.example', 'https://user:secret@clips.example', 'https://clips.example/other', 'https://clips.example/?token=secret', 'javascript:alert(1)']) {
      expect(replayforgeHandoffHref('cr_Y2NfYWJj', origin, false)).toBeNull()
    }
    expect(replayforgeHandoffHref('cr_../../wrong', 'https://clips.example')).toBeNull()
    expect(replayforgeHandoffHref('cr_Y2NfYWJj', 'http://127.0.0.1:8096', false)).toBeNull()
    expect(replayforgeHandoffHref('cr_Y2NfYWJj', 'http://127.0.0.1:8096', true)).toContain(':8096/handoff/')
  })
  it('requires a freshly checked VOD and eligible ref before preparing a saved moment', () => {
    const origin = 'https://clips.example'
    expect(refreshedReplayforgeHandoffHref(null, origin)).toBeNull()
    expect(refreshedReplayforgeHandoffHref({ vodHref: null, handoffRef: 'cr_Y2NfYWJj' }, origin)).toBeNull()
    expect(refreshedReplayforgeHandoffHref({ vodHref: 'https://www.twitch.tv/videos/123?t=4s' }, origin)).toBeNull()
    expect(refreshedReplayforgeHandoffHref({ vodHref: 'https://www.twitch.tv/videos/123?t=4s', handoffRef: 'cr_Y2NfYWJj' }, origin))
      .toBe('https://clips.example/handoff/streampulse/cr_Y2NfYWJj')
  })
})
