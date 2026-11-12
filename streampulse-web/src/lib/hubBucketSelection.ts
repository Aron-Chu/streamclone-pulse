/**
 * Hub bucket selection: one external store shared by the activity chart (U6),
 * the bucket card (U7) and the shell (U4). Plan §2.3.
 *
 * The bar highlight and the card mount read the same snapshot, so both land
 * in the same React commit (useSyncExternalStore). The store holds plain data
 * only; it never fetches and never formats.
 *
 * Also here, because every hub unit needs them and they must not import UI:
 * - the chart bridge (viewport frames, x of a time, the plot element, pan);
 * - the gesture flag (wheel/drag in progress), read by the idle cache writer.
 */

export type HubSelectionSource = 'bar' | 'latest' | 'keyboard'

export type HubCardPlacement = 'dock' | 'callout' | 'sheet'

export interface HubBucketSelectionValue {
  /** Bucket start (unix ms), aligned to the bar the user picked. */
  t: number
  /** Bucket end (unix ms, exclusive). */
  endT: number
  /** Nominal bar length in minutes (a server bucket or a wider zoomed-out bar). */
  barMinutes: number
  source: HubSelectionSource
  /** Element id that opened the card; focus returns there on close. */
  openerId?: string
}

export interface HubBucketSelectionState {
  selection: HubBucketSelectionValue | null
  placement: HubCardPlacement | null
  intervalOpen: boolean
}

/** Rail slot the docked card portals into (U4 renders it inside `[data-hub-latest]`). */
export const HUB_DOCK_SLOT_ID = 'hub-dock-slot'
/** Root the bottom sheet portals into (U4 renders it at the end of the hub grid). */
export const HUB_SHEET_ROOT_ID = 'hub-sheet-root'

const EMPTY_STATE: HubBucketSelectionState = Object.freeze({
  selection: null,
  placement: null,
  intervalOpen: false,
}) as HubBucketSelectionState

let state: HubBucketSelectionState = EMPTY_STATE
const listeners = new Set<() => void>()

function emit(next: HubBucketSelectionState): void {
  if (
    next.selection === state.selection &&
    next.placement === state.placement &&
    next.intervalOpen === state.intervalOpen
  ) {
    return
  }
  state = next
  for (const listener of [...listeners]) listener()
}

function validSelection(value: HubBucketSelectionValue): boolean {
  return (
    Number.isFinite(value.t) &&
    Number.isFinite(value.endT) &&
    value.endT > value.t &&
    Number.isFinite(value.barMinutes) &&
    value.barMinutes > 0
  )
}

function sameBucket(a: HubBucketSelectionValue | null, t: number, endT?: number): boolean {
  if (!a) return false
  return a.t === t && (endT == null || a.endT === endT)
}

