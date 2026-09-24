export type SupporterAccountAction = 'status' | 'start' | 'poll' | 'cancel' | 'disconnect'
export type SupporterCosmetics = { enabled: boolean; finish: 'glass' | 'etched' | 'halo' }

/** Server-reconciled entitlement statuses, mirrored from the BFF projection. */
export type SupporterStatus = 'none' | 'active' | 'grace' | 'pending' | 'expired' | 'review'

/**
 * Safe entitlement projection for settings surfaces.
 *
 * Deliberately carries no provider identifiers and no local override: a client
 * cannot promote itself to active by editing storage, because every paid
 * mutation is re-checked server-side.
 */
export type SupporterEntitlement =
  | { state: 'not_linked' | 'unavailable' | 'error' }
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
  | { state: 'unavailable' | 'signed_out' | 'denied' | 'expired' | 'relink_required' }
  | { state: 'error'; revocationPending?: boolean }
  | { state: 'pending'; code: string; expiresAt: string; retryAfterSeconds: number }
  | { state: 'linked'; accountId: string; expiresAt: string }
