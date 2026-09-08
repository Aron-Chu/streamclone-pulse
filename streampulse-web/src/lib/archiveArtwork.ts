export interface ArchiveArtwork { vodId: string; kind: 'archive_thumbnail'; url: string }

/** Accept only artwork supplied for the same verified archive, never live art. */
export function verifiedArchiveArtwork(value: unknown, vodId: string | undefined): ArchiveArtwork | undefined {
  if (!value || typeof value !== 'object' || !vodId) return
  const art = value as Record<string, unknown>
  if (art.vodId !== vodId || art.kind !== 'archive_thumbnail' || typeof art.url !== 'string' || art.url.length > 2048) return
  try {
    const url = new URL(art.url)
    if (url.origin !== 'https://static-cdn.jtvnw.net' || url.username || url.password || url.search || url.hash
      || !url.pathname.startsWith('/cf_vods/') || !url.pathname.includes('/thumb/')) return
    return { vodId, kind: 'archive_thumbnail', url: url.href }
  } catch { return }
}
