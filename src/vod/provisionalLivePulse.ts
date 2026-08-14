import type { PulsePayload } from '../shared/messages.ts'
import type { ExtensionVodPulseResponse } from '../types/vodPulseTypes.ts'

function stableVodLogin(raw?: string | null): string | undefined {
  const login = raw?.trim().toLowerCase()
  if (!login || login.startsWith('__vod__:')) return undefined
  return login
}

export function shouldAttemptProvisionalLivePulse(
  vodPulse: ExtensionVodPulseResponse | null | undefined,
  owner?: { provenLogin?: string | null; candidateLogin?: string | null },
): boolean {
  if (vodPulse?.coverageStatus !== 'missing') return false
  const proven = stableVodLogin(vodPulse.channelLogin) ?? stableVodLogin(owner?.provenLogin)
  if (!proven) return false
  const candidate = stableVodLogin(owner?.candidateLogin)
  return !candidate || candidate === proven
}

export function resolveProvisionalVodStreamTarget(
  vodPulse: ExtensionVodPulseResponse | null | undefined,
  hints?: { channelLogin?: string; streamId?: string },
): { login: string; streamId: string } | null {
  if (!vodPulse || !shouldAttemptProvisionalLivePulse(vodPulse, {
    candidateLogin: hints?.channelLogin,
  })) {
    return null
  }
  const login = stableVodLogin(vodPulse.channelLogin)
  const streamId = vodPulse.streamId?.trim() || ''
  const hintedStreamId = hints?.streamId?.trim() || ''
  if (!login || !streamId || (hintedStreamId && hintedStreamId !== streamId)) return null
  return { login, streamId }
}

export function provisionalPulseMatchesVod(
  vodPulse: ExtensionVodPulseResponse | null | undefined,
  provisional: PulsePayload | null | undefined,
): boolean {
  if (!provisional) return false
  const proven = stableVodLogin(vodPulse?.channelLogin)
  const gotLogin = stableVodLogin(provisional.login)
  const wantedStream = vodPulse?.streamId?.trim()
  const gotStream = provisional.streamId?.trim()
  if (!proven || gotLogin !== proven || !gotStream) return false
  return !wantedStream || wantedStream === gotStream
}
