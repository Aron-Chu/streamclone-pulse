import type { PulseBookmark, PulseBookmarkPage } from './messages.ts'

export const BOOKMARK_PAGE_LIMIT = 100
export function validBookmarkCursor(value: unknown): value is string {
  // Opaque v1 cursor, or a legacy RFC3339 timestamp. Never accept a URL.
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 && /^[A-Za-z0-9_.:+-]+$/.test(value)
}
export function validBookmarkPageLimit(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= BOOKMARK_PAGE_LIMIT
}

/** Fail closed on malformed private pages instead of converting them to an empty library. */
export function parseBookmarkPage(value: unknown, limit = 50): PulseBookmarkPage {
  const invalid = () => { throw new Error('invalid_bookmark_page') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const page = value as Record<string, unknown>
  if (!Array.isArray(page.items) || page.items.length > limit) return invalid()
  if (page.nextCursor !== undefined && (!validBookmarkCursor(page.nextCursor) || page.items.length === 0)) return invalid()
  const seen = new Set<string>()
  const items: PulseBookmark[] = page.items.map((row: unknown) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return invalid()
    const item = row as Record<string, unknown>
    if (typeof item.id !== 'string' || !item.id || item.id.length > 200 || /[\s\u0000-\u001f]/.test(item.id)
      || seen.has(item.id) || typeof item.login !== 'string' || !/^[a-z0-9_]{1,25}$/.test(item.login)
      || !Number.isSafeInteger(item.offsetSeconds) || (item.offsetSeconds as number) < 0
      || typeof item.label !== 'string' || item.label.length > 160
      || typeof item.notes !== 'string' || item.notes.length > 1000
      || (item.source !== 'web' && item.source !== 'extension')
      || typeof item.createdAt !== 'string' || item.createdAt.length > 40 || !Number.isFinite(Date.parse(item.createdAt))
      || typeof item.updatedAt !== 'string' || item.updatedAt.length > 40 || !Number.isFinite(Date.parse(item.updatedAt))
      || (item.streamId !== undefined && (typeof item.streamId !== 'string' || !item.streamId || item.streamId.length > 220))
      || (item.vodId !== undefined && (typeof item.vodId !== 'string' || !/^\d{1,30}$/.test(item.vodId)))
      || (item.score !== undefined && (!Number.isInteger(item.score) || (item.score as number) < 0 || (item.score as number) > 100))) return invalid()
    seen.add(item.id)
    // Principal IDs, credentials, arbitrary URLs and other server fields do not
    // belong in content-script responses or a future Library export.
    return { id: item.id, login: item.login, offsetSeconds: item.offsetSeconds as number,
      label: item.label, notes: item.notes, source: item.source, createdAt: item.createdAt, updatedAt: item.updatedAt,
      ...(item.streamId !== undefined ? { streamId: item.streamId as string } : {}),
      ...(item.vodId !== undefined ? { vodId: item.vodId as string } : {}),
      ...(item.score !== undefined ? { score: item.score as number } : {}) }
  })
  return { items, ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor as string } : {}) }
}
