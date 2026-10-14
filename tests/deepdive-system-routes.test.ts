import { describe, expect, it } from 'vitest'
import { isTwitchChatPath, parseTwitchPage } from '../src/content/twitch.ts'
import { prefetchChannelLoginFromUrl, resolveTwitchRoute } from '../src/routing/twitchRoute.ts'
import { shouldActivateOverlay } from '../src/content/contentActivation.ts'

/**
 * Regression (deep dive 2026-10-09): Twitch pages that are not channels were
 * parsed as channels named after the route, so the panel activated, the
 * worker prefetched and the API was asked about "activate" / "subs".
 */
describe('Twitch system routes are not channels', () => {
  it.each([
    '/activate', '/subs/caseoh_', '/subs/caseoh_/', '/Activate',
    '/collections', '/collections/abc123', '/redeem',
    '/embed/xqc/chat', '/event/something', '/Event/something',
  ])('%s does not activate a channel session', path => {
    const context = parseTwitchPage(path)
    expect(context).toEqual({ kind: 'non-channel', login: null, vodId: null })
    expect(shouldActivateOverlay(context)).toBe(false)
    expect(isTwitchChatPath(path)).toBe(false)
    expect(resolveTwitchRoute(`https://www.twitch.tv${path}`)).toEqual({
      kind: 'missing-data', reason: 'unsupported_route',
    })
    expect(prefetchChannelLoginFromUrl(`https://www.twitch.tv${path}`)).toBeNull()
  })

  it.each(['activate', 'subs', 'collections', 'redeem', 'embed', 'event'])('the worker does not prefetch pulse for /%s', route => {
    expect(prefetchChannelLoginFromUrl(`https://www.twitch.tv/${route}`)).toBeNull()
  })

  it('a real channel still activates and prefetches', () => {
    expect(parseTwitchPage('/caseoh_').kind).toBe('channel')
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/caseoh_')).toBe('caseoh_')
  })
})

describe('shared clip watch pages do not activate Pulse', () => {
  it.each([
    '/xqc/clip/SomeClipSlug',
    '/xqc/clip/SomeClipSlug/',
    '/XQC/Clip/SomeClipSlug',
  ])('%s leaves clip comments available', path => {
    const context = parseTwitchPage(path)
    expect(context).toEqual({ kind: 'non-channel', login: null, vodId: null })
    expect(shouldActivateOverlay(context)).toBe(false)
    expect(isTwitchChatPath(path)).toBe(false)
    expect(resolveTwitchRoute(`https://www.twitch.tv${path}?filter=clips&range=7d`)).toEqual({
      kind: 'missing-data', reason: 'unsupported_route',
    })
    expect(prefetchChannelLoginFromUrl(`https://www.twitch.tv${path}`)).toBeNull()
  })

  it.each(['clips', 'videos', 'schedule', 'about', 'squad'])('keeps the channel /%s sub-page supported', subPage => {
    const context = parseTwitchPage(`/xqc/${subPage}`)
    expect(context).toEqual({ kind: 'channel', login: 'xqc', vodId: null })
    expect(shouldActivateOverlay(context)).toBe(true)
  })
})
