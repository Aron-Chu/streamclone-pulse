import { apiClient } from './apiClient'
import type { DiscoveryMoment } from './discoveryMoments'

/** Selected-only hydration, never a nearby/lead-moment substitution or a history poll. */
export async function loadExactMomentRecap(moment: DiscoveryMoment, signal: AbortSignal): Promise<Partial<DiscoveryMoment> | null> {
  const { data } = await apiClient<{
    login?: string; streamId?: string; topMoments?: Array<{
      offsetSeconds?: number; publicMomentId?: string; reasons?: string[];
      topEmotes?: Array<{ code?: string; count?: number; provider?: string; imageUrl?: string }>;
    }>;
  }>(`/v1/portal/analytics/streams/${encodeURIComponent(moment.streamId)}/recap`,
    { signal, timeoutMs: 8000, maxResponseBytes: 512 * 1024 })
  if (data?.login?.toLowerCase() !== moment.login || data.streamId !== moment.streamId || !Array.isArray(data.topMoments)) return null
  const matches = data.topMoments.filter(row => row.offsetSeconds === moment.offsetSeconds
    && (!moment.publicMomentId || row.publicMomentId === moment.publicMomentId))
  if (matches.length !== 1) return null
  const row = matches[0]!
  const reasons = Array.isArray(row.reasons) ? row.reasons : []
  const label = reasons.some(reason => typeof reason === 'string' && (reason.includes('emote_spike') || reason === 'seventv_spike')) ? 'Emote spike'
    : reasons.includes('chat_spike') ? 'Chat spike' : 'Measured reaction'
  const topEmotes = Array.isArray(row.topEmotes) ? row.topEmotes.slice(0, 5).flatMap(emote => {
    if (typeof emote.code !== 'string' || !emote.code || emote.code.length > 100) return []
    return [{ name: emote.code, provider: typeof emote.provider === 'string' ? emote.provider : undefined,
      imageUrl: typeof emote.imageUrl === 'string' ? emote.imageUrl : undefined,
      count: typeof emote.count === 'number' && Number.isFinite(emote.count) && emote.count >= 0 ? emote.count : undefined }]
  }) : []
  // Recap aggregate counts have a different contract from minute rates. Do not relabel them /min.
  return { label, topEmotes }
}
