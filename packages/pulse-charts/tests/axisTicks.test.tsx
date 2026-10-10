import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { keepUncrowdedAxisLabels, niceMinuteTickIndices } from '../src/axisTicks.ts'
import { PulseMultiSignalChartInner } from '../src/PulseMultiSignalChart.tsx'

// A stream that started 31 seconds past a minute, as kaicenat's did: offsets end in :29.
const START_MS = Date.parse('2026-10-09T23:46:31.000Z')
const minuteOffsets = (count: number, from = 0) => Array.from({ length: count }, (_, index) => 29 + (from + index) * 60)

describe('niceMinuteTickIndices', () => {
  it('puts 12-, 13- and 14-minute views on a whole 2-minute step, never on neighbouring minutes', () => {
    for (const minutes of [12, 13, 14]) {
      const indices = niceMinuteTickIndices(minuteOffsets(minutes + 1), 8)!
      expect(indices[0]).toBe(0)
      const steps = indices.slice(1).map((index, k) => index - indices[k]!)
      expect(new Set(steps)).toEqual(new Set([2]))
      expect(indices.length).toBeLessThanOrEqual(8)
    }
  })

  it('picks the smallest nice step that fits the tick budget', () => {
    expect(niceMinuteTickIndices(minuteOffsets(6), 8)).toEqual([0, 1, 2, 3, 4, 5])
    // 60 minutes, 8 ticks: 10-minute steps.
    expect(niceMinuteTickIndices(minuteOffsets(61), 8)).toEqual([0, 10, 20, 30, 40, 50, 60])
    // 748 minutes on a phone (3 ticks): 6-hour steps.
    expect(niceMinuteTickIndices(minuteOffsets(749), 3)).toEqual([0, 360, 720])
  })

  it('skips a tick that falls in a gap instead of moving it onto other data', () => {
    // Minutes 0-9 and 20-30; the 10-minute tick has no point within half a step.
    const offsets = [...minuteOffsets(10), ...minuteOffsets(11, 20)]
    const indices = niceMinuteTickIndices(offsets, 8)!
    const labelled = indices.map(index => (offsets[index]! - 29) / 60)
    expect(labelled).toEqual([0, 5, 20, 25, 30])
  })

  it('snaps downsampled points to the nearest point on the step', () => {
    // Every third minute of a 90-minute stream.
    const offsets = Array.from({ length: 31 }, (_, index) => 29 + index * 180)
    const labelled = niceMinuteTickIndices(offsets, 8)!.map(index => (offsets[index]! - 29) / 60)
    expect(labelled).toEqual([0, 15, 30, 45, 60, 75, 90])
  })

  it('falls back (null) when an offset is unknown', () => {
    expect(niceMinuteTickIndices([0, null, 120], 8)).toBeNull()
    expect(niceMinuteTickIndices([], 8)).toEqual([])
    expect(niceMinuteTickIndices([29], 8)).toEqual([0])
  })
})

describe('keepUncrowdedAxisLabels', () => {
  it('drops a label that would come within 8px of the one before it', () => {
    const labels = [0, 60, 70, 140].map(centerX => ({ centerX, halfWidth: 30 }))
    expect(keepUncrowdedAxisLabels(labels).map(label => label.centerX)).toEqual([0, 70, 140])
  })
})

function axisLabels(markup: string) {
  return [...markup.matchAll(/<text x="([\d.]+)"[^>]*data-chart-x-axis-label="true"[^>]*>([^<]+)<\/text>/g)]
    .map(match => ({ x: Number(match[1]), label: match[2]! }))
}

describe('console chart x axis', () => {
  it('keeps every elapsed label clear of its neighbours on a 14-minute live view', () => {
    // Owner report: the 21-minute kaicenat stream at 1440px had 00:12:29 and 00:13:29 touching.
    for (const minutes of [12, 13, 14]) {
      const rollups = Array.from({ length: minutes + 1 }, (_, index) => ({
        minuteTs: new Date(START_MS + 29_000 + index * 60_000).toISOString(),
        viewerAvg: 48_000,
        viewerSamples: 2,
        chatCount: 500,
        totalEmoteCount: 80,
        emotes: {},
      }))
      const markup = renderToStaticMarkup(
        <PulseMultiSignalChartInner
          rollups={rollups}
          streamStartedAt={new Date(START_MS).toISOString()}
          durationSeconds={29 + minutes * 60}
          variant="console"
          motionEnabled={false}
        />,
      )
      const labels = axisLabels(markup)
      expect(labels.length).toBeGreaterThan(2)
      for (let index = 1; index < labels.length; index += 1) {
        const previous = labels[index - 1]!
        const current = labels[index]!
        const halfWidths = previous.label.length * 3.9 + 1 + current.label.length * 3.9 + 1
        expect(current.x - previous.x - halfWidths).toBeGreaterThanOrEqual(8)
      }
      // Whole 2-minute steps from the first visible minute.
      expect(labels.map(label => label.label).slice(0, 3)).toEqual(['00:00:29', '00:02:29', '00:04:29'])
    }
  })
})
