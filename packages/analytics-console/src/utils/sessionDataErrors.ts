export type SessionDataErrorKind =
  | 'session_identity_mismatch'
  | 'timeline_integrity_error'
  | 'heatmap_integrity_error'

export type SessionDataErrorDetails = {
  requestedStreamId: string
  returnedStreamId?: string
  requestedStartedAt?: string
  returnedStartedAt?: string
  duplicateOffsetCount?: number
  outOfWindowCount?: number
  invalidPointCount?: number
  message?: string
}

export class SessionDataError extends Error {
  readonly kind: SessionDataErrorKind
  readonly details: SessionDataErrorDetails

  constructor(kind: SessionDataErrorKind, details: SessionDataErrorDetails) {
    super(details.message ?? defaultSessionDataErrorMessage(kind))
    this.name = 'SessionDataError'
    this.kind = kind
    this.details = details
  }
}

export class SessionIdentityMismatchError extends SessionDataError {
  constructor(details: SessionDataErrorDetails) {
    super('session_identity_mismatch', details)
    this.name = 'SessionIdentityMismatchError'
  }
}

export class TimelineIntegrityError extends SessionDataError {
  constructor(details: SessionDataErrorDetails) {
    super('timeline_integrity_error', details)
    this.name = 'TimelineIntegrityError'
  }
}

export class HeatmapIntegrityError extends SessionDataError {
  constructor(details: SessionDataErrorDetails) {
    super('heatmap_integrity_error', details)
    this.name = 'HeatmapIntegrityError'
  }
}

export function isSessionDataError(value: unknown): value is SessionDataError {
  return value instanceof SessionDataError
    || (
      typeof value === 'object'
      && value !== null
      && (value as { kind?: unknown }).kind !== undefined
      && (
        (value as { kind?: unknown }).kind === 'session_identity_mismatch'
        || (value as { kind?: unknown }).kind === 'timeline_integrity_error'
        || (value as { kind?: unknown }).kind === 'heatmap_integrity_error'
      )
    )
}

function defaultSessionDataErrorMessage(kind: SessionDataErrorKind): string {
  if (kind === 'session_identity_mismatch') {
    return 'Session analytics are temporarily unavailable because the server returned a different broadcast.'
  }
  if (kind === 'heatmap_integrity_error') {
    return 'Moment ranking is temporarily unavailable because the server returned cross-session data.'
  }
  return 'Timeline data is being repaired.'
}
