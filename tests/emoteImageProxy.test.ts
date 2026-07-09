import { describe, expect, it } from 'vitest'
import { needsEmoteImageProxy } from '../src/shared/emoteImageProxy.ts'

describe('needsEmoteImageProxy', () => {
  it('requires proxy for http urls on https pages', () => {
    Object.defineProperty(globalThis, 'window', {
      value: { location: { protocol: 'https:' } },
      configurable: true,
    })
    expect(needsEmoteImageProxy('http://localhost:8081/emotes/uuid/1x.webp')).toBe(true)
  })

  it('does not proxy https cdn urls', () => {
    Object.defineProperty(globalThis, 'window', {
      value: { location: { protocol: 'https:' } },
      configurable: true,
    })
    expect(needsEmoteImageProxy('https://cdn.7tv.app/emote/123/4x.webp')).toBe(false)
  })
})
