import type { ExtensionCoverageTierResponse } from './messages.ts'

/** Recap/offline UI reads liveMetadata from the coverage-tier payload. */
export type ExtensionCoverageResponse = ExtensionCoverageTierResponse

/** @deprecated Use ExtensionCoverageResponse — kept for field documentation. */
export interface ExtensionCoverageLiveMetadata {
  available?: boolean
  source?: string
  isLive?: boolean | null
  streamId?: string | null
  title?: string | null
  category?: string | null
  startedAt?: string | null
  viewerCount?: number | null
  language?: string | null
  tags?: string[]
  snapshotTime?: string | null
  freshnessSeconds?: number | null
}
