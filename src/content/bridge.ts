import type {
  BackgroundRequest,
  BackgroundResponse,
  PulseUpdateMessage,
  VodPulseUpdateMessage,
} from '../shared/messages.ts'

export function sendBackgroundMessage<T extends BackgroundRequest>(
  message: T,
): Promise<BackgroundResponse | PulseUpdateMessage | VodPulseUpdateMessage | { ok: boolean }> {
  try {
    if (!chrome.runtime?.id) {
      return Promise.resolve({ ok: false })
    }
    return chrome.runtime.sendMessage(message).catch((err: unknown) => {
      const text = err instanceof Error ? err.message : String(err ?? '')
      if (/Extension context invalidated|Receiving end does not exist/i.test(text)) {
        return { ok: false }
      }
      throw err
    })
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err ?? '')
    if (/Extension context invalidated/i.test(text)) {
      return Promise.resolve({ ok: false })
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
