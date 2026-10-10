import { describe, expect, it, vi } from 'vitest'
import { MESSAGE_SENDER_SCOPE, isSenderAuthorizedForMessage } from '../src/background/pulseBroadcastTargets.ts'
import { SUPPORTER_CARD_SCRIPT_FILE, injectSupporterCard } from '../src/background/supporterCardScript.ts'
import { parseBackgroundRequest } from '../src/shared/parseBackgroundRequest.ts'

/**
 * The lazy path for the quick-settings Supporter card: the worker injects one
 * fixed script into the asking Twitch frame, in the isolated world the content
 * script shares. No new permission: `scripting` and Twitch host access exist.
 */
describe('Supporter card script injection', () => {
  it('injects the fixed card script into the sender’s own tab and frame, in the isolated world', async () => {
    const executeScript = vi.fn().mockResolvedValue([{ result: undefined }])
    expect(await injectSupporterCard({ executeScript }, { id: 'ext', frameId: 0, tab: { id: 42 } as chrome.tabs.Tab })).toBe(true)
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 42, frameIds: [0] }, world: 'ISOLATED', files: ['content/supporter-card.js'] })
    expect(SUPPORTER_CARD_SCRIPT_FILE).toBe('content/supporter-card.js')
  })

  it('does nothing without a sending tab, and reports a failed injection instead of throwing', async () => {
    const executeScript = vi.fn().mockRejectedValue(new Error('Cannot access contents of the page'))
    expect(await injectSupporterCard({ executeScript }, { id: 'ext' })).toBe(false)
    expect(executeScript).not.toHaveBeenCalled()
    expect(await injectSupporterCard({ executeScript }, { id: 'ext', frameId: 0, tab: { id: 7 } as chrome.tabs.Tab })).toBe(false)
  })

  it('takes no file, tab or frame from the caller, and only a top-frame Twitch tab or an extension page may ask', () => {
    expect(parseBackgroundRequest({ type: 'SUPPORTER_CARD_SCRIPT' })).toEqual({ type: 'SUPPORTER_CARD_SCRIPT' })
    for (const extra of [{ files: ['evil.js'] }, { tabId: 1 }, { frameId: 3 }, { world: 'MAIN' }]) {
      expect(parseBackgroundRequest({ type: 'SUPPORTER_CARD_SCRIPT', ...extra })).toBeNull()
    }
    expect(MESSAGE_SENDER_SCOPE.SUPPORTER_CARD_SCRIPT).toBe('twitch-any')
    const extensionId = 'abcdefghijklmnopabcdefghijklmnop'
    expect(isSenderAuthorizedForMessage('SUPPORTER_CARD_SCRIPT', undefined, { id: extensionId, frameId: 0, tab: { url: 'https://www.twitch.tv/xqc' } }, extensionId)).toBe(true)
    expect(isSenderAuthorizedForMessage('SUPPORTER_CARD_SCRIPT', undefined, { id: extensionId, frameId: 2, tab: { url: 'https://www.twitch.tv/xqc' } }, extensionId)).toBe(false)
    expect(isSenderAuthorizedForMessage('SUPPORTER_CARD_SCRIPT', undefined, { id: extensionId, frameId: 0, tab: { url: 'https://example.com/' } }, extensionId)).toBe(false)
    expect(isSenderAuthorizedForMessage('SUPPORTER_CARD_SCRIPT', undefined, { id: 'another-extension', frameId: 0, tab: { url: 'https://www.twitch.tv/xqc' } }, extensionId)).toBe(false)
  })
})
