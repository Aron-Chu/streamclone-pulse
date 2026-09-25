export type SupporterAccountAction = 'status' | 'start' | 'poll' | 'cancel' | 'disconnect'
export type SupporterCosmetics = { enabled: boolean; finish: 'glass' | 'etched' | 'halo' }

/** Server-reconciled entitlement statuses, mirrored from the BFF projection. */
export type SupporterStatus = 'none' | 'active' | 'grace' | 'pending' | 'expired' | 'review'

/**
 * Why the account service cannot be used right now. Each needs different copy:
 * a missing deployment is not an outage, and a billing environment this build
 * does not honour is neither.
 */
export type SupporterUnavailableReason = 'not_deployed' | 'temporarily_unavailable' | 'environment_mismatch'

/**
 * Safe entitlement projection for settings surfaces.
 *
 * Deliberately carries no provider identifiers and no local override: a client
 * cannot promote itself to active by editing storage, because every paid
 * mutation is re-checked server-side.
 */
export type SupporterEntitlement =
  | { state: 'not_linked' | 'error' }
  | { state: 'unavailable'; reason: SupporterUnavailableReason }
  | {
      state: 'ready'
      status: SupporterStatus
      accessUntil?: string
      validForMs?: number
      supportPeriods: number
      features: string[]
      cosmetics?: SupporterCosmetics
    }

/** Safe settings projection. Bearer, refresh and polling secrets never belong here. */
export type SupporterAccountState =
  | { state: 'signed_out' | 'denied' | 'expired' | 'relink_required' }
  /** `linked` means this extension kept its connection and only renewal is waiting. */
  | { state: 'unavailable'; reason: Exclude<SupporterUnavailableReason, 'environment_mismatch'>; linked?: true }
  | { state: 'error'; revocationPending?: boolean }
  | { state: 'pending'; code: string; expiresAt: string; retryAfterSeconds: number }
  | { state: 'linked'; accountId: string; expiresAt: string }
