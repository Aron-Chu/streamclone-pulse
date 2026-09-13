import { isApiError } from './momentsApiClient'

export function discoveryErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.status === 404) return 'Stored history is not available on this server (HTTP 404).'
    if (error.status === 503) return 'Stored history is temporarily unavailable (HTTP 503). This does not mean this creator has no recorded activity.'
    if (error.kind === 'timeout') return 'The stored-history request timed out. Retry to check again.'
    if (error.kind === 'unreachable') return 'The history server could not be reached. Check your connection and retry.'
    if (error.kind === 'rate_limited') return 'Too many history requests. Wait a moment and retry.'
    return 'Stored history could not be loaded. Retry to check again.'
  }
  return 'The stored-history response could not be verified. Retry to check again.'
}
