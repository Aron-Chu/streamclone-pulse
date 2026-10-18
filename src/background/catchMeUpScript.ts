/** Built by vite.catchMeUp.config.ts; never part of content/twitch.js. */
export const CATCH_ME_UP_SCRIPT_FILE = 'content/catch-me-up.js'

type Scripting = { executeScript: (injection: chrome.scripting.ScriptInjection<unknown[], unknown>) => Promise<unknown> }

/**
 * Injects the Catch me up script into the asking Twitch tab, in the frame that
 * asked, in the extension's isolated world, so a stream recap can hand it an
 * empty slot. Same shape as the moment-pictures script: the file is fixed
 * here, and the message carries nothing a page could steer.
 */
export async function injectCatchMeUp(scripting: Scripting, sender: chrome.runtime.MessageSender): Promise<boolean> {
  const tabId = sender.tab?.id
  if (typeof tabId !== 'number' || tabId < 0) return false
  try {
    await scripting.executeScript({ target: { tabId, frameIds: [sender.frameId ?? 0] }, world: 'ISOLATED', files: [CATCH_ME_UP_SCRIPT_FILE] })
    return true
  } catch {
    return false
  }
}
