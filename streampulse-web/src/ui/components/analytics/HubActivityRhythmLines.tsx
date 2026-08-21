import { memo } from 'react'

export interface HubActivityRhythmLinesProps {
  height: number
  avg: number | null
  loud: number | null
  width?: string // CSS-style width, e.g. '100%'
}

export const HubActivityRhythmLines = memo(function HubActivityRhythmLines({
  height,
  avg,
  loud,
  width = '100%',
}: HubActivityRhythmLinesProps) {
  if (avg == null && loud == null) return null
  return (
    <g role="presentation" data-component="HubActivityRhythmLines">
      <desc>Reference lines: avg and loud viewer baselines for the active window.</desc>
      {avg != null ? (
        <line
          className="hx-rhythm-line hx-rhythm-line--avg"
          x1="0"
          y1={height - avg}
          x2={width}
          y2={height - avg}
          strokeDasharray="2,4"
          strokeOpacity={0.1}
        />
      ) : null}
      {loud != null ? (
        <line
          className="hx-rhythm-line hx-rhythm-line--loud"
          x1="0"
          y1={height - loud}
          x2={width}
          y2={height - loud}
          strokeDasharray="2,4"
          strokeOpacity={0.16}
        />
      ) : null}
    </g>
  )
})