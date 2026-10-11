/** Built by vite.supporterCard.config.ts; never part of content/twitch.js. */
export const SUPPORTER_CARD_SCRIPT_FILE = 'content/supporter-card.js'

type Scripting = { executeScript: (injection: chrome.scripting.ScriptInjection<unknown[], unknown>) => Promise<unknown> }

/**
 * Injects the quick-settings Supporter card's stage script into the asking
 * Twitch tab, in the frame that asked, in the extension's isolated world (the
 * one its content scripts share), so the card can call what it registers.
 *
 * Lazy on purpose: the lab port only loads when the card is shown, which keeps
 * it out of the size-gated content script. It uses the `scripting` permission
 * and Twitch host access the extension already holds, and the file is fixed
 * here; the message carries nothing a page could steer.
 */
export async function injectSupporterCard(scripting: Scripting, sender: chrome.runtime.MessageSender): Promise<boolean> {
  const tabId = sender.tab?.id
  if (typeof tabId !== 'number' || tabId < 0) return false
  try {
    await scripting.executeScript({ target: { tabId, frameIds: [sender.frameId ?? 0] }, world: 'ISOLATED', files: [SUPPORTER_CARD_SCRIPT_FILE] })
    return true
  } catch {
    return false
  }
}
