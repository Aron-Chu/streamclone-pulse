import type { BackgroundRequest, BackgroundResponse, PulseUpdateMessage } from '../shared/messages.ts'

export function sendBackgroundMessage<T extends BackgroundRequest>(
  message: T,
): Promise<BackgroundResponse | PulseUpdateMessage | { ok: boolean }> {
  return chrome.runtime.sendMessage(message)
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
