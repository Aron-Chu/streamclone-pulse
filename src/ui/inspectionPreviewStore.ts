import { useSyncExternalStore } from 'react'
import type { InspectionSelection } from './momentInspection.ts'

export interface InspectionPreviewStore {
  getSnapshot: () => InspectionSelection | null
  subscribe: (listener: () => void) => () => void
  set: (selection: InspectionSelection | null) => void
  clear: () => void
}

/**
 * Typed identity prevents legitimate same-minute transitions (for example a
 * chat interval to an emote peak) from being swallowed as duplicate previews.
 */
export function inspectionPreviewIdentity(selection: InspectionSelection | null): string {
  if (!selection) return 'none'
  const type = selection.selectionType ?? 'reaction'
  if (type === 'chat_interval') {
    return `chat:${selection.intervalStartSeconds ?? selection.bucketOffsetSeconds}:${selection.intervalEndSeconds ?? selection.bucketOffsetSeconds + 60}`
  }
  if (type === 'emote_peak') {
    return `emote:${selection.bucketOffsetSeconds}:${selection.seriesIdentity ?? 'aggregate'}`
  }
  if (type === 'minute') return `minute:${selection.bucketOffsetSeconds}`
  return `reaction:${selection.rankedIdentity ?? `${selection.point.reason}:${selection.point.minuteTs}`}:${selection.offsetSeconds}`
}

export function createInspectionPreviewStore(): InspectionPreviewStore {
  let snapshot: InspectionSelection | null = null
  let identity = inspectionPreviewIdentity(snapshot)
  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(selection) {
      const nextIdentity = inspectionPreviewIdentity(selection)
      if (nextIdentity === identity) return
      snapshot = selection
      identity = nextIdentity
      for (const listener of listeners) listener()
    },
    clear() {
      if (snapshot == null) return
      snapshot = null
      identity = 'none'
      for (const listener of listeners) listener()
    },
  }
}

export function useInspectionPreview(store?: InspectionPreviewStore | null): InspectionSelection | null {
  return useSyncExternalStore(
    store?.subscribe ?? (() => () => undefined),
    store?.getSnapshot ?? (() => null),
    () => null,
  )
}
