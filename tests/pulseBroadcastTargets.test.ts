import { describe, expect, it } from 'vitest'
import { tabUrlMatchesPulseLogin } from '../src/background/pulseBroadcastTargets.ts'

describe('tabUrlMatchesPulseLogin', () => {
  it('matches channel home and nested paths for the same login', () => {
    expect(tabUrlMatchesPulseLogin('https://www.twitch.tv/xqc', 'xqc')).toBe(true)
    expect(tabUrlMatchesPulseLogin('https://www.twitch.tv/XQC/videos/123', 'xqc')).toBe(true)
    expect(tabUrlMatchesPulseLogin('https://www.twitch.tv/xqc/chat', 'xqc')).toBe(true)
  })

  it('rejects unrelated Twitch tabs', () => {
    expect(tabUrlMatchesPulseLogin('https://www.twitch.tv/shroud', 'xqc')).toBe(false)
    expect(tabUrlMatchesPulseLogin('https://www.twitch.tv/directory', 'xqc')).toBe(false)
    expect(tabUrlMatchesPulseLogin('https://www.twitch.tv/', 'xqc')).toBe(false)
    expect(tabUrlMatchesPulseLogin(undefined, 'xqc')).toBe(false)
  })
})
