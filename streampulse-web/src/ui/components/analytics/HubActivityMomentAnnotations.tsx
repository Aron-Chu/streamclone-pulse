import { memo } from 'react'
import type { HubChartAnnotation } from '../../../lib/hubChartMarkers'
import { CHART_MOTION } from '../../../lib/chartMotion'

export interface HubActivityMomentAnnotationsProps {
  annotations: HubChartAnnotation[]
  height: number
  reducedMotion: boolean
  onSelectAnnotation?: (key: string) => void
  selectedAnnotationKey?: string | null
}

const STAMP_HEIGHT = 14
const STAMP_WIDTH = 26

export const HubActivityMomentAnnotations = memo(function HubActivityMomentAnnotations({
  annotations,
  height,
  reducedMotion,
  onSelectAnnotation,
  selectedAnnotationKey,
}: HubActivityMomentAnnotationsProps) {
  const prefersReduced = reducedMotion
  return (
    <g data-component="HubActivityMomentAnnotations">
      {annotations.map((a) => {
        const x = a.xPercent ?? 0
        if (a.kind === 'spike') {
          const baseR = 24
          return (
            <g
              key={a.key}
              data-annotation-key={a.key}
              onClick={() => onSelectAnnotation?.(a.key)}
              style={{ cursor: onSelectAnnotation ? 'pointer' : 'default' }}
            >
              <ellipse
                cx={x}
                cy={height / 2}
                rx={baseR * 1.6}
                ry={height * 0.45}
                className="hx-spike-glow"
                fillOpacity={0.1}
              />
              <ellipse
                cx={x}
                cy={height / 2}
                rx={baseR}
                ry={height * 0.32}
                className="hx-spike-glow"
                fillOpacity={0.18}
              />
              <ellipse
                cx={x}
                cy={height / 2}
                rx={baseR * 0.35}
                ry={height * 0.18}
                className="hx-spike-glow"
                fillOpacity={0.3}
              />
              {!prefersReduced ? (
                <animate
                  attributeName="fill-opacity"
                  values="0.30;0.276;0.30"
                  dur={`${CHART_MOTION.spikeGlowPulse.durationMs}ms`}
                  repeatCount="indefinite"
                />
              ) : null}
              {!a.labelOmitted ? (
                <g>
                  <rect
                    x={x - STAMP_WIDTH / 2}
                    y={4}
                    width={STAMP_WIDTH}
                    height={STAMP_HEIGHT}
                    rx={3}
                    className="hx-moment-stamp hx-moment-stamp--spike"
                  />
                  <text
                    x={x}
                    y={14}
                    fontSize={8}
                    textAnchor="middle"
                    className="hx-moment-stamp__label"
                  >
                    {a.channelName.slice(0, 6).toUpperCase()}
                  </text>
                </g>
              ) : null}
            </g>
          )
        }
        const opacity = a.opacity ?? 1
        return (
          <g
            key={a.key}
            data-annotation-key={a.key}
            onClick={() => onSelectAnnotation?.(a.key)}
            style={{ cursor: onSelectAnnotation ? 'pointer' : 'default' }}
          >
            <rect
              x={x - STAMP_WIDTH / 2}
              y={height - STAMP_HEIGHT - 4}
              width={STAMP_WIDTH}
              height={STAMP_HEIGHT}
              rx={3}
              opacity={opacity}
              className={`hx-moment-stamp ${selectedAnnotationKey === a.key ? 'is-selected' : ''}`}
            />
            <line
              x1={x}
              y1={height - 4}
              x2={x}
              y2={height - STAMP_HEIGHT - 4}
              className="hx-moment-stamp__connector"
              strokeDasharray="2,2"
            />
            {!a.labelOmitted ? (
              <text
                x={x + STAMP_WIDTH / 2 + 4}
                y={height - STAMP_HEIGHT / 2 - 4}
                fontSize={9}
                className="hx-moment-stamp__label"
              >
                {a.channelName}
              </text>
            ) : null}
          </g>
        )
      })}
    </g>
  )
})