import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ACTIVITY_BUCKET_STEPS_MINUTES,
  activityBucketMinutesForWidth,
  buildActivityTimeBuckets,
} from '../src/activityTimeBuckets.ts'
import { PulseMultiSignalChartInner } from '../src/PulseMultiSignalChart.tsx'

const START_MS = Date.parse('2026-09-20T00:00:00.000Z')
const minute = (index: number) => START_MS + index * 60_000

describe('activityBucketMinutesForWidth', () => {
  it('keeps one bar per minute while minutes are wide enough', () => {
    expect(activityBucketMinutesForWidth(176, 778)).toBe(1)
    expect(activityBucketMinutesForWidth(15, 340)).toBe(1)
  })

  it('picks the smallest whole bucket that keeps bars readable on long streams', () => {
    // 748 minutes (12.5h) at the 1440px layout's ~654px plot: 0.87px a minute.
    expect(activityBucketMinutesForWidth(748, 654)).toBe(5)
    // The same stream on a phone-width plot (~264px): 0.35px a minute.
    expect(activityBucketMinutesForWidth(748, 264)).toBe(15)
    // A 2.5h stream at desktop width gets 2-minute buckets.
    expect(activityBucketMinutesForWidth(150, 200)).toBe(5)
    expect(activityBucketMinutesForWidth(300, 654)).toBe(2)
  })

  it('only ever returns one of the documented steps', () => {
    for (const minutes of [1, 30, 90, 240, 720, 1440, 4320]) {
      for (const width of [120, 264, 654, 1200]) {
        const step = activityBucketMinutesForWidth(minutes, width)
        expect(ACTIVITY_BUCKET_STEPS_MINUTES).toContain(step)
        if (step < 60) expect(step * (width / minutes)).toBeGreaterThanOrEqual(4)
      }
    }
  })

  it('falls back to one minute for an empty or unmeasured plot', () => {
    expect(activityBucketMinutesForWidth(0, 654)).toBe(1)
    expect(activityBucketMinutesForWidth(748, 0)).toBe(1)
  })
})

