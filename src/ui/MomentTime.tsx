import { isStreamEdgeMoment, streamEdgeLabel, type StreamEdgeKind } from '@streampulse/pulse-core'

/** A moment's time as h:mm:ss, after a quiet 'about' when only its minute is known (K1), as formatMomentClock writes it. */
export function MomentTime({ text, about }: { text: string; about?: boolean }) {
  return <>{about ? <span className="pulse-about">about </span> : null}{text}</>
}

/** 'Stream start' / 'Stream end' for a moment ranked last as hello or goodbye spam (E1), else ''. */
export function momentEdgeLabel(point: { streamEdge?: string }): string {
  return isStreamEdgeMoment(point) ? streamEdgeLabel(point.streamEdge as StreamEdgeKind) : ''
}
