import { describe, expect, it } from 'vitest'
import {
  getPrimaryVideo,
  isTwitchVodPath,
  parseChannelLogin,
  parseTwitchPage,
  seekLiveOffset,
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
})

describe('parseTwitchPage system routes', () => {
  it('treats known Twitch navigation paths as non-channel', () => {
    const routes = [
      '/following',
      '/search',
      '/browse',
      '/downloads',
      '/turbo',
      '/wallet',
      '/jobs',
      '/store',
      '/login',
      '/directory',
    ]
    for (const path of routes) {
      expect(parseTwitchPage(path).kind, path).toBe('non-channel')
      expect(parseTwitchPage(path).login, path).toBeNull()
      const head = path.slice(1).split('/')[0]!
      expect(TWITCH_SYSTEM_ROUTES.has(head)).toBe(true)
    }
  })

  it('preserves channel and VOD cases', () => {
    expect(parseTwitchPage('/fixturechan')).toEqual({
      kind: 'channel',
      login: 'fixturechan',
      vodId: null,
    })
    expect(parseTwitchPage('/videos/2806037629')).toEqual({
      kind: 'vod',
      login: null,
      vodId: '2806037629',
    })
  })
})

describe('getPrimaryVideo ranking', () => {
  it('prefers the largest visible video element', () => {
    const rect = (width: number, height: number) => ({
      width,
      height,
      top: 0,
      left: 0,
      bottom: height,
      right: width,
      x: 0,
      y: 0,
      toJSON() {},
    })
    const small = {
      id: 'small',
      paused: true,
      duration: 120,
      getBoundingClientRect: () => rect(40, 30),
    }
    const large = {
      id: 'large',
      paused: true,
      duration: 120,
      getBoundingClientRect: () => rect(640, 360),
    }
    const previousDocument = globalThis.document
    // Minimal document stub — vitest runs in node without a DOM.
    ;(globalThis as { document: unknown }).document = {
      querySelectorAll: () => [small, large],
    }
    try {
      expect(getPrimaryVideo()?.id).toBe('large')
    } finally {
      ;(globalThis as { document: unknown }).document = previousDocument
    }
  })
})

describe('seekLiveOffset horizon safety', () => {
  it('rejects a future moment instead of clamping to the live edge', () => {
    const video = {
      currentTime: 600,
      seekable: {
        length: 1,
        start: () => 0,
        end: () => 600,
      },
    } as unknown as HTMLVideoElement

    expect(seekLiveOffset(video, 3600, 600)).toEqual({ ok: false, reason: 'outside_buffer' })
    expect(video.currentTime).toBe(600)
  })

  it('still seeks valid moments behind live', () => {
    const video = {
      currentTime: 600,
      seekable: {
        length: 1,
        start: () => 0,
        end: () => 600,
      },
    } as unknown as HTMLVideoElement

    expect(seekLiveOffset(video, 540, 600)).toMatchObject({ ok: true, targetSeconds: 540 })
    expect(video.currentTime).toBe(540)
  })
})

describe('detectTwitchChannelLive Infinity gate', () => {
  it('documents that Infinity must not be gated on Number.isFinite', () => {
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
    expect(src).toMatch(/getPrimaryVideo\(\)/)
    expect(src).toMatch(/video\.duration === Infinity/)
    expect(src).not.toMatch(/Number\.isFinite\(video\.duration\).*Infinity/)
  })
})

describe('detectTwitchChannelLive primary video', () => {
  it('ignores a preceding finite ad-preview video when the live player is Infinity', async () => {
    const { detectTwitchChannelLive } = await import('../src/content/twitch.ts')
    const rect = (width: number, height: number) => ({
      width,
      height,
      top: 0,
      left: 0,
      bottom: height,
      right: width,
      x: 0,
      y: 0,
      toJSON() {},
    })
    const ad = {
      id: 'ad',
      paused: false,
      duration: 15,
      getBoundingClientRect: () => rect(320, 180),
    }
    const live = {
      id: 'live',
      paused: false,
      duration: Infinity,
      getBoundingClientRect: () => rect(1280, 720),
    }
    const previousDocument = globalThis.document
    ;(globalThis as { document: unknown }).document = {
      querySelector: (sel: string) => {
        if (sel.includes('offline')) return null
        if (sel.includes('stream-info-card')) return null
        if (sel === 'video') return ad
        return null
      },
      querySelectorAll: (sel: string) => (sel === 'video' ? [ad, live] : []),
    }
    try {
      expect(
        detectTwitchChannelLive({ kind: 'channel', login: 'fixturechan', vodId: null }),
      ).toBe(true)
    } finally {
      ;(globalThis as { document: unknown }).document = previousDocument
    }
  })
})
