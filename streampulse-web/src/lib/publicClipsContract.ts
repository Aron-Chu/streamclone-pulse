/**
 * Public published-clip read contract (P3).
 * Must NOT use beta-key `/v1/pulse/clips` candidate queue.
 * Only server-approved, playback-verified items may render.
 */

export interface HubPublicClipReaction {
  name: string
  provider?: string
  imageUrl?: string
}

export interface HubPublicClip {
  id: string
  login: string
  displayName?: string
  title: string
  thumbnailUrl: string
  playbackUrl: string
  durationSeconds: number
  publishedAt: string
  topReaction?: HubPublicClipReaction
  analyticsHref?: string
  vodHref?: string
}

/** Private / candidate-queue fields that must never appear on public clips. */
const REJECT_PRIVATE_KEYS = [
  'status',
  'candidateId',
  'workerState',
  'betaKey',
  'jobId',
  'renderToken',
  'internalPath',
] as const

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function normalizeHubPublicClip(raw: unknown): HubPublicClip | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id.trim() : ''
  const login = typeof row.login === 'string' ? row.login.trim().toLowerCase() : ''
  const title = typeof row.title === 'string' ? row.title.trim() : ''
  const thumbnailUrl = typeof row.thumbnailUrl === 'string' ? row.thumbnailUrl.trim() : ''
  const playbackUrl = typeof row.playbackUrl === 'string' ? row.playbackUrl.trim() : ''
  const publishedAt = typeof row.publishedAt === 'string' ? row.publishedAt.trim() : ''
  const durationSeconds = Number(row.durationSeconds)
  if (!id || !login || !title || !thumbnailUrl || !playbackUrl || !publishedAt) return null
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null
  if (!isHttpUrl(thumbnailUrl) || !isHttpUrl(playbackUrl)) return null
  // Reject private candidate / job fields if accidentally present.
  for (const key of REJECT_PRIVATE_KEYS) {
    if (key in row) return null
  }
  const reactionRaw = row.topReaction
  let topReaction: HubPublicClipReaction | undefined
  if (reactionRaw && typeof reactionRaw === 'object' && !Array.isArray(reactionRaw)) {
    const r = reactionRaw as Record<string, unknown>
    const name = typeof r.name === 'string' ? r.name.trim() : ''
    if (name) {
      topReaction = {
        name,
        provider: typeof r.provider === 'string' ? r.provider : undefined,
        imageUrl: typeof r.imageUrl === 'string' ? r.imageUrl : undefined,
      }
    }
  } else if (reactionRaw != null) {
    return null
  }
  return {
    id,
    login,
    displayName: typeof row.displayName === 'string' ? row.displayName : undefined,
    title,
    thumbnailUrl,
    playbackUrl,
    durationSeconds,
    publishedAt,
    topReaction,
    analyticsHref: typeof row.analyticsHref === 'string' ? row.analyticsHref : undefined,
    vodHref: typeof row.vodHref === 'string' ? row.vodHref : undefined,
  }
}

export function normalizeHubPublicClips(raw: unknown): HubPublicClip[] {
  if (!Array.isArray(raw)) return []
  const out: HubPublicClip[] = []
  for (const item of raw) {
    const clip = normalizeHubPublicClip(item)
    if (clip) out.push(clip)
  }
  return out
}
