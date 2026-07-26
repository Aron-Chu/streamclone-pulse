import { describe, expect, it } from 'vitest'
import { isTwitchVodPath, parseChannelLogin } from '../src/content/twitch.ts'

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
