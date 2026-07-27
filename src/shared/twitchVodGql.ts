const VOD_ID = /^\d{6,20}$/

export interface GqlVodDiscoveryResult {
  vodId: string | null
  streamId: string | null
  source: 'stream.archiveVideo' | 'videos.archive' | 'page_html' | 'page_script' | null
  gqlErrors: string[]
}

function normalizeId(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return VOD_ID.test(trimmed) ? trimmed : null
}

/** Parse live-stream archiveVideo GQL payload. */
export function parseLiveArchiveVodFromGql(body: {
  data?: {
    user?: {
      stream?: {
        id?: string
        archiveVideo?: { id?: string } | null
      } | null
    } | null
  }
  errors?: Array<{ message?: string }>
}, expectedStreamId?: string | null): GqlVodDiscoveryResult {
  const gqlErrors = (body.errors ?? []).map(error => error.message?.trim()).filter(Boolean) as string[]
  const stream = body.data?.user?.stream
  const streamId = normalizeId(stream?.id) ?? null
  const archiveId = normalizeId(stream?.archiveVideo?.id)
  const expected = normalizeId(expectedStreamId ?? undefined)
  if (!expected) {
    return {
      vodId: null,
      streamId,
      source: null,
      gqlErrors: [...gqlErrors, 'expected_stream_id_required'],
    }
  }
  if (streamId && streamId !== expected) {
    return {
      vodId: null,
      streamId,
      source: null,
      gqlErrors: [...gqlErrors, 'stream_id_mismatch'],
    }
  }
  if (archiveId && streamId && streamId === expected) {
    return { vodId: archiveId, streamId, source: 'stream.archiveVideo', gqlErrors }
  }
  return { vodId: null, streamId, source: null, gqlErrors }
}

type ArchiveVideoNode = {
  id?: string
  broadcastId?: string
  stream?: { id?: string } | null
}

/**
 * Parse videos(type: ARCHIVE) GQL payload.
 * Only accepts an archive when `expectedStreamId` matches the node's broadcast/stream id.
 * Uncorrelated "latest archive" results are rejected.
 */
export function parseArchiveListVodFromGql(
  body: {
    data?: {
      user?: {
        videos?: { edges?: Array<{ node?: ArchiveVideoNode }> }
      } | null
    }
    errors?: Array<{ message?: string }>
  },
  expectedStreamId?: string | null,
): GqlVodDiscoveryResult {
  const gqlErrors = (body.errors ?? []).map(error => error.message?.trim()).filter(Boolean) as string[]
  const expected = normalizeId(expectedStreamId ?? undefined)
  if (!expected) {
    return {
      vodId: null,
      streamId: null,
      source: null,
      gqlErrors: [...gqlErrors, 'expected_stream_id_required'],
    }
  }

  for (const edge of body.data?.user?.videos?.edges ?? []) {
    const node = edge?.node
    const vodId = normalizeId(node?.id)
    const nodeStreamId =
      normalizeId(node?.broadcastId)
      ?? normalizeId(node?.stream?.id ?? undefined)
    if (!vodId || !nodeStreamId) continue
    if (nodeStreamId !== expected) continue
    return {
      vodId,
      streamId: nodeStreamId,
      source: 'videos.archive',
      gqlErrors,
    }
  }

  return { vodId: null, streamId: null, source: null, gqlErrors }
}

export function mergeGqlDiscoveryResults(
  live: GqlVodDiscoveryResult,
  listed: GqlVodDiscoveryResult,
  expectedStreamId?: string | null,
): GqlVodDiscoveryResult {
  const expected = normalizeId(expectedStreamId ?? undefined)
  const accept = (result: GqlVodDiscoveryResult): boolean => {
    if (!result.vodId) return false
    if (!expected) return false
    if (result.streamId && result.streamId !== expected) return false
    // Live archiveVideo without stream id is only ok when live.stream matched earlier.
    if (!result.streamId && result.source !== 'stream.archiveVideo') return false
    return true
  }

  if (accept(live)) return live
  if (accept(listed)) {
    return {
      vodId: listed.vodId,
      streamId: listed.streamId ?? live.streamId ?? expected,
      source: listed.source,
      gqlErrors: [...live.gqlErrors, ...listed.gqlErrors],
    }
  }
  return {
    vodId: null,
    streamId: live.streamId ?? listed.streamId ?? expected,
    source: null,
    gqlErrors: [...live.gqlErrors, ...listed.gqlErrors],
  }
}
