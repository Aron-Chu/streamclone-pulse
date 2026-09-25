import type { DiscoveryMoment } from '../../../lib/discoveryMoments'
import { formatStreamOffset } from '../../../lib/formatStreamOffset'

/** Discrete supplied detections, not an interpolated activity or replay-count curve. */
export function SessionMomentMap({ moments, onSelect }: { moments: DiscoveryMoment[]; onSelect: (moment: DiscoveryMoment) => void }) {
  const rows = [...moments].sort((a, b) => a.offsetSeconds - b.offsetSeconds)
  if (rows.length < 2) return null
  const start = rows[0]!.offsetSeconds, end = rows[rows.length - 1]!.offsetSeconds
  if (start === end || rows.some(row => row.streamId !== rows[0]!.streamId || row.login !== rows[0]!.login)) return null
  return <section className="session-moment-map" aria-label="Loaded session detections">
    <div><h3>Reaction timestamps</h3><span>{rows.length} loaded detections</span></div>
    <div className="session-moment-map-track" aria-hidden="true">
      {rows.map(moment => <i key={moment.key} style={{ left: `${(moment.offsetSeconds - start) / (end - start) * 100}%` }} />)}
    </div>
    <div className="session-moment-map-bounds"><span>{formatStreamOffset(start)}</span><span>{formatStreamOffset(end)}</span></div>
    <div className="session-moment-map-links">{rows.map(moment => <button key={moment.key} type="button"
      title={moment.label} onClick={() => onSelect(moment)}>{formatStreamOffset(moment.offsetSeconds)}</button>)}</div>
    <p>Jump to a detected reaction. Spaces between markers are unmeasured here; this is not the full broadcast timeline.</p>
  </section>
}
