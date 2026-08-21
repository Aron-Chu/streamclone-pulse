import type { PulsePayload } from '../shared/messages.ts'
import type { ExtensionVodPulseResponse } from '../types/vodPulseTypes.ts'

function stableVodLogin(raw?: string | null): string | undefined {
  const login = raw?.trim().toLowerCase()
  if (!login || login.startsWith('__vod__:')) return undefined
  return login
}

export interface ProvisionalVodOwnerHints {
  /** URL `/{login}/videos/{id}` or a vodId-scoped D1 bridge — not a page scrape. */
  provenLogin?: string | null
  /** Scraped or session login. May only confirm a proven owner, never establish one. */
  candidateLogin?: string | null
}

/** Missing VOD coverage may reuse analytics only for this VOD’s proven owner. */
export function shouldAttemptProvisionalLivePulse(
  vodPulse: ExtensionVodPulseResponse | null | undefined,
  owner?: ProvisionalVodOwnerHints,
): boolean {
  const status = vodPulse?.coverageStatus
  // A provisional chart is only an escape hatch for an unindexed VOD. Do not
  // replace an explicit syncing/error state with channel analytics.
  if (status !== 'missing') return false
  const proven = stableVodLogin(vodPulse?.channelLogin) ?? stableVodLogin(owner?.provenLogin)
  if (!proven) return false
  const candidate = stableVodLogin(owner?.candidateLogin)
  if (candidate && candidate !== proven) return false
  return true
}

export function resolveProvisionalVodStreamTarget(
  vodPulse: ExtensionVodPulseResponse | null | undefined,
  hints?: { channelLogin?: string; streamId?: string },
): { login: string; streamId: string } | null {
  if (!vodPulse) return null
  if (!shouldAttemptProvisionalLivePulse(vodPulse, { candidateLogin: hints?.channelLogin })) {
    return null
  }
  const login = stableVodLogin(vodPulse.channelLogin)
  if (!login) return null
  const streamId = vodPulse.streamId?.trim() || ''
  const hintedStreamId = hints?.streamId?.trim() || ''
  if (hintedStreamId && streamId && hintedStreamId !== streamId) return null
  if (!streamId) return null
  return { login, streamId }
}

export function provisionalPulseMatchesVod(
  vodPulse: ExtensionVodPulseResponse | null | undefined,
  provisional: PulsePayload | null | undefined,
): boolean {
  if (!provisional) return false
  const proven = stableVodLogin(vodPulse?.channelLogin)
  if (!proven || stableVodLogin(provisional.login) !== proven) return false
  const wantedStream = vodPulse?.streamId?.trim()
  const gotStream = provisional.streamId?.trim()
  if (!gotStream) return false
  if (wantedStream && wantedStream !== gotStream) return false
  return true
}
