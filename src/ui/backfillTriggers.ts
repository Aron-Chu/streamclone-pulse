/** User-facing paths that may touch VOD backfill — tested to prevent accidental POST. */

export type BackfillUserAction =
  | 'chart_select'
  | 'chart_hover'
  | 'jump_moment'
  | 'open_analytics'
  | 'load_stream_from_start'
  | 'refresh_vod_status'
  | 'vod_hint_only'
  | 'explicit_coverage_load'

/** Only explicit CoverageCard load may start VOD GQL backfill (LOAD_MISSED_MOMENTS). */
export function shouldSendLoadMissedMomentsMessage(action: BackfillUserAction): boolean {
  return action === 'explicit_coverage_load'
}
