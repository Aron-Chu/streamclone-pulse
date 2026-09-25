import {
  CHART_WINDOW_SECONDS,
  type ChartTimelineWindow,
} from './chatActivityEmotes.ts'
import {
  MIN_VIEWPORT_SECONDS,
  viewportDurationSeconds,
  zoomViewport,
  type ChartViewport,
} from './chartViewport.ts'

export type ChartRangeValue = ChartTimelineWindow | 'custom'

export type ChartViewportChangeCause =
  | 'preset'
  | 'user-pan'
  | 'user-zoom'
  | 'selection'
  | 'restore'
  | 'follow-live'

export interface ChartDomain {
  startSeconds: number
  endSeconds: number
}

export interface ChartNavigationResult {
  viewport: ChartViewport
  rangeValue: ChartRangeValue
  sourceWindow: ChartTimelineWindow
}

export interface ChartSelectionRestore {
  viewport: ChartViewport
  rangeValue: ChartRangeValue
}

export interface ChartSelectionNavigationState {
  revealedOffsetSeconds: number | null
  restore: ChartSelectionRestore | null
}

export interface ChartSelectionNavigationResult {
  state: ChartSelectionNavigationState
  viewport: ChartViewport
  rangeValue: ChartRangeValue
  cause: 'selection' | 'restore' | null
}

export const EMPTY_CHART_SELECTION_NAVIGATION: ChartSelectionNavigationState = {
  revealedOffsetSeconds: null,
  restore: null,
}

const WINDOW_ORDER: readonly ChartTimelineWindow[] = [
  '15m',
  '30m',
  '60m',
  '2h',
  '4h',
  'full',
]

export const CHART_RANGE_OPTIONS: ReadonlyArray<{
  value: ChartRangeValue
  label: string
  disabled?: boolean
}> = [
  { value: 'custom', label: 'Custom', disabled: true },
  { value: '15m', label: '15 min' },
  { value: '30m', label: '30 min' },
  { value: '60m', label: '60 min' },
  { value: '2h', label: '2 hours' },
  { value: '4h', label: '4 hours' },
  { value: 'full', label: 'Full stream' },
]

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function normalizeChartDomain(domain: ChartDomain): ChartDomain {
  const startSeconds = Math.max(0, Number.isFinite(domain.startSeconds) ? domain.startSeconds : 0)
  const endSeconds = Math.max(
    startSeconds,
    Number.isFinite(domain.endSeconds) ? domain.endSeconds : startSeconds,
  )
  return { startSeconds, endSeconds }
}

export function chartDomainDuration(domain: ChartDomain): number {
  const normalized = normalizeChartDomain(domain)
  return Math.max(0, normalized.endSeconds - normalized.startSeconds)
}

export function clampViewportToDomain(
  viewport: ChartViewport,
  domain: ChartDomain,
): ChartViewport {
  const normalized = normalizeChartDomain(domain)
  const duration = chartDomainDuration(normalized)
  if (duration <= 0) {
    return { startSeconds: normalized.startSeconds, endSeconds: normalized.endSeconds }
  }
  const requestedDuration = viewportDurationSeconds(viewport)
  if (requestedDuration <= 0 || requestedDuration >= duration) {
    return { startSeconds: normalized.startSeconds, endSeconds: normalized.endSeconds }
  }
  const startSeconds = clamp(
    viewport.startSeconds,
    normalized.startSeconds,
    normalized.endSeconds - requestedDuration,
  )
  return { startSeconds, endSeconds: startSeconds + requestedDuration }
}

export function viewportForRangePreset(
  window: ChartTimelineWindow,
  domain: ChartDomain,
): ChartViewport {
  const normalized = normalizeChartDomain(domain)
  if (window === 'full') {
    return { startSeconds: normalized.startSeconds, endSeconds: normalized.endSeconds }
  }
  const duration = Math.min(
    chartDomainDuration(normalized),
    CHART_WINDOW_SECONDS[window],
  )
  return {
    startSeconds: Math.max(normalized.startSeconds, normalized.endSeconds - duration),
    endSeconds: normalized.endSeconds,
  }
}

export function isViewportFullDomain(
  viewport: ChartViewport,
  domain: ChartDomain,
  epsilonSeconds = 1,
): boolean {
  const normalized = normalizeChartDomain(domain)
  return viewport.startSeconds <= normalized.startSeconds + epsilonSeconds
    && viewport.endSeconds >= normalized.endSeconds - epsilonSeconds
}

export function viewportContainsOffset(
  viewport: ChartViewport,
  offsetSeconds: number,
  epsilonSeconds = 1,
): boolean {
  return Number.isFinite(offsetSeconds)
    && offsetSeconds >= viewport.startSeconds - epsilonSeconds
    && offsetSeconds <= viewport.endSeconds + epsilonSeconds
}

export function zoomViewportInDomain(args: {
  viewport: ChartViewport
  zoomSeconds: number
  domain: ChartDomain
  anchorSeconds?: number
}): ChartViewport {
  const domain = normalizeChartDomain(args.domain)
  const duration = chartDomainDuration(domain)
  if (duration <= 0) return { startSeconds: domain.startSeconds, endSeconds: domain.endSeconds }
  const shifted = {
    startSeconds: args.viewport.startSeconds - domain.startSeconds,
    endSeconds: args.viewport.endSeconds - domain.startSeconds,
  }
  const next = zoomViewport({
    viewport: shifted,
    zoomSeconds: args.zoomSeconds,
    anchorSeconds: args.anchorSeconds == null
      ? undefined
      : args.anchorSeconds - domain.startSeconds,
    durationSeconds: duration,
  })
  return {
    startSeconds: next.startSeconds + domain.startSeconds,
    endSeconds: next.endSeconds + domain.startSeconds,
  }
}

