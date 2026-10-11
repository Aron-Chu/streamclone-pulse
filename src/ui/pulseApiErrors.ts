import { EXTENSION_RECONNECT_MESSAGE } from '../shared/backgroundResponse.ts'

/**
 * Map raw extension/BFF error codes to user-facing copy. This is an allowlist:
 * anything unknown returns null so callers show their own viewer-language
 * fallback instead of a raw code such as `extension_api_invalid_pulse_payload`.
 */
export function formatPulseApiError(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null
  const code = raw.trim().toLowerCase()
  switch (code) {
    case 'backfill_at_capacity':
    case 'pulse_backfill_at_capacity':
      return 'Missed-moments backfill is at capacity on the server. Live tracking still works — try again in a few minutes.'
    case 'extension_watch_disabled':
      return 'Hosted StreamPulse manages IRC tracking — use Protect on a channel instead of Track.'
    default:
      return raw.trim() === EXTENSION_RECONNECT_MESSAGE ? EXTENSION_RECONNECT_MESSAGE : null
  }
}