describe('buildActivityTimeBuckets', () => {
  it('groups whole, stream-aligned buckets and reports average, peak and range', () => {
    const values = Array.from({ length: 10 }, (_, index) => index + 1)
    const buckets = buildActivityTimeBuckets({
      values,
      timestampsMs: values.map((_, index) => minute(index)),
      bucketMinutes: 5,
      originMs: START_MS,
    })
    expect(buckets).toHaveLength(2)
    expect(buckets[0]).toMatchObject({
      startIndex: 0,
      endExclusive: 5,
      observedCount: 5,
      rangeLength: 5,
      average: 3,
      peak: { index: 4, value: 5 },
      slotStartMs: START_MS,
    })
    expect(buckets[1]).toMatchObject({ startIndex: 5, endExclusive: 10, average: 8, peak: { index: 9, value: 10 } })
  })

  it('aligns buckets to the origin, not to the first visible minute', () => {
    const indices = [3, 4, 5, 6, 7]
    const buckets = buildActivityTimeBuckets({
      values: indices.map(() => 1),
      timestampsMs: indices.map(minute),
      bucketMinutes: 5,
      originMs: START_MS,
    })
    // Minutes 3–4 belong to the 0–5 slot and 5–7 to the 5–10 slot.
    expect(buckets.map(bucket => [bucket.startIndex, bucket.endExclusive, bucket.observedCount])).toEqual([
      [0, 2, 2],
      [2, 5, 3],
    ])
    expect(buckets[0]!.slotStartMs).toBe(START_MS)
    expect(buckets[1]!.slotStartMs).toBe(minute(5))
  })

  it('never bridges a missing minute or a timestamp gap', () => {
    // Minute 2 has no measurement, and minutes 5–7 are absent entirely.
    const timestamps = [0, 1, 2, 3, 4, 8, 9].map(minute)
    const values = [10, 10, null, 10, 10, 20, 20]
    const buckets = buildActivityTimeBuckets({
      values,
      timestampsMs: timestamps,
      bucketMinutes: 5,
      originMs: START_MS,
    })
    expect(buckets.map(bucket => [bucket.firstMs, bucket.lastMs])).toEqual([
      [minute(0), minute(1)],
      [minute(3), minute(4)],
      [minute(8), minute(9)],
    ])
    // Each bar covers only measured minutes, so it is fully observed over its
    // own span; the gap is the empty space between bars, not a dimmed bar.
    expect(buckets.map(bucket => `${bucket.observedCount}/${bucket.rangeLength}`)).toEqual(['2/2', '2/2', '2/2'])
    // Averages use observed minutes only; nothing is invented for the gap.
    expect(buckets.map(bucket => bucket.average)).toEqual([10, 10, 20])
  })

  it('does not report a short bar at the stream edges or beside a gap as partly observed', () => {
    // Production minutes sit a few seconds past the stream start, and the
    // 748-minute stream's first and last 5-minute slots hold 4 minutes each.
    const OFFSET_MS = 7_000
    const present = Array.from({ length: 14 }, (_, index) => index).filter(index => index !== 7)
    const buckets = buildActivityTimeBuckets({
      values: present.map(() => 5),
      timestampsMs: present.map(index => minute(index) + OFFSET_MS),
      bucketMinutes: 5,
      originMs: START_MS,
      // The viewport cuts the last slot after minute 12.
      include: index => present[index]! >= 1 && present[index]! <= 12,
    })
    expect(buckets.map(bucket => [bucket.observedCount, bucket.rangeLength])).toEqual([
      [4, 4], // minutes 1–4: stream start
      [2, 2], // minutes 5–6, before the missing minute 7
      [2, 2], // minutes 8–9, after it
      [3, 3], // minutes 10–12: cut by the viewport
    ])
  })

  it('respects the visible-domain filter', () => {
    const values = Array.from({ length: 10 }, () => 1)
    const buckets = buildActivityTimeBuckets({
      values,
      timestampsMs: values.map((_, index) => minute(index)),
      bucketMinutes: 2,
      originMs: START_MS,
      include: index => index >= 4,
    })
    expect(buckets[0]!.startIndex).toBe(4)
    expect(buckets.reduce((total, bucket) => total + bucket.observedCount, 0)).toBe(6)
  })
})

function longStreamRollups(minutes: number, gap: { from: number; to: number }) {
  const rows = []
  for (let index = 0; index < minutes; index += 1) {
    if (index >= gap.from && index < gap.to) continue
    rows.push({
      minuteTs: new Date(minute(index)).toISOString(),
      viewerAvg: 20_000 + (index % 50) * 100,
      viewerSamples: 2,
      chatCount: 400 + (index % 7) * 40,
      totalEmoteCount: 100 + (index % 11) * 30,
    })
  }
  return rows
}

function activityRects(markup: string, signal: 'chat' | 'emotes') {
  return [...markup.matchAll(new RegExp(`<rect[^>]*data-activity-bar="${signal}"[^>]*>`, 'g'))]
    .map(([rect]) => ({
      x: Number(rect.match(/\bx="([^"]+)"/)?.[1]),
      width: Number(rect.match(/\bwidth="([^"]+)"/)?.[1]),
    }))
}

