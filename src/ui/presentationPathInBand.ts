/**
 * Host-side mapping from shared presentation trends → SVG band paths.
 * Presentation mid-indices are geometry only; hover/pin stay on canonical minutes.
 */

import {
  monotoneCubicAreaPath,
  monotoneCubicPath,
  type PresentationTrend,
} from '@streampulse/pulse-charts'
import type { ExtensionRollup } from '../shared/messages.ts'
import { softFitValueToAxis } from './chartRollupUtils.ts'

export type ChartViewportShape = {
  startSeconds: number
  endSeconds: number
}

function xForViewportOffset(
  offsetSeconds: number,
  viewport: ChartViewportShape,
  plotWidth: number,
  padLeft: number,
): number {
  const duration = Math.max(1, viewport.endSeconds - viewport.startSeconds)
  const progress = Math.max(
    0,
    Math.min(1, (offsetSeconds - viewport.startSeconds) / duration),
  )
  return padLeft + progress * plotWidth
}

export function offsetForPresentationMid(
  source: readonly ExtensionRollup[],
  midIndex: number,
): number | null {
  if (!Number.isFinite(midIndex) || source.length === 0) return null
  const lo = Math.max(0, Math.min(source.length - 1, Math.floor(midIndex)))
  const hi = Math.max(0, Math.min(source.length - 1, Math.ceil(midIndex)))
  const a = source[lo]?.offsetSeconds
  if (!Number.isFinite(a)) return null
  if (lo === hi) return a as number
  const b = source[hi]?.offsetSeconds
  if (!Number.isFinite(b)) return a as number
  return (a as number) + ((b as number) - (a as number)) * (midIndex - lo)
}

function projectTrendSegments(
  trend: PresentationTrend,
  source: readonly ExtensionRollup[],
  viewport: ChartViewportShape,
  axisMax: number,
  plotWidth: number,
  bandTop: number,
  bandBottom: number,
  padLeft: number,
): { x: number; y: number }[][] {
  const usableMax = Math.max(1, axisMax)
  const bandHeight = Math.max(1, bandBottom - bandTop)
  return trend.segments
    .map((segment) =>
      segment.points
        .map((point) => {
          const offset = offsetForPresentationMid(source, point.presentationMidIndex)
          if (!Number.isFinite(offset)) return null
          const value = softFitValueToAxis(Math.max(0, point.value), usableMax)
          return {
            x: xForViewportOffset(offset as number, viewport, plotWidth, padLeft),
            y: bandBottom - (value / usableMax) * bandHeight,
          }
        })
        .filter((point): point is { x: number; y: number } => point != null),
    )
    .filter((segment) => segment.length > 0)
}

export function presentationTrendLinePathInBand(
  trend: PresentationTrend,
  source: readonly ExtensionRollup[],
  viewport: ChartViewportShape,
  axisMax: number,
  plotWidth: number,
  bandTop: number,
  bandBottom: number,
  curved = true,
  padLeft = 4,
): string {
  const segments = projectTrendSegments(
    trend,
    source,
    viewport,
    axisMax,
    plotWidth,
    bandTop,
    bandBottom,
    padLeft,
  )
  if (segments.length === 0) return ''
  if (!curved) {
    return segments
      .map((points) =>
        points
          .map((point, index) =>
            `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
          )
          .join(' '),
      )
      .join(' ')
  }
  return segments.map((points) => monotoneCubicPath(points)).filter(Boolean).join(' ')
}

export function presentationTrendAreaPathInBand(
  trend: PresentationTrend,
  source: readonly ExtensionRollup[],
  viewport: ChartViewportShape,
  axisMax: number,
  plotWidth: number,
  bandTop: number,
  bandBottom: number,
  curved = true,
  padLeft = 4,
): string {
  const segments = projectTrendSegments(
    trend,
    source,
    viewport,
    axisMax,
    plotWidth,
    bandTop,
    bandBottom,
    padLeft,
  )
  if (segments.length === 0) return ''
  if (!curved) {
    return segments
      .map((points) => {
        const first = points[0]!
        const last = points[points.length - 1]!
        return (
          `M ${first.x.toFixed(2)} ${bandBottom.toFixed(2)} `
          + points.map((point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
          + ` L ${last.x.toFixed(2)} ${bandBottom.toFixed(2)} Z`
        )
      })
      .join(' ')
  }
  return monotoneCubicAreaPath(segments, bandBottom)
}

/** Pixel heights for viewer lane — expand must never shrink collapsed height. */
export function viewerLanePixelHeights(args: {
  plotHeight: number
  showViewerStrip: boolean
  activityExpanded: boolean
  focusedSeriesKey: string | null
  collapsedShare?: number
  expandedShare?: number
  focusedShare?: number
  minPx?: number
}): { collapsedPx: number; expandedPx: number; activePx: number } {
  const collapsedShare = args.collapsedShare ?? 0.32
  const expandedShare = args.expandedShare ?? 0.3
  const focusedShare = args.focusedShare ?? 0.42
  const minPx = args.minPx ?? 28
  const plotTop = 0
  const collapsedPx = args.showViewerStrip
    ? Math.max(plotTop + args.plotHeight * collapsedShare, plotTop + minPx)
    : 0
  const expandedShareResolved =
    args.activityExpanded && args.focusedSeriesKey === 'viewers'
      ? focusedShare
      : expandedShare
  const expandedPx = args.showViewerStrip
    ? Math.max(plotTop + args.plotHeight * expandedShareResolved, plotTop + minPx)
    : 0
  const activePx = args.activityExpanded ? expandedPx : collapsedPx
  return { collapsedPx, expandedPx, activePx }
}
