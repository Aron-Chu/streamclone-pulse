import { act, renderHook } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearHubBucketSelection,
  closeHubInterval,
  escapeHubBucketSelection,
  getHubBucketSelectionSnapshot,
  getHubChartBridge,
  HUB_DOCK_SLOT_ID,
  HUB_SHEET_ROOT_ID,
  hubBucketSelectionStore,
  isHubGestureActive,
  openHubInterval,
  resetHubBucketSelectionForTests,
  selectHubBucket,
  setHubCardPlacement,
  setHubChartBridge,
  setHubGestureActive,
  subscribeHubBucketSelection,
  subscribeHubChartBridge,
  toggleHubBucket,
  type HubBucketSelectionValue,
  type HubChartBridge,
} from '../src/lib/hubBucketSelection'

const MIN = 60_000
const T0 = Date.UTC(2026, 9, 11, 19, 0)
const bar = (i: number, extra: Partial<HubBucketSelectionValue> = {}): HubBucketSelectionValue => ({
  t: T0 + i * 6 * MIN, endT: T0 + (i + 1) * 6 * MIN, barMinutes: 6, source: 'bar', ...extra,
})

beforeEach(() => {
  resetHubBucketSelectionForTests()
})

describe('hub bucket selection store', () => {
  it('exports the slot ids U4 renders and U7 portals into', () => {
    expect(HUB_DOCK_SLOT_ID).toBe('hub-dock-slot')
    expect(HUB_SHEET_ROOT_ID).toBe('hub-sheet-root')
  })

  it('selects, swaps in place keeping the placement, and closes the list on a swap', () => {
    const listener = vi.fn()
    subscribeHubBucketSelection(listener)
    selectHubBucket(bar(0, { openerId: 'bar-0' }))
    expect(getHubBucketSelectionSnapshot()).toEqual({ selection: bar(0, { openerId: 'bar-0' }), placement: null, intervalOpen: false })
    setHubCardPlacement('callout')
    openHubInterval()
    expect(getHubBucketSelectionSnapshot()).toMatchObject({ placement: 'callout', intervalOpen: true })

    selectHubBucket(bar(3))
    expect(getHubBucketSelectionSnapshot()).toEqual({ selection: bar(3), placement: 'callout', intervalOpen: false })
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('keeps a stable snapshot and stays silent on no-op writes', () => {
    selectHubBucket(bar(1))
    const snapshot = getHubBucketSelectionSnapshot()
    const listener = vi.fn()
    subscribeHubBucketSelection(listener)
    selectHubBucket(bar(1))
    closeHubInterval()
    expect(getHubBucketSelectionSnapshot()).toBe(snapshot)
    expect(listener).not.toHaveBeenCalled()
    // Same bucket from another source only updates the source and keeps the list.
    openHubInterval()
    selectHubBucket(bar(1, { source: 'keyboard' }))
    expect(getHubBucketSelectionSnapshot()).toMatchObject({ selection: { source: 'keyboard' }, intervalOpen: true })
  })

  it('rejects invalid selections', () => {
    selectHubBucket({ ...bar(0), endT: T0 })
    selectHubBucket({ ...bar(0), t: Number.NaN })
    selectHubBucket({ ...bar(0), barMinutes: 0 })
    expect(getHubBucketSelectionSnapshot().selection).toBeNull()
  })

  it('toggles: a second click on the same bucket clears it', () => {
    toggleHubBucket(bar(2))
    expect(getHubBucketSelectionSnapshot().selection?.t).toBe(bar(2).t)
    toggleHubBucket(bar(4))
    expect(getHubBucketSelectionSnapshot().selection?.t).toBe(bar(4).t)
    setHubCardPlacement('dock')
    toggleHubBucket(bar(4))
    expect(getHubBucketSelectionSnapshot()).toEqual({ selection: null, placement: null, intervalOpen: false })
  })

  it('escapes in layers: the interval list first, then the card, then nothing', () => {
    selectHubBucket(bar(0))
    setHubCardPlacement('sheet')
    openHubInterval()
    expect(escapeHubBucketSelection()).toBe('interval')
    expect(getHubBucketSelectionSnapshot()).toMatchObject({ selection: bar(0), placement: 'sheet', intervalOpen: false })
    expect(escapeHubBucketSelection()).toBe('card')
    expect(getHubBucketSelectionSnapshot()).toEqual({ selection: null, placement: null, intervalOpen: false })
    expect(escapeHubBucketSelection()).toBeNull()
  })

  it('needs a selection for a placement or an open list', () => {
    setHubCardPlacement('dock')
    openHubInterval()
    expect(getHubBucketSelectionSnapshot()).toEqual({ selection: null, placement: null, intervalOpen: false })
    selectHubBucket(bar(0))
    setHubCardPlacement('dock')
    clearHubBucketSelection()
    expect(getHubBucketSelectionSnapshot().placement).toBeNull()
  })

  it('offers the same actions as one store object for useSyncExternalStore', () => {
    const highlight = renderHook(() => useSyncExternalStore(hubBucketSelectionStore.subscribe, hubBucketSelectionStore.getSnapshot, hubBucketSelectionStore.getServerSnapshot))
    const card = renderHook(() => useSyncExternalStore(hubBucketSelectionStore.subscribe, hubBucketSelectionStore.getSnapshot))
    act(() => hubBucketSelectionStore.select(bar(5)))
    // The bar highlight and the card read the same snapshot object.
    expect(highlight.result.current).toBe(card.result.current)
    expect(card.result.current.selection?.t).toBe(bar(5).t)
    act(() => {
      hubBucketSelectionStore.setPlacement('callout')
      hubBucketSelectionStore.openInterval()
    })
    expect(card.result.current).toMatchObject({ placement: 'callout', intervalOpen: true })
    act(() => { hubBucketSelectionStore.escape() })
    act(() => { hubBucketSelectionStore.toggle(bar(5)) })
    expect(highlight.result.current.selection).toBeNull()
    act(() => hubBucketSelectionStore.select(bar(6)))
    act(() => hubBucketSelectionStore.clear())
    act(() => hubBucketSelectionStore.closeInterval())
    expect(hubBucketSelectionStore.getServerSnapshot()).toEqual({ selection: null, placement: null, intervalOpen: false })
  })
})

describe('hub chart bridge and gesture flag', () => {
  const makeBridge = (): HubChartBridge => ({
    subscribeFrame: () => () => {},
    xOfMs: (ms) => (ms - T0) / MIN,
    plotElement: () => null,
    panToMs: vi.fn(),
  })

  it('registers a bridge, notifies, and only its own disposer removes it', () => {
    const listener = vi.fn()
    subscribeHubChartBridge(listener)
    const first = makeBridge()
    const disposeFirst = setHubChartBridge(first)
    expect(getHubChartBridge()).toBe(first)
    expect(getHubChartBridge()?.xOfMs(T0 + 6 * MIN)).toBe(6)

    const second = makeBridge()
    const disposeSecond = setHubChartBridge(second)
    // A remount's late cleanup of the first chart must not remove the second.
    disposeFirst()
    expect(getHubChartBridge()).toBe(second)
    disposeSecond()
    expect(getHubChartBridge()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(3)
    setHubChartBridge(null)
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('holds the gesture flag until settle', () => {
    expect(isHubGestureActive()).toBe(false)
    setHubGestureActive(true)
    expect(isHubGestureActive()).toBe(true)
    setHubGestureActive(false)
    expect(isHubGestureActive()).toBe(false)
  })
})
