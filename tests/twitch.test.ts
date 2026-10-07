import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  detectTwitchChannelLive,
  isTwitchVodPath,
  LIVE_READING_HOLD_MS,
  parseChannelLogin,
  TWITCH_SYSTEM_ROUTES,
} from '../src/content/twitch.ts'

describe('isTwitchVodPath', () => {
  it('detects VOD watch URLs', () => {
    expect(isTwitchVodPath('/videos/1234567890')).toBe(true)
    expect(isTwitchVodPath('/xqc/videos/1234567890')).toBe(true)
    expect(isTwitchVodPath('/xqc')).toBe(false)
  })
})

describe('parseChannelLogin', () => {
  it('parses channel paths', () => {
    expect(parseChannelLogin('/xqc')).toBe('xqc')
    expect(parseChannelLogin('/xqc/')).toBe('xqc')
  })

  it('ignores reserved routes', () => {
    expect(parseChannelLogin('/directory')).toBeNull()
  })

  it.each([
    'following',
    'search',
    'browse',
    'downloads',
    'turbo',
    'wallet',
    'jobs',
    'store',
    'login',
    'signup',
    'products',
    'privacy',
    'legal',
    'help',
  ])('does not treat /%s or its subroutes as a channel', route => {
    expect(TWITCH_SYSTEM_ROUTES.has(route)).toBe(true)
    expect(parseChannelLogin(`/${route}`)).toBeNull()
    expect(parseChannelLogin(`/${route}/anything`)).toBeNull()
  })
})

describe('detectTwitchChannelLive Infinity gate', () => {
  it('documents that Infinity must not be gated on Number.isFinite', () => {
    // Regression lock for src/content/twitch.ts live video detection.
    expect(Number.isFinite(Infinity)).toBe(false)
    expect(Infinity === Infinity).toBe(true)
  })

  it('source uses duration === Infinity without Number.isFinite', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(
      path.resolve(__dirname, '../src/content/twitch.ts'),
      'utf8',
    )
    expect(src).toMatch(/video\.duration === Infinity/)
    expect(src).not.toMatch(/Number\.isFinite\(video\.duration\).*Infinity/)
  })
})

describe('detectTwitchChannelLive', () => {
  const channel = { kind: 'channel', login: 'fixturechan', vodId: null } as const

  function livePage(): { doc: Document; ad: HTMLVideoElement; main: HTMLVideoElement } {
    const dom = new JSDOM(`
      <div class="ad-slot"><video data-test="ad"></video></div>
      <div data-a-target="video-player"><video aria-label="Twitch video player" data-test="main"></video></div>`)
    const doc = dom.window.document
    const ad = doc.querySelector('[data-test="ad"]') as HTMLVideoElement
    const main = doc.querySelector('[data-test="main"]') as HTMLVideoElement
    Object.defineProperty(ad, 'duration', { configurable: true, value: 15 })
    Object.defineProperty(main, 'duration', { configurable: true, value: Infinity })
    vi.stubGlobal('document', doc)
    return { doc, ad, main }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads the main player, not the first video on the page', () => {
    livePage()
    expect(detectTwitchChannelLive(channel, 1_000)).toBe(true)
  })

  it('holds live through one offline reading and drops on the second tick', () => {
    const page = livePage()
    expect(detectTwitchChannelLive(channel, 1_000)).toBe(true)
    // An ad break swaps the main player to a finite clip.
    Object.defineProperty(page.main, 'duration', { configurable: true, value: 30 })
    expect(detectTwitchChannelLive(channel, 6_000)).toBe(true)
    expect(detectTwitchChannelLive(channel, 1_000 + LIVE_READING_HOLD_MS - 1)).toBe(true)
    expect(detectTwitchChannelLive(channel, 11_000)).toBe(false)
  })

  it('drops live at once on Twitch offline markers and never carries live to another channel', () => {
    const page = livePage()
    expect(detectTwitchChannelLive(channel, 1_000)).toBe(true)
    Object.defineProperty(page.main, 'duration', { configurable: true, value: 30 })
    expect(detectTwitchChannelLive({ kind: 'channel', login: 'otherchan', vodId: null }, 2_000)).toBe(false)

    const offline = page.doc.createElement('div')
    offline.setAttribute('data-a-target', 'channel-offline-header')
    page.doc.body.append(offline)
    expect(detectTwitchChannelLive(channel, 2_000)).toBe(false)
    offline.remove()
    // The offline marker cleared the held reading.
    expect(detectTwitchChannelLive(channel, 2_500)).toBe(false)
  })
})
