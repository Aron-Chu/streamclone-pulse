import { describe, expect, it } from 'vitest'
import type { FigmaMomentRow } from '../src/lib/figmaSessionAnalytics'
import { momentRowKey } from '../src/lib/figmaSessionAnalytics'
import {
  momentKeyInList,
  resolveSelectedPulseMoment,
} from '../src/lib/resolveSelectedPulseMoment'

function moment(login: string, offset = 60): FigmaMomentRow {
  return {
    login,
    label: `${login} spike`,
    offsetSeconds: offset,
    score: 80,
    kind: 'emote_spike',
    at: Date.now(),
  }
}

describe('resolveSelectedPulseMoment', () => {
  it('falls back to the top row when nothing is selected', () => {
    const rows = [moment('xqc'), moment('caseoh_')]
    expect(resolveSelectedPulseMoment(rows, null)?.login).toBe('xqc')
    expect(resolveSelectedPulseMoment(rows, undefined)?.login).toBe('xqc')
  })

  it('keeps an explicit selection when still present', () => {
    const rows = [moment('xqc'), moment('caseoh_')]
    const key = momentRowKey(rows[1]!)
    expect(resolveSelectedPulseMoment(rows, key)?.login).toBe('caseoh_')
  })

  it('falls back when the key is stale', () => {
    const rows = [moment('xqc')]
    expect(resolveSelectedPulseMoment(rows, 'missing-key')?.login).toBe('xqc')
  })

  it('reports key membership', () => {
    const rows = [moment('xqc')]
    expect(momentKeyInList(rows, momentRowKey(rows[0]!))).toBe(true)
    expect(momentKeyInList(rows, null)).toBe(false)
  })
})
