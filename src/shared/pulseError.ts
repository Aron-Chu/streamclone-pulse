/** Bound worker/UI error strings so overlay copy stays safe and finite. */
export function sanitizePulseErrorMessage(
  raw: unknown,
  fallback = 'fetch_failed',
): string {
  const text =
    raw instanceof Error
      ? raw.message
      : typeof raw === 'string'
        ? raw
        : fallback
  const cleaned = text.replace(/\s+/g, ' ').trim().slice(0, 200)
  return cleaned || fallback
}

/**
 * Overlay error lifecycle:
 * - explicit `error` (including '') wins
 * - a non-null payload with omitted error clears the prior error (recovery)
 * - null payload + omitted error keeps the prior error
 */
export function resolveOverlayErrorState(
  currentError: string | undefined,
  payload: object | null,
  error?: string,
): string | undefined {
  if (error !== undefined) return error
  if (payload) return undefined
  return currentError
}
