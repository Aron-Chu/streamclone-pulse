import type {
  BackgroundRequest,
  BackgroundResponse,
  PulseUpdateMessage,
  VodPulseUpdateMessage,
} from '../shared/messages.ts'

let contextInvalidatedListener: (() => void) | null = null

/**
 * An orphaned content script (the extension updated, reloaded or was disabled
 * while this tab stayed open) can never reach the worker again. The listener
 * runs whenever a bridge call or check finds the context gone, so the entry
 * can stop polling and ask for a reload instead of leaving a frozen chart that
 * still looks live. It must be idempotent.
 */
export function onContextInvalidated(listener: () => void): void {
  contextInvalidatedListener = listener
}

/** Cheap enough for timers and visibility events: an idle tab makes no bridge calls. */
export function contextInvalidated(): boolean {
  let gone = true
  try {
    gone = !chrome.runtime?.id
  } catch {
    // An orphaned context may throw on access; it is gone either way.
  }
  if (gone && contextInvalidatedListener) queueMicrotask(contextInvalidatedListener)
  return gone
}

function invalidated(): { ok: boolean; error: string } {
  contextInvalidated()
  return { ok: false, error: 'extension_context_invalidated' }
}

export function sendBackgroundMessage<T extends BackgroundRequest>(
  message: T,
): Promise<BackgroundResponse | PulseUpdateMessage | VodPulseUpdateMessage | { ok: boolean; error?: string }> {
  try {
    if (!chrome.runtime?.id) {
      return Promise.resolve(invalidated())
    }
    return chrome.runtime.sendMessage(message).catch((err: unknown) => {
      const text = err instanceof Error ? err.message : String(err ?? '')
      if (/Extension context invalidated|Receiving end does not exist/i.test(text)) {
        return invalidated()
      }
      throw err
    })
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err ?? '')
    if (/Extension context invalidated/i.test(text)) {
      return Promise.resolve(invalidated())
    }
    throw err
  }
}

export function onPulseUpdate(
  listener: (message: PulseUpdateMessage) => void,
): () => void {
  const handler = (message: PulseUpdateMessage) => {
    if (message?.type === 'PULSE_UPDATE') {
      listener(message)
    }
  }
  chrome.runtime.onMessage.addListener(handler)
  return () => chrome.runtime.onMessage.removeListener(handler)
}

export function onVodPulseUpdate(
  listener: (message: VodPulseUpdateMessage) => void,
): () => void {
  const handler = (message: VodPulseUpdateMessage) => {
    if (message?.type === 'VOD_PULSE_UPDATE') {
      listener(message)
    }
  }
  chrome.runtime.onMessage.addListener(handler)
  return () => chrome.runtime.onMessage.removeListener(handler)
}
