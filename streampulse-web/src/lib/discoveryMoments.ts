import { apiClient } from './momentsApiClient'
import { verifiedArchiveArtwork, type ArchiveArtwork } from './archiveArtwork'
import { measurementTimeMs } from './measurementTime'
import { buildAnalyticsHref } from './analyticsLinks'
import { buildVodTimestampUrl, type FigmaMomentRow } from './figmaSessionAnalytics'
import { resolveMomentAtMs, type LiveWireMomentComparison } from './liveWire'
import type { NewsroomStory, NewsroomUpdate } from './newsroom'
import { momentReactionSignal, type MomentReactionSignal } from './momentComparison'
import { resolveEmoteImageUrl } from '@streampulse/pulse-core'
import { preferResolvableEmoteUrl } from './emoteAssetUrl'

export interface DiscoveryMoment {
  key: string
  /** Backend reference for this measured minute; not a distinct UI row/revision identity. */
  publicMomentId?: string
  login: string
  streamId: string
  offsetSeconds: number
  at?: number
  label: string
  displayName?: string
  category?: string
  categoryId?: string
  boxArtUrl?: string
  categoryMetadataRejected?: true
  profileImageUrl?: string
  chatPerMin?: number
  emotesPerMin?: number
  comparison?: LiveWireMomentComparison
  reactionSignal?: MomentReactionSignal
  topEmotes?: FigmaMomentRow['topEmotes']
  vodId?: string
  handoffRef?: string
  storyId?: string
  revision?: number
  /** Allowlisted broadcast thumbnail for display only; never source authority. */
  archiveArtwork?: ArchiveArtwork
  provenance: 'hub' | 'session' | 'saved'
}

const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 220 && !/[\s\u0000-\u001f]/.test(value)
export const validVodId = (value: unknown): value is string => typeof value === 'string' && /^\d{1,30}$/.test(value)
function resolveTopEmotes(emotes: FigmaMomentRow['topEmotes']): FigmaMomentRow['topEmotes'] {
  if (!Array.isArray(emotes)) return undefined
  return emotes.map(emote => {
    const imageUrl = preferResolvableEmoteUrl(emote.imageUrl,
      emote.id ? resolveEmoteImageUrl({ id: emote.id, provider: emote.provider }) || undefined : undefined)
    return { ...emote, imageUrl }
  })
}

export function fromHubMoment(moment: FigmaMomentRow & { archiveArtwork?: ArchiveArtwork }): DiscoveryMoment | null {
  const login = moment.login?.trim().toLowerCase()
  if (!login || !/^[a-z0-9_]{1,25}$/.test(login) || !identifier(moment.streamId) || !Number.isFinite(moment.offsetSeconds) || moment.offsetSeconds < 0) return null
  const publicMomentId = identifier(moment.publicMomentId) ? moment.publicMomentId : undefined
  // Exact stream + source offset identifies one measured minute even when older APIs omit a public ID.
  const key = JSON.stringify([login, moment.streamId, moment.offsetSeconds])
  const artworkVodId = moment.archiveArtwork?.vodId
  const suppliedVodId = typeof moment.vodId === 'string' && moment.vodId !== '' ? moment.vodId : undefined
  const archiveArtwork = typeof artworkVodId === 'string' && /^\d{6,20}$/.test(artworkVodId)
    && (!suppliedVodId || suppliedVodId === artworkVodId)
    ? verifiedArchiveArtwork(moment.archiveArtwork, artworkVodId) : undefined
  return { key, publicMomentId, login, streamId: moment.streamId, offsetSeconds: moment.offsetSeconds,
    at: resolveMomentAtMs(moment.at) ?? undefined, label: moment.label || 'Measured reaction', displayName: moment.displayName,
    category: moment.category, categoryId: moment.categoryId, boxArtUrl: moment.boxArtUrl,
    categoryMetadataRejected: moment.categoryMetadataRejected,
    profileImageUrl: moment.profileImageUrl, chatPerMin: moment.chatPerMin,
    emotesPerMin: moment.emotesPerMin, comparison: moment.comparison, reactionSignal: momentReactionSignal(moment.kind),
    topEmotes: resolveTopEmotes(moment.topEmotes),
    vodId: validVodId(moment.vodId) ? moment.vodId : undefined, handoffRef: moment.handoffRef, archiveArtwork, provenance: 'hub' }
}

