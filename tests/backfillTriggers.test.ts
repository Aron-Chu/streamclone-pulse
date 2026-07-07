import { describe, expect, it } from 'vitest'
import {
  shouldSendLoadMissedMomentsMessage,
  type BackfillUserAction,
} from '../src/ui/backfillTriggers.ts'

const noPostActions: BackfillUserAction[] = [
  'load_stream_from_start',
  'refresh_vod_status',
  'vod_hint_only',
  'chart_select',
  'chart_hover',
  'jump_moment',
  'open_analytics',
]

describe('backfill trigger guard', () => {
  it('only explicit CoverageCard load may POST LOAD_MISSED_MOMENTS', () => {
    for (const action of noPostActions) {
      expect(shouldSendLoadMissedMomentsMessage(action)).toBe(false)
    }
    expect(shouldSendLoadMissedMomentsMessage('explicit_coverage_load')).toBe(true)
  })
})