/** Subscribe to every change. Returns the unsubscribe function. */
export function subscribeHubBucketSelection(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The current immutable snapshot (stable identity between changes). */
export function getHubBucketSelectionSnapshot(): HubBucketSelectionState {
  return state
}

/**
 * Select a bucket. Selecting a different bucket swaps the card content in
 * place and keeps the placement; the interval list closes because it belongs
 * to the previous bucket. Re-selecting the same bucket only updates its source.
 */
export function selectHubBucket(value: HubBucketSelectionValue): void {
  if (!validSelection(value)) return
  const current = state.selection
  if (current && current.t === value.t && current.endT === value.endT && current.barMinutes === value.barMinutes &&
    current.source === value.source && current.openerId === value.openerId) {
    return
  }
  const swapped = !sameBucket(current, value.t, value.endT)
  emit({
    selection: { ...value },
    placement: state.placement,
    intervalOpen: swapped ? false : state.intervalOpen,
  })
}

/**
 * Bar click: a second click on the selected bucket clears it (the card closes);
 * any other bucket is selected.
 */
export function toggleHubBucket(value: HubBucketSelectionValue): void {
  if (sameBucket(state.selection, value.t)) {
    clearHubBucketSelection()
    return
  }
  selectHubBucket(value)
}

/** Close the card and the list. */
export function clearHubBucketSelection(): void {
  emit(EMPTY_STATE)
}

/**
 * Layered Esc (B8): the interval list closes first, then the card.
 * Returns what it closed, so a caller can stop the key event only when
 * something closed.
 */
export function escapeHubBucketSelection(): 'interval' | 'card' | null {
  if (state.intervalOpen) {
    emit({ ...state, intervalOpen: false })
    return 'interval'
  }
  if (state.selection) {
    clearHubBucketSelection()
    return 'card'
  }
  return null
}

/** U7 writes back the placement it picked; null while no card is shown. */
export function setHubCardPlacement(placement: HubCardPlacement | null): void {
  emit({ ...state, placement: state.selection ? placement : null })
}

/** "Show N moments": opens the interval list for the selected bucket. */
export function openHubInterval(): void {
  if (!state.selection) return
  emit({ ...state, intervalOpen: true })
}

export function closeHubInterval(): void {
  emit({ ...state, intervalOpen: false })
}

/** The store as one object, for callers that prefer `store.select(...)`. */
export const hubBucketSelectionStore = {
  subscribe: subscribeHubBucketSelection,
  getSnapshot: getHubBucketSelectionSnapshot,
  getServerSnapshot: (): HubBucketSelectionState => EMPTY_STATE,
  select: selectHubBucket,
  toggle: toggleHubBucket,
  clear: clearHubBucketSelection,
  escape: escapeHubBucketSelection,
  setPlacement: setHubCardPlacement,
  openInterval: openHubInterval,
  closeInterval: closeHubInterval,
} as const

/* ---------------------------------------------------------------------------
 * Chart bridge: the hub chart (U6) registers it; the card (U7) follows frames
 * for the callout and the edge tab without React state, and Latest moments
 * (U4) pans to a bucket through it.
 * ------------------------------------------------------------------------- */

export interface HubChartBridge {
  /** Called once per rendered viewport frame. Returns the unsubscribe function. */
  subscribeFrame(listener: () => void): () => void
  /** Plot-local x (CSS px) of a time, or null when the time is outside the view. */
  xOfMs(ms: number): number | null
  /** The plot element (bounds for the callout and edge tab), or null before mount. */
  plotElement(): HTMLElement | null
  /** Pan (not zoom) so that `ms` is in view. */
  panToMs(ms: number): void
  /** The bar before (-1) or after (1) the one holding `ms`, at the chart's current level; null at either end. */
  stepBar?(ms: number, dir: -1 | 1): Pick<HubBucketSelectionValue, 't' | 'endT' | 'barMinutes'> | null
  /** Zoom (animated) so that [startMs, endMs) fills the plot. */
  zoomToMs?(startMs: number, endMs: number): void
  /** Focus the plot (where focus goes back when the card closes). */
  focusPlot?(): void
}

let bridge: HubChartBridge | null = null
const bridgeListeners = new Set<() => void>()

/** Register (or with null, remove) the chart bridge. Returns a disposer that only removes this bridge. */
export function setHubChartBridge(next: HubChartBridge | null): () => void {
  if (bridge !== next) {
    bridge = next
    for (const listener of [...bridgeListeners]) listener()
  }
  return () => {
    if (bridge === next && next != null) {
      bridge = null
      for (const listener of [...bridgeListeners]) listener()
    }
  }
}

export function getHubChartBridge(): HubChartBridge | null {
  return bridge
}

/** Notified when the bridge is registered or removed. */
export function subscribeHubChartBridge(listener: () => void): () => void {
  bridgeListeners.add(listener)
  return () => {
    bridgeListeners.delete(listener)
  }
}

/* ---------------------------------------------------------------------------
 * Gesture flag: true from wheel/drag start to settle. Idle work (the hub
 * cache write) waits while it is set, so it never lands inside a gesture.
 * ------------------------------------------------------------------------- */

let gestureActive = false

export function setHubGestureActive(active: boolean): void {
  gestureActive = active
}

export function isHubGestureActive(): boolean {
  return gestureActive
}

/** Test helper: back to the initial state (no selection, no bridge, no gesture). */
export function resetHubBucketSelectionForTests(): void {
  state = EMPTY_STATE
  listeners.clear()
  bridge = null
  bridgeListeners.clear()
  gestureActive = false
}
