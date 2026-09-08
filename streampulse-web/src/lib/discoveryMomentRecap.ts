import { apiClient } from './momentsApiClient'
import { resolveEmoteImageUrl } from '@streampulse/pulse-core'
import type { DiscoveryMoment } from './discoveryMoments'
import { preferResolvableEmoteUrl } from './emoteAssetUrl'

function normalizedProvider(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase()
  return normalized === 'seventv' ? '7tv' : normalized
}

export function mergeMomentTopEmotes(
  supplied: DiscoveryMoment['topEmotes'],
  recap: DiscoveryMoment['topEmotes'],
): DiscoveryMoment['topEmotes'] {
  if (!supplied?.length) return recap
  if (!recap?.length) return supplied
  return supplied.map((emote) => {
    const provider = normalizedProvider(emote.provider)
    const match = recap.find((candidate) => (
      Boolean(emote.id && candidate.id && emote.id === candidate.id)
      || (candidate.name.trim().toLowerCase() === emote.name.trim().toLowerCase()
        && (!provider || !candidate.provider || normalizedProvider(candidate.provider) === provider))
    ))
    if (!match) return emote
    return {
      ...emote,
      id: emote.id ?? match.id,
      provider: emote.provider ?? match.provider,
      count: emote.count ?? match.count,
      imageUrl: preferResolvableEmoteUrl(emote.imageUrl, match.imageUrl),
    }
  })
}

export function momentNeedsExactRecap(moment: DiscoveryMoment): boolean {
  return moment.chatPerMin == null || moment.emotesPerMin == null
    || !moment.topEmotes?.length || moment.topEmotes.some(emote => !emote.imageUrl)
}

export function mergeExactMomentRecap(
  moment: DiscoveryMoment,
  recap: Partial<DiscoveryMoment> | null | undefined,
): DiscoveryMoment {
  if (!recap) return moment
  return {
    ...moment,
    ...recap,
    chatPerMin: moment.chatPerMin ?? recap.chatPerMin,
    emotesPerMin: moment.emotesPerMin ?? recap.emotesPerMin,
    topEmotes: mergeMomentTopEmotes(moment.topEmotes, recap.topEmotes),
  }
}

/** Exact-identity hydration, never a nearby/lead-moment substitution or a history poll. */
export async function loadExactMomentRecap(moment: DiscoveryMoment, signal: AbortSignal): Promise<Partial<DiscoveryMoment> | null> {
  const { data } = await apiClient<{
    login?: string; streamId?: string; topMoments?: Array<{
      offsetSeconds?: number; publicMomentId?: string; reasons?: string[];
      chatPerMin?: number; emotesPerMin?: number;
      topEmotes?: Array<{ id?: string; code?: string; count?: number; provider?: string; imageUrl?: string }>;
    }>;
  }>(`/v1/portal/analytics/streams/${encodeURIComponent(moment.streamId)}/recap`,
    { signal, timeoutMs: 8000, maxResponseBytes: 512 * 1024 })
  if (data?.login?.toLowerCase() !== moment.login || data.streamId !== moment.streamId || !Array.isArray(data.topMoments)) return null
  const offsetMatches = data.topMoments.filter(row => row.offsetSeconds === moment.offsetSeconds)
  // Older recap projections do not expose the public measured-minute reference.
  // The immutable stream + exact offset remains a valid identity only when it
  // selects one row. A supplied but different public ID still fails closed.
  const exactIdMatches = moment.publicMomentId
    ? offsetMatches.filter(row => row.publicMomentId === moment.publicMomentId)
    : offsetMatches
  const matches = moment.publicMomentId && exactIdMatches.length === 0
    && offsetMatches.length === 1 && !offsetMatches[0]?.publicMomentId
    ? offsetMatches
    : exactIdMatches
  if (matches.length !== 1) return null
  const row = matches[0]!
  const reasons = Array.isArray(row.reasons) ? row.reasons : []
  const label = reasons.some(reason => typeof reason === 'string' && (reason.includes('emote_spike') || reason === 'seventv_spike')) ? 'Emote spike'
    : reasons.includes('chat_spike') ? 'Chat spike' : 'Measured reaction'
  const topEmotes = Array.isArray(row.topEmotes) ? row.topEmotes.slice(0, 5).flatMap(emote => {
    if (typeof emote.code !== 'string' || !emote.code || emote.code.length > 100) return []
    const id = typeof emote.id === 'string' && emote.id.length <= 100 ? emote.id.trim() : undefined
    const provider = typeof emote.provider === 'string' ? emote.provider : undefined
    const imageUrl = preferResolvableEmoteUrl(typeof emote.imageUrl === 'string' ? emote.imageUrl : undefined,
      id ? resolveEmoteImageUrl({ id, provider }) || undefined : undefined)
    return [{ name: emote.code, id, provider, imageUrl,
      count: typeof emote.count === 'number' && Number.isFinite(emote.count) && emote.count >= 0 ? emote.count : undefined }]
  }) : []
  // Only explicit rate fields are reusable. Legacy chatCount/emoteCount remain
  // intentionally ignored because their unit was not part of that contract.
  const chatPerMin = typeof row.chatPerMin === 'number' && Number.isFinite(row.chatPerMin) && row.chatPerMin >= 0 ? row.chatPerMin : undefined
  const emotesPerMin = typeof row.emotesPerMin === 'number' && Number.isFinite(row.emotesPerMin) && row.emotesPerMin >= 0 ? row.emotesPerMin : undefined
  return { label, topEmotes, ...(chatPerMin == null ? {} : { chatPerMin }), ...(emotesPerMin == null ? {} : { emotesPerMin }) }
}
