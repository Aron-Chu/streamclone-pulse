import { describe, expect, it } from 'vitest'
import type { LiveHeatPoint } from '@streampulse/pulse-core'
import {
  EMPTY_MOMENT_INSPECTION,
  effectiveInspectionSelection,
  inspectionSelectionFromPoint,
  normalizedInspectionBucket,
  reduceMomentInspection,
  sameInspectionBucket,
} from '../src/ui/momentInspection.ts'

function point(offsetSeconds: number): LiveHeatPoint {
  return {
    minuteTs: '2026-08-15T00:00:00.000Z',
    offsetSeconds,
    score: 50,
    reason: 'chat_spike',
    reasonLabel: 'Chat spike',
    chatCount: 100,
    emoteCount: 20,
    topEmotes: [],
    collecting: false,
  }
}

describe('moment inspection controller', () => {
  it('uses normalized minute identity without adjacent-minute snapping', () => {
    const left = inspectionSelectionFromPoint('chart', point(239))
    const same = inspectionSelectionFromPoint('most-reacted', point(180))
    const adjacent = inspectionSelectionFromPoint('most-reacted', point(240))

    expect(normalizedInspectionBucket(239)).toBe(180)
    expect(sameInspectionBucket(left, same)).toBe(true)
    expect(sameInspectionBucket(left, adjacent)).toBe(false)
  })

  it('retains a ghost preview without replacing a committed selection', () => {
    const committed = inspectionSelectionFromPoint('most-reacted', point(180), 'rank-1')
    const preview = inspectionSelectionFromPoint('most-reacted', point(300), 'rank-2')
    let state = reduceMomentInspection(EMPTY_MOMENT_INSPECTION, {
      type: 'commit',
      selection: committed,
    })
    state = reduceMomentInspection(state, { type: 'preview', selection: preview })
    expect(effectiveInspectionSelection(state)).toBe(committed)
    expect(state.preview).toBe(preview)

    state = reduceMomentInspection(state, { type: 'clear-preview' })
    expect(effectiveInspectionSelection(state)).toBe(committed)

    state = reduceMomentInspection(state, { type: 'toggle', selection: committed })
    expect(state).toEqual(EMPTY_MOMENT_INSPECTION)

    state = reduceMomentInspection(state, { type: 'preview', selection: preview })
    expect(effectiveInspectionSelection(state)).toBe(preview)
  })
})
