import { describe, expect, it } from 'vitest'
import {
  isExtensionPageSender,
  isTrustedTwitchTopFrameSender,
  tabUrlMatchesPulseLogin,
} from '../src/background/pulseBroadcastTargets.ts'

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

  it('requires a normalized login and does not accept path lookalikes', () => {
    expect(tabUrlMatchesPulseLogin('https://www.twitch.tv/xqc-extra', 'xqc')).toBe(false)
    expect(tabUrlMatchesPulseLogin('https://www.twitch.tv/xqc', 'not valid')).toBe(false)
  })
})

describe('runtime sender matrix', () => {
  const extensionId = 'abcdefghijklmnop'

  it('accepts only the extension origin for extension-page commands', () => {
    expect(isExtensionPageSender({ id: extensionId, url: `chrome-extension://${extensionId}/options.html` }, extensionId)).toBe(true)
    expect(isExtensionPageSender({ id: 'different', url: `chrome-extension://${extensionId}/options.html` }, extensionId)).toBe(false)
    expect(isExtensionPageSender({ id: extensionId, url: `chrome-extension://${extensionId}.evil/options.html` }, extensionId)).toBe(false)
    expect(isExtensionPageSender({ id: extensionId, url: `chrome-extension://${extensionId}/options.html`, tab: { url: 'https://www.twitch.tv/xqc' } }, extensionId)).toBe(false)
  })

  it('requires an HTTPS Twitch top frame for page-bound commands', () => {
    expect(isTrustedTwitchTopFrameSender({ id: extensionId, frameId: 0, tab: { url: 'https://www.twitch.tv/xqc' } }, extensionId)).toBe(true)
    expect(isTrustedTwitchTopFrameSender({ id: extensionId, frameId: 1, tab: { url: 'https://www.twitch.tv/xqc' } }, extensionId)).toBe(false)
    expect(isTrustedTwitchTopFrameSender({ id: extensionId, frameId: 0, tab: { url: 'http://www.twitch.tv/xqc' } }, extensionId)).toBe(false)
    expect(isTrustedTwitchTopFrameSender({ id: 'different', frameId: 0, tab: { url: 'https://www.twitch.tv/xqc' } }, extensionId)).toBe(false)
  })
})
