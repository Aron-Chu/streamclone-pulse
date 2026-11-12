import approvedPages from '../generated/recap-page-paths.json'

export type RecapPageCategory = 'channel_summary' | 'stream_recap'

/** Only build-approved public summaries qualify. The path never leaves this browser. */
export function recapAnalyticsCategory(pathname: string, pages: readonly unknown[] = approvedPages): RecapPageCategory | null {
  const path = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  for (const value of pages) {
    if (!value || typeof value !== 'object') continue
    const row = value as Record<string, unknown>
    if (row.path !== path) continue
    if (row.category === 'channel_summary' && /^\/analytics\/[a-z0-9_]{1,25}$/.test(path)) return row.category
    if (row.category === 'stream_recap' && /^\/analytics\/[a-z0-9_]{1,25}\/[0-9]+$/.test(path)) return row.category
  }
  return null
}
