import type {
  BackgroundRequest,
  BackgroundResponse,
  PulseUpdateMessage,
  VodPulseUpdateMessage,
} from '../shared/messages.ts'

export function sendBackgroundMessage<T extends BackgroundRequest>(
  message: T,
): Promise<BackgroundResponse | PulseUpdateMessage | VodPulseUpdateMessage | { ok: boolean }> {
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
