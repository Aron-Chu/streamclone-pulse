import { describe, expect, it } from 'vitest'
import {
  isExtensionPageSender,
  isTrustedTwitchTopFrameSender,
  isSenderAuthorizedForMessage,
  MESSAGE_SENDER_SCOPE,
  tabUrlMatchesPulseLogin,
  type MessageSenderScope,
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
    expect(isExtensionPageSender({ id: extensionId, url: 'moz-extension://profile-uuid/options/index.html' }, extensionId)).toBe(true)
    expect(isExtensionPageSender({ id: 'different', url: `chrome-extension://${extensionId}/options.html` }, extensionId)).toBe(false)
    expect(isExtensionPageSender({ id: extensionId, url: `chrome-extension://${extensionId}.evil/options.html` }, extensionId)).toBe(false)
    expect(isExtensionPageSender({ id: extensionId, url: 'moz-extension://profile-uuid/options/index.html', tab: { url: 'moz-extension://profile-uuid/options/index.html' } }, extensionId)).toBe(true)
    expect(isExtensionPageSender({ id: extensionId, url: 'moz-extension://profile-uuid/options/index.html', tab: { url: 'https://www.twitch.tv/xqc' } }, extensionId)).toBe(false)
    expect(isExtensionPageSender({ id: extensionId, url: `chrome-extension://${extensionId}/options.html`, tab: { url: 'https://www.twitch.tv/xqc' } }, extensionId)).toBe(false)
  })

  it('requires an HTTPS Twitch top frame for page-bound commands', () => {
    expect(isTrustedTwitchTopFrameSender({ id: extensionId, frameId: 0, tab: { url: 'https://www.twitch.tv/xqc' } }, extensionId)).toBe(true)
    expect(isTrustedTwitchTopFrameSender({ id: extensionId, frameId: 1, tab: { url: 'https://www.twitch.tv/xqc' } }, extensionId)).toBe(false)
    expect(isTrustedTwitchTopFrameSender({ id: extensionId, frameId: 0, tab: { url: 'http://www.twitch.tv/xqc' } }, extensionId)).toBe(false)
    expect(isTrustedTwitchTopFrameSender({ id: 'different', frameId: 0, tab: { url: 'https://www.twitch.tv/xqc' } }, extensionId)).toBe(false)
  })
})

describe('isSenderAuthorizedForMessage', () => {
  const extensionId = 'abcdefghijklmnopabcdefghijklmnop'
  const optionsPage = { id: extensionId, url: `chrome-extension://${extensionId}/options/index.html` }
  const twitchTab = { id: extensionId, frameId: 0, tab: { url: 'https://www.twitch.tv/xqc' } }

  const scopedTypes = (scope: MessageSenderScope): string[] =>
    Object.entries(MESSAGE_SENDER_SCOPE).filter(([, value]) => value === scope).map(([key]) => key)

  it('denies every extension-page message to a Twitch content script', () => {
    const gated = scopedTypes('extension-page')
    expect(gated).toContain('SUPPORTER_ACCOUNT')
    expect(gated).toContain('ENROLL_DEVICE')
    expect(gated).toContain('ROTATE_DEVICE')
    expect(gated).toContain('REVOKE_DEVICE')
    for (const type of gated) {
      expect(isSenderAuthorizedForMessage(type, 'xqc', twitchTab, extensionId)).toBe(false)
    }
  })

  it('allows extension pages to invoke every classified message', () => {
    for (const type of Object.keys(MESSAGE_SENDER_SCOPE)) {
      expect(isSenderAuthorizedForMessage(type, 'xqc', optionsPage, extensionId)).toBe(true)
    }
  })

  it('denies an unclassified message type instead of falling through', () => {
    for (const sender of [twitchTab, optionsPage]) {
      expect(isSenderAuthorizedForMessage('BADGE_COSMETICS', 'xqc', sender, extensionId)).toBe(false)
      expect(isSenderAuthorizedForMessage('', 'xqc', sender, extensionId)).toBe(false)
      expect(isSenderAuthorizedForMessage('__proto__', 'xqc', sender, extensionId)).toBe(false)
      expect(isSenderAuthorizedForMessage('toString', 'xqc', sender, extensionId)).toBe(false)
    }
  })

  it('binds channel-scoped messages to the sending tab login', () => {
    expect(isSenderAuthorizedForMessage('GET_PULSE', 'xqc', twitchTab, extensionId)).toBe(true)
    expect(isSenderAuthorizedForMessage('GET_PULSE', 'shroud', twitchTab, extensionId)).toBe(false)
    expect(isSenderAuthorizedForMessage('GET_PULSE', undefined, twitchTab, extensionId)).toBe(false)
  })

  it('allows twitch-any messages from any top-frame Twitch tab', () => {
    const directory = { id: extensionId, frameId: 0, tab: { url: 'https://www.twitch.tv/directory' } }
    expect(isSenderAuthorizedForMessage('HEALTH', undefined, directory, extensionId)).toBe(true)
    expect(isSenderAuthorizedForMessage('GET_PULSE', undefined, directory, extensionId)).toBe(false)
  })

  it('binds VOD clip and bookmark requests to the exact top-frame video', () => {
    const vod = { id: extensionId, frameId: 0, tab: { url: 'https://www.twitch.tv/videos/123?t=2m' } }
    for (const type of ['GET_CLIP', 'LIST_BOOKMARKS', 'SAVE_BOOKMARK']) {
      expect(isSenderAuthorizedForMessage(type, 'xqc', vod, extensionId, '123')).toBe(true)
      expect(isSenderAuthorizedForMessage(type, 'xqc', vod, extensionId, '456')).toBe(false)
      expect(isSenderAuthorizedForMessage(type, 'xqc', vod, extensionId)).toBe(false)
      expect(isSenderAuthorizedForMessage(type, undefined, vod, extensionId, '123')).toBe(false)
      expect(isSenderAuthorizedForMessage(type, 'xqc', { ...vod, frameId: 1 }, extensionId, '123')).toBe(false)
      expect(isSenderAuthorizedForMessage(type, 'xqc', { ...vod, id: 'other' }, extensionId, '123')).toBe(false)
      expect(isSenderAuthorizedForMessage(type, 'shroud', twitchTab, extensionId, '123')).toBe(false)
    }
    for (const type of scopedTypes('extension-page')) {
      expect(isSenderAuthorizedForMessage(type, 'xqc', vod, extensionId, '123')).toBe(false)
    }
  })

  it('rejects iframes, foreign extension ids and non-Twitch pages', () => {
    expect(isSenderAuthorizedForMessage('HEALTH', undefined, { ...twitchTab, frameId: 1 }, extensionId)).toBe(false)
    expect(isSenderAuthorizedForMessage('HEALTH', undefined, { ...twitchTab, id: 'other' }, extensionId)).toBe(false)
    expect(isSenderAuthorizedForMessage('HEALTH', undefined, { id: extensionId, frameId: 0, tab: { url: 'https://evil.example/' } }, extensionId)).toBe(false)
    expect(isSenderAuthorizedForMessage('HEALTH', undefined, { frameId: 0, tab: { url: 'https://www.twitch.tv/xqc' } }, extensionId)).toBe(false)
  })

  it('does not trust a non-canonical Twitch subdomain content script', () => {
    const clips = { id: extensionId, frameId: 0, tab: { url: 'https://clips.twitch.tv/abc' } }
    expect(isSenderAuthorizedForMessage('HEALTH', undefined, clips, extensionId)).toBe(false)
  })
})
