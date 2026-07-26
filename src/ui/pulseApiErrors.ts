/** Map raw extension/BFF error codes to user-facing copy. */
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
      return raw.trim()
  }
}