export function fromNewsroomUpdate(story: NewsroomStory, update: NewsroomUpdate): DiscoveryMoment | null {
  if (update.momentRef.streamId !== story.streamId) return null
  const moment = fromHubMoment({ login: story.login, streamId: story.streamId,
    publicMomentId: update.momentRef.publicMomentId, offsetSeconds: update.momentRef.offsetSeconds,
    at: update.momentRef.occurrenceAt, label: update.headline, kind: update.signal, displayName: story.displayName,
    profileImageUrl: story.profileImageUrl, category: update.category, categoryId: update.categoryId,
    boxArtUrl: update.boxArtUrl, categoryMetadataRejected: update.categoryMetadataRejected,
    comparison: update.comparison,
    chatPerMin: update.comparison.chat.currentPerMin, emotesPerMin: update.comparison.emotes.currentPerMin,
    topEmotes: update.topEmotes, vodId: update.vodId })
  return moment ? { ...moment, storyId: story.id, revision: update.revision, provenance: 'session' } : null
}

export function discoveryMomentHref(moment: DiscoveryMoment): string {
  const query = new URLSearchParams({ view: moment.storyId ? 'sessions' : 'recent', login: moment.login,
    stream: moment.streamId, offset: String(moment.offsetSeconds) })
  if (moment.publicMomentId) query.set('moment', moment.publicMomentId)
  if (moment.storyId) query.set('story', moment.storyId)
  return `/analytics/moments?${query}`
}
export function discoveryAnalyticsHref(moment: DiscoveryMoment): string {
  return buildAnalyticsHref({ login: moment.login, streamId: moment.streamId, offsetSeconds: moment.offsetSeconds })
}
export function uniqueDiscoveryMoments(moments: DiscoveryMoment[]): DiscoveryMoment[] {
  const unique = new Map<string, DiscoveryMoment>()
  for (const moment of moments) {
    const previous = unique.get(moment.key)
    if (!previous || (moment.revision ?? 0) >= (previous.revision ?? 0)) unique.set(moment.key, moment)
  }
  return [...unique.values()].sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || a.key.localeCompare(b.key))
}