export function centerViewportOnOffset(args: {
  viewport: ChartViewport
  offsetSeconds: number
  domain: ChartDomain
}): ChartViewport {
  const domain = normalizeChartDomain(args.domain)
  const visibleDuration = Math.min(
    chartDomainDuration(domain),
    Math.max(MIN_VIEWPORT_SECONDS, viewportDurationSeconds(args.viewport)),
  )
  const anchor = clamp(args.offsetSeconds, domain.startSeconds, domain.endSeconds)
  const startSeconds = clamp(
    anchor - visibleDuration / 2,
    domain.startSeconds,
    domain.endSeconds - visibleDuration,
  )
  return { startSeconds, endSeconds: startSeconds + visibleDuration }
}

/** One-shot reveal which retains the first pre-selection view across moment switches. */
export function revealSelectionNavigation(args: {
  state: ChartSelectionNavigationState
  viewport: ChartViewport
  rangeValue: ChartRangeValue
  offsetSeconds: number
  domain: ChartDomain
}): ChartSelectionNavigationResult {
  const offsetSeconds = clamp(
    args.offsetSeconds,
    normalizeChartDomain(args.domain).startSeconds,
    normalizeChartDomain(args.domain).endSeconds,
  )
  if (args.state.revealedOffsetSeconds === offsetSeconds) {
    return {
      state: args.state,
      viewport: args.viewport,
      rangeValue: args.rangeValue,
      cause: null,
    }
  }
  if (viewportContainsOffset(args.viewport, offsetSeconds)) {
    return {
      state: { ...args.state, revealedOffsetSeconds: offsetSeconds },
      viewport: args.viewport,
      rangeValue: args.rangeValue,
      cause: null,
    }
  }
  return {
    state: {
      revealedOffsetSeconds: offsetSeconds,
      restore: args.state.restore ?? {
        viewport: args.viewport,
        rangeValue: args.rangeValue,
      },
    },
    viewport: centerViewportOnOffset({
      viewport: args.viewport,
      offsetSeconds,
      domain: args.domain,
    }),
    rangeValue: 'custom',
    cause: 'selection',
  }
}

export function clearSelectionNavigation(args: {
  state: ChartSelectionNavigationState
  viewport: ChartViewport
  rangeValue: ChartRangeValue
  domain: ChartDomain
}): ChartSelectionNavigationResult {
  const restore = args.state.restore
  return {
    state: EMPTY_CHART_SELECTION_NAVIGATION,
    viewport: restore
      ? clampViewportToDomain(restore.viewport, args.domain)
      : args.viewport,
    rangeValue: restore?.rangeValue ?? args.rangeValue,
    cause: restore ? 'restore' : null,
  }
}

export function cancelSelectionNavigation(): ChartSelectionNavigationState {
  return EMPTY_CHART_SELECTION_NAVIGATION
}

function windowDuration(window: ChartTimelineWindow, domain: ChartDomain): number {
  return window === 'full'
    ? chartDomainDuration(domain)
    : CHART_WINDOW_SECONDS[window]
}

export function sourceWindowForDuration(
  durationSeconds: number,
  currentSourceWindow: ChartTimelineWindow,
  domain: ChartDomain,
): ChartTimelineWindow {
  if (currentSourceWindow === 'full') return 'full'
  const currentIndex = WINDOW_ORDER.indexOf(currentSourceWindow)
  const neededIndex = WINDOW_ORDER.findIndex(window =>
    window === 'full' || windowDuration(window, domain) >= durationSeconds - 1,
  )
  return WINDOW_ORDER[Math.max(currentIndex, Math.max(0, neededIndex))] ?? 'full'
}

export function zoomNavigation(args: {
  viewport: ChartViewport
  sourceWindow: ChartTimelineWindow
  domain: ChartDomain
  direction: 'in' | 'out'
}): ChartNavigationResult {
  const domain = normalizeChartDomain(args.domain)
  const currentDuration = viewportDurationSeconds(args.viewport)
  const domainDuration = chartDomainDuration(domain)
  const targetDuration = args.direction === 'in'
    ? Math.max(MIN_VIEWPORT_SECONDS, currentDuration / 2)
    : Math.min(domainDuration, Math.max(MIN_VIEWPORT_SECONDS, currentDuration * 2))
  const viewport = targetDuration >= domainDuration - 1
    ? viewportForRangePreset('full', domain)
    : zoomViewportInDomain({
        viewport: args.viewport,
        zoomSeconds: targetDuration,
        domain,
      })
  const full = isViewportFullDomain(viewport, domain)
  return {
    viewport,
    rangeValue: full ? 'full' : 'custom',
    sourceWindow: sourceWindowForDuration(targetDuration, args.sourceWindow, domain),
  }
}

export function rangeNavigation(
  window: ChartTimelineWindow,
  domain: ChartDomain,
): ChartNavigationResult {
  return {
    viewport: viewportForRangePreset(window, domain),
    rangeValue: window,
    sourceWindow: window,
  }
}
