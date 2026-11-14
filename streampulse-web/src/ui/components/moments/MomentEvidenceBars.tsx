import { formatLiftRatio, formatLiftWords } from '@streampulse/pulse-core'
import type { DiscoveryMoment } from '../../../lib/discoveryMoments'

const measured = (value?: number): value is number => value != null && Number.isFinite(value) && value >= 0
const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 })
/**
 * A row's figure in pulse-core's words, as the list rows write it (Z06, round 2
 * 11-13): "6.2× more emotes". A minute under its earlier average rose nothing,
 * so it keeps "0.4× earlier average" rather than claim "more".
 */
const figure = (value: number, series: 'chat' | 'emotes') =>
  value >= 1 ? formatLiftWords(value, series) : `${formatLiftRatio(value)}× earlier average`

/**
 * Smallest power of ten that contains this ratio, so 2×, 14× and 229× all land
 * inside a track with labelled 1× / 10× / 100× gridlines. A linear track cannot
 * do this: at 229× the earlier average is 0.4% of the width and the drawing
 * stops carrying information exactly when the spike is biggest.
 */
export function ratioScaleCeiling(multiplier: number): number {
  return 10 ** Math.max(1, Math.ceil(Math.log10(Math.max(multiplier, 1))))
}

/** Position of a ratio on the log track, as a percentage from the 1× origin. */
export function ratioPositionPct(multiplier: number, ceiling: number): number {
  if (!(multiplier > 1) || !(ceiling > 1)) return 0
  const position = (Math.log10(multiplier) / Math.log10(ceiling)) * 100
  return Math.round(Math.min(100, position) * 100) / 100
}

interface RatioRow {
  name: string
  current: number
  baseline: number
  /** Absent when the earlier baseline is zero: a ratio against zero is undefined. */
  multiplier: number | null
}

/**
 * How this minute compares with the same stream's earlier measured average.
 *
 * Visualizes supplied measurements only. The backend owns the baseline and the
 * multiplier; nothing here re-baselines, and a ratio is drawn only where the
 * server marked the comparison ready with a measured earlier rate above zero.
 */
export function MomentEvidenceBars({ moment }: { moment: DiscoveryMoment }) {
  const comparison = moment.comparison
  const rows = ([['Chat', comparison?.chat], ['Emotes', comparison?.emotes]] as const)
    .flatMap(([name, metric]): RatioRow[] => {
      if (!metric || !['ready', 'new_activity'].includes(metric.state)) return []
      if (!measured(metric.currentPerMin) || !measured(metric.baselinePerMin)) return []
      const supplied = measured(metric.multiplier) ? metric.multiplier : null
      // Both rates are server measurements; their ratio is arithmetic on those
      // measurements, never a locally chosen baseline.
      const derived = metric.baselinePerMin > 0 ? metric.currentPerMin / metric.baselinePerMin : null
      return [{ name, current: metric.currentPerMin, baseline: metric.baselinePerMin, multiplier: supplied ?? derived }]
    })
  if (!rows.length) return null
  // One scale for both signals so a 9× row and an 11× row cannot draw backwards.
  const ceiling = ratioScaleCeiling(Math.max(1, ...rows.map(row => row.multiplier ?? 1)))
  const ticks: number[] = []
  for (let tick = 1; tick <= ceiling; tick *= 10) ticks.push(tick)
  const evidence = comparison?.evidence
  const coverage = evidence && measured(evidence.baselineMeasuredMinutes) && evidence.baselineExpectedMinutes > 0
    ? `Measured ${evidence.baselineMeasuredMinutes.toLocaleString()} of ${evidence.baselineExpectedMinutes.toLocaleString()} earlier minutes of this stream; gaps are excluded.`
    : 'Based on measured minutes before this event; gaps are excluded.'
  return <figure className="moment-evidence-bars" aria-label="Reaction compared with earlier stream activity">
    <figcaption><strong>How unusual was this reaction?</strong><span>Against this stream&rsquo;s earlier measured average · per minute</span></figcaption>
    {rows.map(row => <div className="moment-ratio" key={row.name}>
      <div className="moment-ratio__head">
        <strong>{row.name}</strong>
        <span>{number(row.baseline)} <i aria-hidden="true">→</i> <b>{number(row.current)}</b> / min</span>
        <em>{row.multiplier == null ? 'new activity' : figure(row.multiplier, row.name === 'Emotes' ? 'emotes' : 'chat')}</em>
      </div>
      {row.multiplier == null
        ? <p className="moment-ratio__zero">No earlier {row.name.toLowerCase()} was measured on this stream, so there is no ratio to draw.</p>
        : <div className="moment-ratio__track" aria-hidden="true">
            {ticks.map(tick => <span className="moment-ratio__tick" key={tick} style={{ left: `${ratioPositionPct(tick, ceiling)}%` }} data-origin={tick === 1 ? 'true' : undefined}>{tick}×</span>)}
            <i style={{ width: `${ratioPositionPct(row.multiplier, ceiling)}%` }} />
          </div>}
    </div>)}
    <p>1× is the earlier average. {coverage}</p>
  </figure>
}
