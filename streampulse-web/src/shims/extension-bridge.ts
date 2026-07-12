/** Landing-page stub — extension UI must not call the MV3 service worker on streampulse.stream. */
export function sendBackgroundMessage(
  _message: unknown,
): Promise<Record<string, unknown>> {
  return Promise.resolve({ ok: true })
}

export function onPulseUpdate(_listener: (message: unknown) => void): () => void {
  return () => undefined
}

export function onVodPulseUpdate(_listener: (message: unknown) => void): () => void {
  return () => undefined
}
