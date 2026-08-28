import type { NewsroomEvidence, NewsroomResolvedReason } from '../../../lib/newsroom'

export interface EvidenceSummaryProps {
  evidence: NewsroomEvidence
  resolvedReason?: NewsroomResolvedReason
}

function evidenceHeadline(evidence: NewsroomEvidence, resolvedReason?: NewsroomResolvedReason): string {
  if (
    evidence.ircBound && evidence.eventRollupAvailable && evidence.streamIdentityMatched &&
    evidence.rollupChatSource === 'irc' && evidence.rollupSourceConfidence === 'verified'
  ) return 'Verified IRC rollup'
  if (evidence.eventRollupAvailable && evidence.streamIdentityMatched) {
    return evidence.rollupChatSource === 'irc' ? 'IRC rollup measured' : 'Live rollup measured'
  }
  if (resolvedReason === 'stream_ended') return 'Stream ended · event rollup unavailable'
  if (!evidence.streamIdentityMatched) return 'Stream identity not matched'
  if (!evidence.ircBound) return 'IRC binding unavailable'
  return 'Event rollup unavailable'
}

export function EvidenceSummary({ evidence, resolvedReason }: EvidenceSummaryProps) {
  const baseline = evidence.baselineExpectedMinutes > 0
    ? `earlier baseline ${evidence.baselineMeasuredMinutes}/${evidence.baselineExpectedMinutes} min · ${Math.round(evidence.baselineCoveragePct)}%`
    : 'earlier baseline unavailable'
  const metadata = evidence.metadataStreamMatched ? 'stream metadata matched' : 'stream metadata not matched'
  return (
    <p
      className="newsroom-lead__evidence"
      data-evidence-state={evidence.eventRollupAvailable && evidence.streamIdentityMatched ? 'measured' : 'unavailable'}
      title={evidence.rollupSourceDetail}
    >
      <strong>{evidenceHeadline(evidence, resolvedReason)}</strong> · {baseline} · {metadata}
    </p>
  )
}
