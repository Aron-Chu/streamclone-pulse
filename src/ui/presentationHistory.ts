import type { PresentationTrend, SemanticLodMode } from '@streampulse/pulse-charts'

export type PresentationHistoryCommit = {
  lodScope: string
  mode: SemanticLodMode
  viewerTrend: PresentationTrend
  chatTrend: PresentationTrend
  emoteTrend: PresentationTrend
}

export function presentationLodScope(
  plotWidth: number,
  viewportKey: string,
): string {
  return `${Math.round(plotWidth)}:${viewportKey}`
}

export function previousTrendForScope(
  committed: PresentationHistoryCommit | null | undefined,
  lodScope: string,
  signal: 'viewer' | 'chat' | 'emote',
): PresentationTrend | undefined {
  if (!committed || committed.lodScope !== lodScope) return undefined
  if (signal === 'viewer') return committed.viewerTrend
  if (signal === 'chat') return committed.chatTrend
  return committed.emoteTrend
}

export function commitPresentationHistory(
  lodScope: string,
  mode: SemanticLodMode,
  viewerTrend: PresentationTrend,
  chatTrend: PresentationTrend,
  emoteTrend: PresentationTrend,
): PresentationHistoryCommit {
  return { lodScope, mode, viewerTrend, chatTrend, emoteTrend }
}
