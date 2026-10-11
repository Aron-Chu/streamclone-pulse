import { describe, expect, it } from 'vitest'
import { parseTwitchPage } from '../src/content/twitch.ts'
import { prefetchChannelLoginFromUrl } from '../src/routing/twitchRoute.ts'
import { shouldActivateOverlay } from '../src/content/contentActivation.ts'

/**
 * Regression (deep dive 2026-10-09): Twitch pages that are not channels were
 * parsed as channels named after the route, so the panel activated, the
 * worker prefetched and the API was asked about "activate" / "subs".
 */
describe('Twitch system routes are not channels', () => {
  it.each(['/activate', '/subs/caseoh_', '/subs/caseoh_/', '/Activate'])('%s does not activate a channel session', path => {
    const context = parseTwitchPage(path)
    expect(context.kind).toBe('non-channel')
    expect(shouldActivateOverlay(context)).toBe(false)
  })

  it('the worker does not prefetch pulse for /activate or /subs', () => {
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/activate')).toBeNull()
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/subs')).toBeNull()
  })

  it('a real channel still activates and prefetches', () => {
    expect(parseTwitchPage('/caseoh_').kind).toBe('channel')
    expect(prefetchChannelLoginFromUrl('https://www.twitch.tv/caseoh_')).toBe('caseoh_')
  })
})
