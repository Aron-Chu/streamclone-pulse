import { afterEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import {
  detectTwitchChannelLive,
  isTwitchChatPath,
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

describe('isTwitchChatPath', () => {
  it('is true on a channel page and on VOD watch pages', () => {
    expect(isTwitchChatPath('/xqc')).toBe(true)
    expect(isTwitchChatPath('/xqc/')).toBe(true)
    expect(isTwitchChatPath('/videos/1234567890')).toBe(true)
    expect(isTwitchChatPath('/xqc/videos/1234567890')).toBe(true)
  })

  it('is false on system routes and channel sub-pages without chat', () => {
    expect(isTwitchChatPath('/')).toBe(false)
    expect(isTwitchChatPath('/directory')).toBe(false)
    expect(isTwitchChatPath('/directory/following')).toBe(false)
    expect(isTwitchChatPath('/videos')).toBe(false)
    expect(isTwitchChatPath('/xqc/videos')).toBe(false)
    expect(isTwitchChatPath('/xqc/about')).toBe(false)
    expect(isTwitchChatPath('/xqc/clip/SomeClipSlug')).toBe(false)
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
    // Clear the held reading so each case starts without a previous live signal.
    document.body.innerHTML = '<div data-a-target="channel-offline-header"></div>'
    detectTwitchChannelLive(channel)
    vi.unstubAllGlobals()
  })

  it.each([Infinity, 9_223_372_036_854.775])('reads a live main player with duration %s, not an earlier ad', duration => {
    const page = livePage()
    Object.defineProperty(page.main, 'duration', { configurable: true, value: duration })
    expect(detectTwitchChannelLive(channel, 1_000)).toBe(true)
  })

  it.each([NaN, -Infinity, 0, 30, 21_814, 1e12])('does not treat duration %s as a live broadcast', duration => {
    const page = livePage()
    Object.defineProperty(page.main, 'duration', { configurable: true, value: duration })
    expect(detectTwitchChannelLive(channel, 1_000)).toBe(false)
  })

  it.each([
    '<p data-a-target="animated-channel-viewers-count">41,982</p>',
    '<div class="tw-channel-status-text-indicator"><p>LIVE</p></div>',
  ])('reads the channel header as live while an ad or player error hides the live duration: %s', header => {
    const page = livePage()
    Object.defineProperty(page.main, 'duration', { configurable: true, value: 30 })
    expect(detectTwitchChannelLive(channel, 1_000)).toBe(false)
    page.doc.body.insertAdjacentHTML('beforeend', header)
    expect(detectTwitchChannelLive(channel, 20_000)).toBe(true)
    page.doc.body.insertAdjacentHTML('beforeend', '<div data-a-target="channel-offline-header"></div>')
    expect(detectTwitchChannelLive(channel, 21_000)).toBe(false)
  })

  it('does not read a non-LIVE status indicator as live', () => {
    const page = livePage()
    Object.defineProperty(page.main, 'duration', { configurable: true, value: 30 })
    page.doc.body.insertAdjacentHTML('beforeend', '<div class="tw-channel-status-text-indicator"><p>OFFLINE</p></div>')
    expect(detectTwitchChannelLive(channel, 1_000)).toBe(false)
  })

  it('ignores the Firefox sentinel on a secondary video', () => {
    const page = livePage()
    Object.defineProperty(page.ad, 'duration', { configurable: true, value: 9_223_372_036_854.775 })
    Object.defineProperty(page.main, 'duration', { configurable: true, value: 30 })
    expect(detectTwitchChannelLive(channel, 1_000)).toBe(false)
  })

  it('rejects VOD and non-channel contexts even with a Firefox live duration', () => {
    const page = livePage()
    Object.defineProperty(page.main, 'duration', { configurable: true, value: 9_223_372_036_854.775 })
    expect(detectTwitchChannelLive({ ...channel, vodId: '1234567890' }, 1_000)).toBe(false)
    expect(detectTwitchChannelLive({ kind: 'non-channel', login: null, vodId: null }, 1_000)).toBe(false)
  })

  it.each(['channel-offline-header', 'channel-offline-still-image'])('lets %s override the Firefox live duration', marker => {
    const page = livePage()
    Object.defineProperty(page.main, 'duration', { configurable: true, value: 9_223_372_036_854.775 })
    expect(detectTwitchChannelLive(channel, 1_000)).toBe(true)
    page.doc.body.insertAdjacentHTML('beforeend', `<div data-a-target="${marker}"></div>`)
    expect(detectTwitchChannelLive(channel, 2_000)).toBe(false)
  })

  it.each([Infinity, 9_223_372_036_854.775])('holds duration %s live through one offline reading and drops on the second tick', duration => {
    const page = livePage()
    Object.defineProperty(page.main, 'duration', { configurable: true, value: duration })
    expect(detectTwitchChannelLive(channel, 1_000)).toBe(true)
    // An ad break swaps the main player to a finite clip.
    Object.defineProperty(page.main, 'duration', { configurable: true, value: 30 })
    expect(detectTwitchChannelLive(channel, 6_000)).toBe(true)
    expect(detectTwitchChannelLive(channel, 1_000 + LIVE_READING_HOLD_MS - 1)).toBe(true)
    expect(detectTwitchChannelLive(channel, 11_000)).toBe(false)
  })

  it.each([Infinity, 9_223_372_036_854.775])('drops duration %s live on offline markers and never carries it to another channel', duration => {
    const page = livePage()
    Object.defineProperty(page.main, 'duration', { configurable: true, value: duration })
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
