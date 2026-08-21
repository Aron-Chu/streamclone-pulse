import { reactionAnalyticalOffset, type LiveHeatPoint } from '@streampulse/pulse-core'

export type MomentInspectionSource = 'chart' | 'most-reacted' | 'recap'

export interface InspectionSelection {
  source: MomentInspectionSource
  /** Exact analytical offset used for the chart cursor and jump actions. */
  offsetSeconds: number
  /** Stable cross-surface identity. Adjacent minute buckets never alias. */
  bucketOffsetSeconds: number
  point: LiveHeatPoint
  rankedIdentity?: string
  selectionType?: 'minute' | 'chat_interval' | 'emote_peak' | 'reaction'
  intervalStartSeconds?: number
  intervalEndSeconds?: number
  seriesIdentity?: string
}

export function normalizedInspectionBucket(offsetSeconds: number): number {
  if (!Number.isFinite(offsetSeconds)) return 0
  return Math.max(0, Math.floor(offsetSeconds / 60) * 60)
}

export function inspectionSelectionFromPoint(
  source: MomentInspectionSource,
  point: LiveHeatPoint,
  rankedIdentity?: string,
): InspectionSelection {
  const offsetSeconds = Math.max(0, reactionAnalyticalOffset(point))
  return {
    source,
    offsetSeconds,
    bucketOffsetSeconds: normalizedInspectionBucket(offsetSeconds),
    point,
    selectionType: 'reaction',
    ...(rankedIdentity ? { rankedIdentity } : null),
  }
}

export function sameInspectionBucket(
  left: InspectionSelection | null | undefined,
  right: InspectionSelection | null | undefined,
): boolean {
  return left != null
    && right != null
    && left.bucketOffsetSeconds === right.bucketOffsetSeconds
}

export interface MomentInspectionState {
  preview: InspectionSelection | null
  committed: InspectionSelection | null
}

export const EMPTY_MOMENT_INSPECTION: MomentInspectionState = {
  preview: null,
  committed: null,
}

export type MomentInspectionAction =
  | { type: 'preview'; selection: InspectionSelection | null }
  | { type: 'commit'; selection: InspectionSelection }
  | { type: 'toggle'; selection: InspectionSelection }
  | { type: 'clear-preview' }
  | { type: 'clear' }

export function reduceMomentInspection(
  state: MomentInspectionState,
  action: MomentInspectionAction,
): MomentInspectionState {
  switch (action.type) {
    case 'preview':
      // Preview and commit are independent layers. The committed selection
      // remains authoritative through effectiveInspectionSelection, while the
      // preview coordinate is retained for secondary ghost chrome.
      return state.preview === action.selection
        ? state
        : { ...state, preview: action.selection }
    case 'clear-preview':
      return state.preview == null ? state : { ...state, preview: null }
    case 'commit':
      return { preview: null, committed: action.selection }
    case 'toggle':
      return sameInspectionBucket(state.committed, action.selection)
        ? EMPTY_MOMENT_INSPECTION
        : { preview: null, committed: action.selection }
    case 'clear':
      return state.preview == null && state.committed == null
        ? state
        : EMPTY_MOMENT_INSPECTION
  }
}

export function effectiveInspectionSelection(
  state: MomentInspectionState,
): InspectionSelection | null {
  return state.committed ?? state.preview
}
