/** Map raw extension/BFF error codes to user-facing copy. */
export function formatPulseApiError(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null
  const code = raw.trim().toLowerCase()
  switch (code) {
    case 'unauthorized':
    case 'auth_required':
    case 'vod_hint_auth_required':
    case 'backfill_auth_required':
    case 'archive_candidate_auth_required':
      return 'This hosted action needs an authenticated extension session. Live analytics and verified VOD navigation remain available.'
    case 'archive_candidate_unavailable':
      return 'Verified archive discovery is temporarily unavailable. Live analytics remain available; try again after the stream is archived.'
    case 'pulse_archive_identity_mismatch':
      return 'The archive did not match this exact broadcast, so it was not opened. Try again after Twitch finishes publishing the VOD.'
    case 'background_timeout':
      return 'The extension service worker did not respond in time. Reload the extension, then try again.'
    case 'background_unreachable':
      return 'The extension service worker is unavailable. Reload the extension, then try again.'
    case 'backfill_at_capacity':
    case 'pulse_backfill_at_capacity':
      return 'Missed-moments backfill is at capacity on the server. Live tracking still works — try again in a few minutes.'
    case 'extension_watch_disabled':
      return 'Hosted StreamPulse manages IRC tracking — use Protect on a channel instead of Track.'
    default:
      return raw.trim()
  }
}
