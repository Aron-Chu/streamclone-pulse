/**
 * Full-timeline window state machine (Overlay P0).
 * "Full" label only after a successful full response with payload provenance.
 */

export type FullTimelineState =
  | 'recent'
  | 'full_loading'
  | 'full_loaded'
  | 'full_error'

export type FullTimelineEvent =
  | { type: 'request_full' }
  | { type: 'full_success' }
  | { type: 'full_failure' }
  | { type: 'reset_to_recent' }

/** Reduce full-timeline state. Invalid transitions fail closed to recent. */
export function reduceFullTimelineState(
  state: FullTimelineState,
  event: FullTimelineEvent,
): FullTimelineState {
  switch (event.type) {
    case 'request_full':
      return 'full_loading'
    case 'full_success':
      return state === 'full_loading' || state === 'full_error' || state === 'full_loaded'
        ? 'full_loaded'
        : 'full_loaded'
    case 'full_failure':
      return state === 'full_loading' || state === 'full_loaded' || state === 'recent'
        ? 'full_error'
        : 'full_error'
    case 'reset_to_recent':
      return 'recent'
    default:
      return state
  }
}

/** UI may label the chart Full only in full_loaded. */
export function isFullTimelineLabelActive(state: FullTimelineState): boolean {
  return state === 'full_loaded'
}

/**
 * A transport/API error must not hide a last-good live panel.
 * Fatal empty-state UI is only when there is no payload to show.
 */
export function shouldHideLiveAnalyticsForError(
  payload: object | null | undefined,
  error: string | null | undefined,
): boolean {
  if (!error) return false
  return !payload
}

export type FullPulseResponseLike = {
  type?: string
  payload?: object | null
  error?: string
}

export type ApplyFullTimelineResult = {
  nextState: FullTimelineState
  payload: object | null
  /** Local warning only — never a fatal overlay error when last-good payload exists. */
  localWarning: string | null
  enteredFull: boolean
}

/**
 * Pure handler for a completed full-window GET_PULSE response.
 * Enter full_loaded only when type is PULSE_UPDATE and payload is present.
 */
export function applyFullTimelineResponse(
  priorState: FullTimelineState,
  response: FullPulseResponseLike,
  lastGoodPayload: object | null,
): ApplyFullTimelineResult {
  const loading = reduceFullTimelineState(priorState, { type: 'request_full' })
  const isUpdate = response.type === 'PULSE_UPDATE'
  const hasPayload = Boolean(isUpdate && response.payload)
  if (hasPayload) {
    return {
      nextState: reduceFullTimelineState(loading, { type: 'full_success' }),
      payload: response.payload as object,
      localWarning: null,
      enteredFull: true,
    }
  }
  const warning =
    typeof response.error === 'string' && response.error.trim()
      ? response.error.trim()
      : 'Could not load full stream chart.'
  return {
    nextState: reduceFullTimelineState(loading, { type: 'full_failure' }),
    payload: lastGoodPayload,
    localWarning: warning,
    enteredFull: false,
  }
}

/**
 * Authoritative Full label for long streams: only when state is full_loaded
 * and coverage/span proves full tracking — never when showing recent fallback.
 */
export function twelveHourFullViewIsAuthoritative(input: {
  fullTimelineState: FullTimelineState
  hasFullStreamCoverage?: boolean
  plottedIsRecentFallback?: boolean
}): boolean {
  if (input.fullTimelineState !== 'full_loaded') return false
  if (input.plottedIsRecentFallback) return false
  if (input.hasFullStreamCoverage === false) return false
  return input.hasFullStreamCoverage === true
}