export interface CheckedMomentSource { vodHref: string | null; vodOffsetSeconds?: number; archiveArtwork?: import('./archiveArtwork').ArchiveArtwork; handoffRef?: string; liveHref: string | null; liveExpiresAt?: number; occurrenceAt?: number; displayName?: string; category?: string; reason: string }
/** One selected-object read. Never remap an old stream onto the current broadcast. */
export async function checkMomentSource(moment: DiscoveryMoment, signal: AbortSignal, refreshHandoff = false): Promise<CheckedMomentSource> {
  const { data } = await apiClient<{ channel?: string; vodId?: string; vodAlignSeconds?: number; vodArtwork?: unknown;
    vodDurationSeconds?: number; vodTiming?: { state?: string };
    handoffRef?: string;
    availability?: { vodId?: string; vodState?: string };
    stream?: { streamId?: string; channel?: string; login?: string; displayName?: string; category?: string; startedAt?: string; vodId?: string; lifecycleState?: string; lifecycleObservedAt?: string } }>(
    `/v1/portal/analytics/streams/${encodeURIComponent(moment.streamId)}${refreshHandoff ? `?momentOffsetSeconds=${encodeURIComponent(String(moment.offsetSeconds))}` : ''}`,
    { signal, timeoutMs: 8000, cache: refreshHandoff ? 'no-store' : undefined })
  const stream = data.stream
  const suppliedLogins = [data.channel, stream?.channel, stream?.login].filter(login => login != null && login !== '')
  if (stream?.streamId !== moment.streamId || suppliedLogins.length === 0
    || !suppliedLogins.every(login => typeof login === 'string' && login.toLowerCase() === moment.login)) {
    return { vodHref: null, liveHref: null, reason: 'Source identity could not be confirmed. No substitute stream was selected.' }
  }
  const suppliedIds = [data.vodId, stream.vodId, data.availability?.vodId].filter(id => id != null && id !== '')
  const consistentIds = suppliedIds.length > 0 && suppliedIds.every(id => validVodId(id) && id === suppliedIds[0])
  const vodId = consistentIds ? suppliedIds[0] : undefined
  // Explicit zero is valid; missing timing, a failed recheck, or an implausible
  // delta is not. Do not clamp a detection before the archive to an unrelated
  // frame at 0s. The backend's observed duration also bounds growing archives.
  const alignedOffset = typeof data.vodAlignSeconds === 'number' && Number.isFinite(data.vodAlignSeconds)
    && Math.abs(data.vodAlignSeconds) <= 6 * 60 * 60
    && data.vodTiming?.state === 'verified'
    ? data.vodAlignSeconds + moment.offsetSeconds : undefined
  const durationValid = typeof data.vodDurationSeconds === 'number'
    && Number.isFinite(data.vodDurationSeconds) && data.vodDurationSeconds > 0
  const outsideArchive = alignedOffset !== undefined && (alignedOffset < 0 || (
    data.vodDurationSeconds !== undefined && durationValid && alignedOffset >= data.vodDurationSeconds))
  const vodOffsetSeconds = alignedOffset !== undefined && Number.isFinite(alignedOffset)
    && durationValid && !outsideArchive ? Math.floor(alignedOffset) : undefined
  const vodHref = validVodId(vodId) && vodOffsetSeconds !== undefined
    ? (vodOffsetSeconds === 0 ? `https://www.twitch.tv/videos/${vodId}?t=0s` : buildVodTimestampUrl(vodId, vodOffsetSeconds)) : null
  const observed = Date.parse(stream.lifecycleObservedAt ?? '')
  const freshLive = stream.lifecycleState === 'confirmed_live' && observed <= Date.now() && Date.now() - observed <= 120_000
  const unavailableReasons: Record<string, string> = {
    pending_live: 'The API is waiting for this broadcast’s archive. No timestamped replay is confirmed yet; you can save the detection now.',
    resolving: 'The API is resolving this broadcast’s VOD. Save the detection and recheck its source later.',
    request_failed: 'The archive lookup failed. Recheck the source; no replacement broadcast was selected.',
    unavailable: 'The API reports this broadcast’s archive unavailable. Detection evidence can still be saved.',
  }
  const startedAt = measurementTimeMs(stream.startedAt)
  const occurrenceAt = startedAt == null ? undefined : measurementTimeMs(startedAt + moment.offsetSeconds * 1000) ?? undefined
  const displayName = typeof stream.displayName === 'string' && stream.displayName.length <= 100 && !/[\u0000-\u001f]/.test(stream.displayName) ? stream.displayName : undefined
  const category = typeof stream.category === 'string' && stream.category.length <= 150 && !/[\u0000-\u001f]/.test(stream.category) ? stream.category : undefined
  return { vodHref, vodOffsetSeconds, occurrenceAt, displayName, category, archiveArtwork: vodHref ? verifiedArchiveArtwork(data.vodArtwork, vodId) : undefined,
    // Saved records deliberately omit transport capabilities. Accept a refreshed
    // reference only from the offset-scoped exact-source response, and only when
    // that same response proves a usable VOD mapping.
    handoffRef: refreshHandoff && vodHref && typeof data.handoffRef === 'string' ? data.handoffRef : undefined,
    liveExpiresAt: freshLive ? observed + 120_000 : undefined, liveHref: freshLive ? `https://www.twitch.tv/${moment.login}` : null,
    reason: vodHref ? 'VOD mapping checked. External playback has not been verified.'
      : suppliedIds.length > 0 && !consistentIds ? 'The API returned conflicting archive identities. No replay link was substituted; recheck the source.'
      : outsideArchive ? 'This detection is outside the archive’s currently available time range. No different frame was substituted; save it or recheck later.'
      : vodId && !durationValid ? 'The archive’s available duration could not be confirmed. Recheck the source; no approximate replay link was substituted.'
      : vodId && vodOffsetSeconds === undefined ? 'An archive is linked, but its timestamp alignment is not verified. No approximate replay link was substituted.'
      : unavailableReasons[data.availability?.vodState ?? ''] ?? 'No exact VOD link confirmed. Analytics and saved evidence remain available.' }
}
