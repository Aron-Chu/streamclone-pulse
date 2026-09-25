/** A backend-verified source mapping is required before any timestamp CTA. */
export interface ArchiveMappingFields {
  vodId?: unknown
  vodAlignSeconds?: unknown
  vodDurationSeconds?: unknown
  vodTiming?: { state?: unknown } | null
  stream?: { vodId?: unknown } | null
  availability?: { vodId?: unknown } | null
}

export function verifiedArchiveMapping(data: ArchiveMappingFields): { vodId: string; alignment: number; duration: number } | null {
  const ids = [data.vodId, data.stream?.vodId, data.availability?.vodId].filter(id => id != null && id !== '')
  if (data.vodTiming?.state !== 'verified' || ids.length === 0
    || !ids.every(id => typeof id === 'string' && /^\d{6,20}$/.test(id) && id === ids[0])
    || typeof data.vodAlignSeconds !== 'number' || !Number.isFinite(data.vodAlignSeconds) || Math.abs(data.vodAlignSeconds) > 21600
    || typeof data.vodDurationSeconds !== 'number' || !Number.isFinite(data.vodDurationSeconds) || data.vodDurationSeconds <= 0) return null
  return { vodId: ids[0] as string, alignment: data.vodAlignSeconds, duration: data.vodDurationSeconds }
}