describe('PulseMultiSignalChartInner time bucketing', () => {
  const MINUTES = 748
  const GAP = { from: 300, to: 312 }
  const rollups = longStreamRollups(MINUTES, GAP)
  const render = (activityBucketing?: 'budget' | 'time') => renderToStaticMarkup(
    <PulseMultiSignalChartInner
      rollups={rollups}
      streamStartedAt={new Date(START_MS).toISOString()}
      durationSeconds={MINUTES * 60}
      variant="console"
      motionEnabled={false}
      activityBucketing={activityBucketing}
    />,
  )

  it('keeps the default budget path unchanged unless the caller opts in', () => {
    const markup = render()
    expect(markup).toContain('data-activity-bucketing="budget"')
    expect(markup).not.toContain('data-activity-bucket-minutes')
  })

  it('draws whole 5-minute bars of at least 3px for a 12.5h stream', () => {
    const markup = render('time')
    // The console plot fills the 1000-unit fallback width.
    expect(markup).toContain('data-activity-bucket-minutes="5"')
    for (const signal of ['chat', 'emotes'] as const) {
      const bars = activityRects(markup, signal)
      // 736 measured minutes in 5-minute slots, split once by the gap.
      expect(bars.length).toBeGreaterThan(140)
      expect(bars.length).toBeLessThanOrEqual(152)
      const widths = bars.map(bar => bar.width)
      const full = widths.filter(width => width >= 3)
      // Only partial buckets at the gap and the stream edges may be narrower.
      expect(widths.length - full.length).toBeLessThanOrEqual(4)
      // Full buckets share one width, so spacing is even (no barcode).
      const fullWidths = new Set(full.map(width => width.toFixed(2)))
      expect(fullWidths.size).toBeLessThanOrEqual(3)
    }
  })

  it('buckets the full-resolution minutes when the chart series is downsampled', () => {
    // Long streams chart a downsampled series (a row every ~3 minutes) and pass
    // the full minutes as detail rollups. Bars must come from the minutes.
    const downsampled = rollups.filter((_, index) => index % 3 === 0)
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={downsampled}
        detailRollups={rollups}
        streamStartedAt={new Date(START_MS).toISOString()}
        durationSeconds={MINUTES * 60}
        variant="console"
        motionEnabled={false}
        activityBucketing="time"
      />,
    )
    expect(markup).toContain('data-activity-bucket-minutes="5"')
    const bars = activityRects(markup, 'chat')
    expect(bars.length).toBeGreaterThan(140)
    expect(bars.length).toBeLessThanOrEqual(152)
    expect(bars.filter(bar => bar.width < 3).length).toBeLessThanOrEqual(4)
    const ranges = [...markup.matchAll(/data-activity-bar="chat"[^>]*data-range-length="(\d+)"/g)].map(match => Number(match[1]))
    // Whole 5-minute buckets, except the bars cut by the gap or the stream end.
    expect(ranges.filter(range => range === 5).length).toBeGreaterThanOrEqual(ranges.length - 3)
    expect(Math.max(...ranges)).toBe(5)
  })

  it('does not dim bars at the stream edges, and marks the bar the gap cuts as partial', () => {
    // Shift every minute 7s past the stream start, as production rows are.
    const shifted = rollups.map(row => ({
      ...row,
      minuteTs: new Date(Date.parse(row.minuteTs) + 7_000).toISOString(),
    }))
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={shifted}
        streamStartedAt={new Date(START_MS).toISOString()}
        durationSeconds={MINUTES * 60 + 7}
        variant="console"
        motionEnabled={false}
        activityBucketing="time"
      />,
    )
    const bars = [...markup.matchAll(/<rect[^>]*data-activity-bar="chat"[^>]*>/g)].map(([rect]) => ({
      ratio: rect.match(/data-observed-ratio="([^"]+)"/)?.[1],
      partial: /data-bar-partial="true"/.test(rect),
    }))
    expect(bars.length).toBeGreaterThan(140)
    // The first and last slots are short (the stream starts and ends there),
    // not partial. Only the slot holding minutes 310-314, whose first two
    // minutes fall in the gap, is partial: 3 of 5 minutes measured.
    expect(bars.filter(bar => bar.partial)).toEqual([{ ratio: '0.600', partial: true }])
    expect(new Set(bars.filter(bar => !bar.partial).map(bar => bar.ratio))).toEqual(new Set(['1.000']))
  })

  it('leaves the missing minutes empty at 1-minute bars and draws no bar across a gap at 5-minute bars', () => {
    const plotLeft = 0
    const plotWidth = 1000
    // Full range (5-minute bars): a bar spans only the minutes it measured.
    const markup = render('time')
    const xFor = (index: number) => plotLeft + (index / (MINUTES - 1)) * plotWidth
    for (const bar of activityRects(markup, 'chat')) {
      const overlaps = bar.x < xFor(GAP.to - 0.5) - 0.01 && bar.x + bar.width > xFor(GAP.from - 0.5) + 0.01
      expect(overlaps).toBe(false)
    }
    // Zoomed to one hour around the gap: one bar per measured minute, none in it.
    const view = { startSeconds: 280 * 60, endSeconds: 340 * 60 }
    const zoomed = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={rollups}
        streamStartedAt={new Date(START_MS).toISOString()}
        durationSeconds={MINUTES * 60}
        viewport={view}
        variant="console"
        motionEnabled={false}
        activityBucketing="time"
      />,
    )
    expect(zoomed).toContain('data-activity-bucket-minutes="1"')
    const zoomX = (index: number) => plotLeft + ((index * 60 - view.startSeconds) / (view.endSeconds - view.startSeconds)) * plotWidth
    const zoomedBars = activityRects(zoomed, 'chat')
    expect(zoomedBars.length).toBeGreaterThanOrEqual(48)
    for (const bar of zoomedBars) {
      const overlaps = bar.x < zoomX(GAP.to - 0.5) - 0.01 && bar.x + bar.width > zoomX(GAP.from - 0.5) + 0.01
      expect(overlaps).toBe(false)
    }
    expect(zoomed).not.toContain('data-bar-partial')
    expect(zoomed).not.toContain('data-activity-bar-peak')
  })

  it('bridges unmeasured minutes inside a slot only above 1-minute bars, and marks that bar partial', () => {
    // Minutes 401 and 402 are reported as missing rows inside the 400-404 slot.
    const withMissing = rollups.map(row => {
      const index = Math.round((Date.parse(row.minuteTs) - START_MS) / 60_000)
      return index === 401 || index === 402 ? { ...row, missing: true, chatCount: null, totalEmoteCount: null } : row
    })
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={withMissing}
        streamStartedAt={new Date(START_MS).toISOString()}
        durationSeconds={MINUTES * 60}
        variant="console"
        motionEnabled={false}
        activityBucketing="time"
      />,
    )
    expect(markup).toContain('data-activity-bucket-minutes="5"')
    const partial = [...markup.matchAll(/<rect[^>]*data-activity-bar="chat"[^>]*data-bar-partial="true"[^>]*>/g)].map(([rect]) => rect)
    expect(partial).toHaveLength(2)
    const xFor = (index: number) => (index / (MINUTES - 1)) * 1000
    const bars = partial.map(rect => ({
      ratio: rect.match(/data-observed-ratio="([^"]+)"/)?.[1],
      x: Number(rect.match(/ x="([^"]+)"/)?.[1]),
      width: Number(rect.match(/ width="([^"]+)"/)?.[1]),
    }))
    // One is the slot the 300-311 gap cuts; the other spans minutes 400-404,
    // across the two unmeasured minutes, with 3 of 5 measured.
    const bridged = bars.find(bar => bar.x > xFor(390))!
    expect(bridged.ratio).toBe('0.600')
    expect(bridged.x).toBeLessThan(xFor(401))
    expect(bridged.x + bridged.width).toBeGreaterThan(xFor(403))
  })

  it('caps a bar whose peak minute stands well above its average, above 1-minute bars only', () => {
    const spiked = rollups.map(row => {
      const index = Math.round((Date.parse(row.minuteTs) - START_MS) / 60_000)
      // Flat chat, except one spike at minute 502.
      return { ...row, chatCount: index === 502 ? 5_000 : 500 }
    })
    const full = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={spiked}
        streamStartedAt={new Date(START_MS).toISOString()}
        durationSeconds={MINUTES * 60}
        variant="console"
        motionEnabled={false}
        activityBucketing="time"
      />,
    )
    expect(full).toContain('data-activity-bucket-minutes="5"')
    const caps = [...full.matchAll(/<rect[^>]*data-activity-bar-peak="chat"[^>]*>/g)]
    expect(caps).toHaveLength(1)
    const zoomed = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={spiked}
        streamStartedAt={new Date(START_MS).toISOString()}
        durationSeconds={MINUTES * 60}
        viewport={{ startSeconds: 480 * 60, endSeconds: 540 * 60 }}
        variant="console"
        motionEnabled={false}
        activityBucketing="time"
      />,
    )
    expect(zoomed).toContain('data-activity-bucket-minutes="1"')
    expect(zoomed).not.toContain('data-activity-bar-peak')
  })
})
