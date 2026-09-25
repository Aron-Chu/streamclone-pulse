/**
 * Background messages can fail without throwing when the sender is no longer
 * authorized or an extension context was invalidated. Keep that envelope
 * handling in one place so callers cannot mistake a failure for empty data.
 */
/** Worded for any surface: the overlay panel shows this too, not only settings. */
export const EXTENSION_RECONNECT_MESSAGE = 'Extension disconnected. Reload this page to reconnect.'

export function backgroundErrorCode(response: unknown): string | null {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return 'unexpected_response'
  const record = response as Record<string, unknown>
  if (record.ok === false) {
    return typeof record.error === 'string' && record.error.trim()
      ? record.error.trim()
      : 'request_failed'
  }
  if (typeof record.error === 'string' && record.error.trim()) return record.error.trim()
  return null
}

/** Return a stable UI message without exposing backend URLs or raw errors. */
export function backgroundErrorMessage(response: unknown, fallback: string): string | null {
  const code = backgroundErrorCode(response)
  if (!code) return null
  if (/unauthorized_sender|device_authorization_required/i.test(code)) {
    return 'This action is available from the secure settings page.'
  }
  if (/extension[ _]context[ _]invalidated|receiving end does not exist/i.test(code)) {
    return EXTENSION_RECONNECT_MESSAGE
  }
  return fallback
}
