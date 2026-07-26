import { CHART_THEME, hexToRgba } from './chartTheme.ts'
import type { ChartTimelineWindow } from './chatActivityEmotes.ts'

/** How chat is drawn — bars for short windows, area silhouette for long ones. */
export type ChartRenderDensity = 'sparse' | 'medium' | 'dense'

export function chartRenderDensity(pointCount: number, window: ChartTimelineWindow = '60m'): ChartRenderDensity {
  if (window === '15m' || window === '30m' || window === '60m' || pointCount <= 72) return 'sparse'
  if (window === '2h' || window === '4h' || pointCount <= 180) return 'medium'
  return 'dense'
}

/** 2h+ uses a single smooth line + fill (no minute bars). */
export function isSilhouetteOnlyWindow(window: ChartTimelineWindow): boolean {
  return window === '2h' || window === '4h' || window === 'full'
}

function smoothPass(
  values: readonly number[],
  prevWeight = 0.2,
  currentWeight = 0.6,
  nextWeight = 0.2,
): number[] {
  if (values.length < 3) return [...values]
  const out = [...values]
  for (let i = 1; i < values.length - 1; i += 1) {
    const prev = values[i - 1] ?? 0
    const current = values[i] ?? 0
    const next = values[i + 1] ?? 0
    out[i] = prev * prevWeight + current * currentWeight + next * nextWeight
  }
  return out
}

/** Match overlay/chat series length (handles single-minute duplicate and tail padding). */
export function alignSeriesToChartPoints(
  values: readonly number[],
  targetLength: number,
  rawSourceLength: number,
): number[] {
  if (targetLength <= 0) return []
  if (rawSourceLength === 1 && targetLength === 2) {
    const v = values[values.length - 1] ?? values[0] ?? 0
    return [v, v]
  }
  let aligned = values.length > targetLength ? values.slice(-targetLength) : [...values]
  if (aligned.length < targetLength) {
    const pad = targetLength - aligned.length
    aligned = [...Array<number>(pad).fill(0), ...aligned]
  }
  return aligned
}

/** Tiered smoothing for long-window silhouettes (canvas-only, endpoints fixed). */
export function smoothChartSeries(values: readonly number[], window: ChartTimelineWindow): number[] {
  if (window === '15m' || window === '30m' || window === '60m') return [...values]
  if (values.length < 3) return [...values]
  if (window === '2h') return smoothPass(values)
  if (window === '4h') return smoothPass(smoothPass(values))
  return smoothPass(smoothPass(smoothPass(values, 0.12, 0.76, 0.12), 0.15, 0.7, 0.15))
}

export function chartBarWidth(stepX: number, density: ChartRenderDensity): number {
  if (density === 'dense') return Math.min(Math.max(stepX * 0.92, 1), 2)
  if (density === 'medium') return Math.min(Math.max(stepX * 0.78, 2), 5)
  return Math.max(stepX * 0.72, 4)
}

export function chatBarFillAlpha(
  density: ChartRenderDensity,
  index: number,
  activeIndex: number | null,
  hovering: boolean,
): number {
  const isActive = activeIndex === index
  if (isActive) return 0.78
  const base = density === 'sparse' ? 0.26 : density === 'medium' ? 0.14 : 0.08
  if (hovering && activeIndex != null && !isActive) return base * 0.55
  return base
}

export function chatAreaFillAlpha(density: ChartRenderDensity, chartWindow: ChartTimelineWindow = '60m'): number {
  if (chartWindow === 'full') return 0.08
  if (chartWindow === '4h') return 0.09
  if (chartWindow === '2h') return 0.1
  if (density === 'dense') return 0.11
  if (density === 'medium') return 0.08
  return 0.14
}

export function chatAreaLineAlpha(density: ChartRenderDensity, chartWindow: ChartTimelineWindow = '60m'): number {
  if (chartWindow === 'full') return 0.22
  if (chartWindow === '4h') return 0.26
  if (chartWindow === '2h') return 0.32
  if (density === 'dense') return 0.28
  if (density === 'medium') return 0.38
  return 0.55
}

export function overlayLineAlpha(
  density: ChartRenderDensity,
  dashed: boolean,
  primary: boolean,
  hovering: boolean,
  chartWindow: ChartTimelineWindow = '60m',
): number {
  let alpha = density === 'dense' ? 0.28 : density === 'medium' ? 0.38 : 0.58
  if (dashed) alpha -= 0.08
  if (primary) alpha += 0.06
  if (hovering) alpha += 0.14
  if (!primary) {
    if (chartWindow === '2h') alpha *= 0.55
    else if (chartWindow === '4h') alpha *= 0.35
    else if (chartWindow === 'full') alpha *= 0.25
  }
  return Math.min(0.88, Math.max(0.12, alpha))
}

export function overlayLineWidth(density: ChartRenderDensity, primary: boolean): number {
  if (density === 'dense') return primary ? 1.35 : 1.1
  return primary ? 2 : 1.35
}

export function overlayStrokeColor(color: string, alpha: number): string {
  return hexToRgba(color, alpha)
}

export function chatBarFillColor(alpha: number): string {
  return hexToRgba(CHART_THEME.chat.color, alpha)
}

export function chatAreaFillColor(alpha: number): string {
  return hexToRgba(CHART_THEME.chat.color, alpha)
}

export function shouldDrawIndividualBars(
  density: ChartRenderDensity,
  stepX: number,
  chartWindow: ChartTimelineWindow = '60m',
): boolean {
  if (isSilhouetteOnlyWindow(chartWindow)) return false
  if (density === 'dense') return stepX >= 2.5
  return true
}

export function useAreaSilhouette(density: ChartRenderDensity): boolean {
  return density !== 'sparse'
}

/** Emote overlays are noisy on full stream unless the user is scrubbing. */
export function shouldDrawEmoteOverlays(
  density: ChartRenderDensity,
  scrubbing: boolean,
  chartWindow: ChartTimelineWindow = '60m',
): boolean {
  if (chartWindow === 'full') return scrubbing
  if (density !== 'dense') return true
  return scrubbing
}
