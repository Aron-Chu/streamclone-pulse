/**
 * Provider lanes under the hub activity chart (plan §1.5 "Providers"): emote
 * uses per minute for 7TV and for everything else ("other" = emotes − 7TV),
 * neutral grey, aligned to the plot. A lane name carries "≥" when the backend
 * says its counts are lower bounds.
 *
 * Each lane path is drawn once per data change in sample units; the chart
 * frame moves it with one transform per frame (no React render).
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import type { SpFrame } from '@streampulse/pulse-charts/spchart'
import type { HubActivitySpModel } from './hubActivitySpModel'

/** Lane bar height at the lane's max (d3-v2 hub.js drawLanes: 17 of 20 px). */
const LANE_BAR_PX = 17
const LANE_BASE_Y = 19

export interface HubProviderLane {
  key: 'sevenTv' | 'other'
  name: string
  lowerBound: boolean
  path: string
}

/** Lane name as shown: "≥ 7TV" when the counts are lower bounds. */
export function providerLaneName(name: string, lowerBound: boolean): string {
  return lowerBound ? `≥ ${name}` : name
}

/** One closed path per lane in sample units (x = sample index, y = lane px). */
export function providerLanePath(values: ArrayLike<number>): string {
  let max = 0
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]!
    if (Number.isFinite(value) && value > max) max = value
  }
  if (!(max > 0)) return ''
  let d = ''
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]!
    if (!Number.isFinite(value)) continue
    const h = Math.max(0.5, (value / max) * LANE_BAR_PX)
    d += `M${i} ${LANE_BASE_Y}V${Math.round((LANE_BASE_Y - h) * 10) / 10}H${i + 1}V${LANE_BASE_Y}Z`
  }
  return d
}

export function buildProviderLanes(model: HubActivitySpModel): HubProviderLane[] {
  return [
    { key: 'sevenTv', name: '7TV', lowerBound: model.sevenTvLowerBound, path: providerLanePath(model.sevenTv) },
    { key: 'other', name: 'other', lowerBound: model.otherLowerBound, path: providerLanePath(model.other) },
  ]
}

export interface HubProviderLanesProps {
  model: HubActivitySpModel
  /** Plot width in px (the chart width minus its value-axis column). */
  plotWidth: number
  /** The chart's live frame, once the chart has mounted. */
  frame: () => SpFrame | null
}

export function HubProviderLanes({ model, plotWidth, frame }: HubProviderLanesProps) {
  const lanes = useMemo(() => buildProviderLanes(model), [model])
  const groups = useRef<(SVGGElement | null)[]>([])

  useLayoutEffect(() => {
    const live = frame()
    if (!live) return
    const apply = (f: SpFrame) => {
      const transform = `translate(${f.offset} 0) scale(${f.scale} 1)`
      for (const g of groups.current) g?.setAttribute('transform', transform)
    }
    apply(live)
    return live.subscribe(apply)
  }, [frame, lanes, plotWidth])

  const width = Math.max(0, Math.round(plotWidth))
  return (
    <div className="lanes" data-hub-provider-lanes="" role="group" aria-label="Emote uses by provider, per minute">
      {lanes.map((lane, index) => (
        <div key={lane.key} className="lane" data-hub-provider-lane={lane.key} data-lower-bound={lane.lowerBound ? '' : undefined}>
          <svg width={width} height={20} style={{ width }} aria-hidden="true" focusable="false">
            <line x1={0} x2={width} y1={19.5} y2={19.5} className="lane-base" />
            <g ref={(el) => { groups.current[index] = el }}>
              {lane.path ? <path d={lane.path} className="lane-fill" /> : null}
            </g>
          </svg>
          <span className="nm" style={{ left: width + 10 }}>{providerLaneName(lane.name, lane.lowerBound)}</span>
        </div>
      ))}
    </div>
  )
}
