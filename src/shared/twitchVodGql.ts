const VOD_ID = /^\d{6,20}$/

export interface GqlVodDiscoveryResult {
  vodId: string | null
  streamId: string | null
  source: 'stream.archiveVideo' | 'videos.archive' | 'page_html' | 'page_script' | null
  gqlErrors: string[]
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
}): GqlVodDiscoveryResult {
  const gqlErrors = (body.errors ?? []).map(error => error.message?.trim()).filter(Boolean) as string[]
  const stream = body.data?.user?.stream
  const streamId = stream?.id?.trim() ?? null
  const archiveId = stream?.archiveVideo?.id?.trim()
  if (archiveId && VOD_ID.test(archiveId)) {
    return { vodId: archiveId, streamId, source: 'stream.archiveVideo', gqlErrors }
  }
  return { vodId: null, streamId, source: null, gqlErrors }
}

/** Parse videos(type: ARCHIVE) GQL payload. */
export function parseArchiveListVodFromGql(body: {
  data?: {
    user?: {
      videos?: { edges?: Array<{ node?: { id?: string } }> }
    } | null
  }
  errors?: Array<{ message?: string }>
}): GqlVodDiscoveryResult {
  const gqlErrors = (body.errors ?? []).map(error => error.message?.trim()).filter(Boolean) as string[]
  const id = body.data?.user?.videos?.edges?.[0]?.node?.id?.trim()
  if (id && VOD_ID.test(id)) {
    return { vodId: id, streamId: null, source: 'videos.archive', gqlErrors }
  }
  return { vodId: null, streamId: null, source: null, gqlErrors }
}

export function mergeGqlDiscoveryResults(
  live: GqlVodDiscoveryResult,
  listed: GqlVodDiscoveryResult,
): GqlVodDiscoveryResult {
  if (live.vodId) return live
  return {
    vodId: listed.vodId,
    streamId: listed.streamId ?? live.streamId,
    source: listed.source,
    gqlErrors: [...live.gqlErrors, ...listed.gqlErrors],
  }
}
