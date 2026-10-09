export type SupporterAccountAction = 'status' | 'start' | 'poll' | 'cancel' | 'disconnect'
export type SupporterCosmetics = { enabled: boolean; finish: 'glass' | 'etched' | 'halo' }
export type SupporterFinish = SupporterCosmetics['finish']

/**
 * Non-secret storage keys whose changes tell open surfaces to re-read through
 * the worker. Neither carries an account ID, credential or projection.
 */
export const ACCOUNT_REVISION_KEY = 'pulseAccountRevision'
export const SUPPORTER_REVISION_KEY = 'pulseSupporterRevision'

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
      /** Whether the server would open Checkout for this account now. */
      checkoutEnabled?: boolean
      /** Server capability; absent on older deployments. Never opens Checkout itself. */
      installationAccountsEnabled?: boolean
      /** `twitch`: created by Continue with Twitch. `email`: an invited tester's account. */
      accountKind?: 'email' | 'installation' | 'twitch'
      restoreEligible?: boolean
    }

/**
 * Whether this membership unlocks the Supporter cosmetics: a verified active or
 * grace membership with the banner and finish features. One rule for the finish
 * controls, the worker's appearance reply and emote rain, so no surface can
 * grant a perk another one withholds. Presentation only; the BFF still
 * authorizes every paid mutation.
 */
export function supporterPerksAllowed(entitlement: SupporterEntitlement | null | undefined): boolean {
  return entitlement?.state === 'ready'
    && (entitlement.status === 'active' || entitlement.status === 'grace')
    && entitlement.features.includes('supporter.banner.v1')
    && entitlement.features.includes('supporter.finish.v1')
}

/** Safe settings projection. Bearer, refresh and polling secrets never belong here. */
export type SupporterAccountState =
  | { state: 'signed_out' | 'denied' | 'expired' | 'relink_required' }
  /** `linked` means this extension kept its connection and only renewal is waiting. */
  | { state: 'unavailable'; reason: Exclude<SupporterUnavailableReason, 'environment_mismatch'>; linked?: true }
  | { state: 'error'; revocationPending?: boolean }
  | { state: 'pending'; code: string; expiresAt: string; retryAfterSeconds: number }
  | { state: 'linked'; accountId: string; expiresAt: string }

/**
 * Worker-owned purchase state: provider URLs and all credentials stay private.
 * With Twitch sign-in on, `sign_in_required` means no signed-in account,
 * `step_up_required` that managing the subscription needs a Twitch check from
 * the last 10 minutes, and `wrong_account` that the Twitch account in that
 * check is not this account's.
 */
export type SupporterBillingState =
  | { state: 'idle' | 'fallback' | 'closed' | 'active' | 'expired' | 'review' | 'unavailable' | 'error' | 'reconnect_required' | 'sign_in_required' | 'step_up_required' | 'wrong_account' }
  | { state: 'waiting' | 'confirming' | 'still_confirming'; attemptId?: string; automaticPolling?: false }
export type SupporterRestoreState =
  | { state: 'idle' | 'fallback' | 'restored' | 'expired' | 'conflict' | 'error' | 'ineligible' }
  | { state: 'unavailable'; reason?: 'connection' | 'membership' | 'membership_invalid' | 'environment_mismatch' }
  | { state: 'pending'; expiresAt: string; comparisonCode: string }
  | { state: 'uncertain' }

export type SupporterDevicesState =
  | { state: 'unavailable' | 'error' | 'revoked' }
  | { state: 'ready'; currentDeviceId: string; nextCursor?: string; devices: Array<{ id: string; label: string; createdAt: string; expiresAt: string; revokedAt?: string }> }
