/** Built by vite.quickSettings.config.ts; never part of content/twitch.js. */
export const QUICK_SETTINGS_SCRIPT_FILE = 'content/quick-settings.js'

type Scripting = { executeScript: (injection: chrome.scripting.ScriptInjection<unknown[], unknown>) => Promise<unknown> }

/**
 * Injects the panel's Quick settings script into the asking Twitch tab, in the
 * frame that asked, in the extension's isolated world (the one its content
 * scripts share), so the panel can render what it registers. Same shape as the
 * Catch me up script: the file is fixed here, and the message carries nothing
 * a page could steer.
 */
export async function injectQuickSettings(scripting: Scripting, sender: chrome.runtime.MessageSender): Promise<boolean> {
  const tabId = sender.tab?.id
  if (typeof tabId !== 'number' || tabId < 0) return false
  try {
    await scripting.executeScript({ target: { tabId, frameIds: [sender.frameId ?? 0] }, world: 'ISOLATED', files: [QUICK_SETTINGS_SCRIPT_FILE] })
    return true
  } catch {
    return false
  }
}
