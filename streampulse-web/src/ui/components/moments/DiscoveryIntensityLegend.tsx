import type { DiscoveryMeasure } from '../../../lib/discoveryPresentation'

/** Lower-case phrasing, so the label reads correctly mid-sentence. */
export const discoveryMeasureLabels: Record<DiscoveryMeasure, string> = {
  detections: 'detected moments',
  chatMessages: 'chat messages',
  emoteUses: 'emote uses',
}

/**
 * The activity calendar's single legend: one intensity ramp plus the two states
 * that are not points on that ramp — a measured day with nothing detected, and
 * a day with no measurement at all.
 *
 * Shared by Month detail and Year overview so the calendar reads as one control
 * with one encoding instead of two similar-looking grids. The swatch colours
 * come from the `--discovery-level-*` ramp defined in `discovery-calendar.css`,
 * the same custom properties the day cells use.
 */
export function DiscoveryIntensityLegend({ measure }: { measure: DiscoveryMeasure }) {
  const label = discoveryMeasureLabels[measure]
  return (
    <div className="discovery-calendar__legend" aria-label={`Less to more ${label}`}>
      <span className="discovery-calendar__legend-ramp">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map(level => (
          <i key={level} data-level={level} aria-hidden="true" />
        ))}
        <span>More {label}</span>
      </span>
      <span className="discovery-calendar__legend-key">
        <i data-level="0" aria-hidden="true" />
        <span>0 {label}</span>
      </span>
      <span className="discovery-calendar__legend-key">
        <i data-state="no_measurement" aria-hidden="true" />
        <span>No measurement</span>
      </span>
    </div>
  )
}
