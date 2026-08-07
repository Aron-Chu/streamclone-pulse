import type {
  BackgroundRequest,
  BackgroundResponse,
  PulseUpdateMessage,
  VodPulseUpdateMessage,
} from '../shared/messages.ts'

export interface BackgroundMessageOptions {
  /** Bound UI waits for best-effort requests such as archive discovery. */
  timeoutMs?: number
}

export interface BackgroundMessageFailure {
  ok: false
  error: 'background_timeout' | 'extension_context_invalidated' | 'background_unreachable'
}

const DEFAULT_BACKGROUND_TIMEOUT_MS = 15_000

export function sendBackgroundMessage<T extends BackgroundRequest>(
  message: T,
  options?: BackgroundMessageOptions,
): Promise<BackgroundResponse | PulseUpdateMessage | VodPulseUpdateMessage | { ok: boolean }> {
  try {
    if (!chrome.runtime?.id) {
      return Promise.resolve({ ok: false, error: 'extension_context_invalidated' } satisfies BackgroundMessageFailure)
    }
    const responsePromise = chrome.runtime.sendMessage(message) as Promise<
      BackgroundResponse | PulseUpdateMessage | VodPulseUpdateMessage | { ok: boolean }
    >
    const timeoutMs = options?.timeoutMs && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_BACKGROUND_TIMEOUT_MS
    const boundedResponse = timeoutMs > 0
      ? (() => {
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<BackgroundMessageFailure>(resolve => {
          timer = setTimeout(() => resolve({ ok: false, error: 'background_timeout' }), timeoutMs)
        })
        return Promise.race([responsePromise, timeout]).finally(() => {
          if (timer) clearTimeout(timer)
        })
      })()
      : responsePromise
    return boundedResponse.catch((err: unknown) => {
      const text = err instanceof Error ? err.message : String(err ?? '')
      if (/Extension context invalidated|Receiving end does not exist/i.test(text)) {
        return { ok: false, error: 'extension_context_invalidated' } satisfies BackgroundMessageFailure
      }
      // A missing service worker, browser shutdown, or transient extension
      // transport failure is still a recoverable UI state. Let callers render
      // their retry/error surface instead of rejecting activation and leaving
      // the overlay behind an indefinite loading skeleton.
      return { ok: false, error: 'background_unreachable' } satisfies BackgroundMessageFailure
    })
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err ?? '')
    if (/Extension context invalidated/i.test(text)) {
      return Promise.resolve({ ok: false, error: 'extension_context_invalidated' } satisfies BackgroundMessageFailure)
    }
    return Promise.resolve({ ok: false, error: 'background_unreachable' } satisfies BackgroundMessageFailure)
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
