import { getMomentPicturesEnabled } from '../shared/storage.ts'

/** Built by vite.momentFrames.config.ts; never part of content/twitch.js. */
export const MOMENT_FRAMES_SCRIPT_FILE = 'content/moment-frames.js'

type Scripting = { executeScript: (injection: chrome.scripting.ScriptInjection<unknown[], unknown>) => Promise<unknown> }

/**
 * Injects the moment-pictures script into the asking Twitch tab, in the frame
 * that asked, in the extension's isolated world, so Pulse can hand it empty
 * picture slots. Nothing is injected while Moment pictures is off in Settings.
 *
 * Same shape as the Supporter card's script: the file is fixed here, and the
 * message carries nothing a page could steer.
 */
export async function injectMomentFrames(
  scripting: Scripting,
  sender: chrome.runtime.MessageSender,
  enabled: () => Promise<boolean> = getMomentPicturesEnabled,
): Promise<boolean> {
  const tabId = sender.tab?.id
  if (typeof tabId !== 'number' || tabId < 0) return false
  if (!(await enabled().catch(() => false))) return false
  try {
    await scripting.executeScript({ target: { tabId, frameIds: [sender.frameId ?? 0] }, world: 'ISOLATED', files: [MOMENT_FRAMES_SCRIPT_FILE] })
    return true
  } catch {
    return false
  }
}
