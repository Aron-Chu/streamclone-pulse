/**
 * Stream edges: a broadcast's opening and closing minutes.
 *
 * Hello and goodbye emote spam (and raids) there scores like a reaction but is
 * not a highlight, so every list of a stream's top moments ranks edge moments
 * after all others. The numbers match the backend's scoring v2
 * (internal/analytics/heatmap/edges.go). A backend `streamEdge` flag wins; when
 * the backend sends none, the client works the edge out from the offset.
 */

export const STREAM_OPENING_EDGE_SECONDS = 5 * 60
export const STREAM_CLOSING_EDGE_SECONDS = 10 * 60

export type StreamEdgeKind = 'opening' | 'closing'

export interface StreamEdges {
  /** Moments before this offset are in the opening edge. */
  openingUntil: number
  /** Moments after this offset are in the closing edge; -1 for no closing edge. */
  closingFrom: number
}

/**
 * The edges for a stream. The closing edge only applies once the stream has
 * ended, and counts back from lastDataOffset (the last minute with chat or
 * emotes) rather than the recorded end, which can be hours late. A negative
 * lastDataOffset means no closing edge.
 */
export function streamEdgesFor(lastDataOffset: number, ended: boolean): StreamEdges {
  return {
    openingUntil: STREAM_OPENING_EDGE_SECONDS,
    closingFrom: ended && lastDataOffset >= 0 ? lastDataOffset - STREAM_CLOSING_EDGE_SECONDS : -1,
  }
}

/** The opening edge only: all a list knows without the stream's end. */
export const OPENING_STREAM_EDGE: StreamEdges = streamEdgesFor(-1, false)

/** The edge a moment at offsetSeconds falls in, or undefined for none. */
export function streamEdgeKind(edges: StreamEdges, offsetSeconds: number): StreamEdgeKind | undefined {
  if (!Number.isFinite(offsetSeconds)) return undefined
  if (offsetSeconds < edges.openingUntil) return 'opening'
  if (edges.closingFrom >= 0 && offsetSeconds > edges.closingFrom) return 'closing'
  return undefined
}

export function isStreamEdgeMoment(moment: { streamEdge?: string | null }): boolean {
  return moment.streamEdge === 'opening' || moment.streamEdge === 'closing'
}

/** The moment's edge: the backend's flag when it sent one, else from its offset. */
export function momentStreamEdge(
  moment: { offsetSeconds: number; streamEdge?: string | null },
  edges: StreamEdges,
): StreamEdgeKind | undefined {
  if (isStreamEdgeMoment(moment)) return moment.streamEdge as StreamEdgeKind
  return streamEdgeKind(edges, moment.offsetSeconds)
}

/** Tags each moment with its edge; a moment whose flag is unchanged is kept as is. */
export function withStreamEdges<T extends { offsetSeconds: number; streamEdge?: string | null }>(
  moments: readonly T[],
  edges: StreamEdges,
): T[] {
  return moments.map(moment => {
    const streamEdge = momentStreamEdge(moment, edges)
    return streamEdge === (moment.streamEdge ?? undefined) ? moment : { ...moment, streamEdge }
  })
}

/** Sort step that places stream-edge moments after all others (0 when both match). */
export function compareStreamEdgeLast(
  a: { streamEdge?: string | null },
  b: { streamEdge?: string | null },
): number {
  return Number(isStreamEdgeMoment(a)) - Number(isStreamEdgeMoment(b))
}
