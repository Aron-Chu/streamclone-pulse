import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ExtensionRollup } from '../src/shared/messages.ts'
import { findChartIndexByOffset } from '../src/ui/chatActivityEmotes.ts'
import { viewportBucketRanges, viewportBuckets } from '../src/ui/chartViewport.ts'
import { downsampleRollupsForChart, EXTENSION_CHART_MAX_POINTS } from '../src/ui/extensionChartPoints.ts'
import { PulseOverviewChart } from '../src/ui/PulseOverviewChart.tsx'

/**
 * A Top Moments pick pins a source minute. Past 120 minutes in view the chart
 * draws one (the most active) minute per bucket, and the pin used to lock only
 * when the picked minute was that drawn one: on a 33h Full chart 120 of 480
 * picks drew a lock, the rest left the chart idle. It now locks the drawn
 * point of the bucket that contains the minute.
 */

function series(count: number, stepSeconds: number): ExtensionRollup[] {
  return Array.from({ length: count }, (_, index) => ({
    offsetSeconds: index * stepSeconds,
    // Jitter, so a bucket's most active minute is not always its first.
    chatCount: 20 + ((index * 37) % 23),
    sevenTvEmoteCount: (index * 11) % 7,
    totalEmoteCount: (index * 13) % 9,
  }))
}

const attr = (html: string, name: string) => html.match(new RegExp(`${name}="([^"]+)"`))?.[1] ?? null

/** Indices a rendered chart has a lock for, or `null` when it drew none. */
function lockFor(props: Parameters<typeof PulseOverviewChart>[0]): number | null {
  const locked = attr(renderToStaticMarkup(<PulseOverviewChart {...props} />), 'data-chart-locked-index')
  return locked == null ? null : Number(locked)
}

describe('viewportBucketRanges', () => {
  it('lists the source span behind each drawn point, matching the thinning', () => {
    const rollups = series(2031, 60)
    for (const viewport of [
      { startSeconds: 0, endSeconds: 2031 * 60 },
      { startSeconds: 2031 * 60 - 4 * 3600, endSeconds: 2031 * 60 },
      { startSeconds: 600, endSeconds: 600 + 90 * 60 },
    ]) {
      const drawn = viewportBuckets(rollups, viewport, EXTENSION_CHART_MAX_POINTS)
      const ranges = viewportBucketRanges(rollups, viewport, EXTENSION_CHART_MAX_POINTS)
      expect(ranges).toHaveLength(drawn.length)
      ranges.forEach(([start, end], index) => {
        expect(end).toBeGreaterThan(start)
        // Each drawn point is a real minute from its own span.
        expect(rollups.slice(start, end)).toContain(drawn[index])
        if (index > 0) expect(start).toBe(ranges[index - 1][1])
      })
    }
  })

  it('covers the whole source without a viewport, like downsampleRollupsForChart', () => {
    for (const count of [90, 480]) {
      const rollups = series(count, 60)
      const drawn = downsampleRollupsForChart(rollups)
      const ranges = viewportBucketRanges(rollups, null, EXTENSION_CHART_MAX_POINTS)
      expect(ranges).toHaveLength(drawn.length)
      expect(ranges[0][0]).toBe(0)
      expect(ranges.at(-1)![1]).toBe(count)
      ranges.forEach(([start, end], index) => expect(rollups.slice(start, end)).toContain(drawn[index]))
    }
  })

  it('is empty outside the data and for an empty viewport', () => {
    const rollups = series(10, 60)
    expect(viewportBucketRanges(rollups, { startSeconds: 3600, endSeconds: 7200 }, 120)).toEqual([])
    expect(viewportBucketRanges(rollups, { startSeconds: 300, endSeconds: 300 }, 120)).toEqual([])
    expect(viewportBucketRanges([], null, 120)).toEqual([])
  })
})

describe('chart lock for a pinned source minute', () => {
  it('locks every minute of a short stream on its own point', () => {
    const rollups = series(90, 60)
    for (let index = 0; index < rollups.length; index += 1) {
      expect(lockFor({ rollups, durationSeconds: 5400, viewport: { startSeconds: 0, endSeconds: 5400 }, selectedIndex: index })).toBe(index)
    }
  })

  it('locks every one of 480 Full buckets of a 33h stream on the drawn point that contains it', () => {
    const step = Math.round((33 * 3600 + 51 * 60) / 480)
    const rollups = series(480, step)
    const duration = 480 * step
    const viewport = { startSeconds: 0, endSeconds: duration }
    for (let index = 0; index < rollups.length; index += 1) {
      // 480 source buckets thin to 120 drawn points, four to a point.
      expect(lockFor({ rollups, durationSeconds: duration, viewport, selectedIndex: index })).toBe(Math.floor(index / 4))
    }
    // A Top Moment at 00:18:13, pinned the way LiveStatsBand maps it.
    const pinned = findChartIndexByOffset(rollups.map(rollup => rollup.offsetSeconds), 18 * 60 + 13, { bucketed: true })
    const html = renderToStaticMarkup(
      <PulseOverviewChart rollups={rollups} durationSeconds={duration} viewport={viewport} selectedIndex={pinned} />,
    )
    expect(attr(html, 'data-chart-mode')).toBe('locked')
  })

  it('locks every minute of a 4h window on full minute history (two minutes to a point)', () => {
    const rollups = series(2031, 60)
    const end = 2031 * 60
    const viewport = { startSeconds: end - 4 * 3600, endSeconds: end }
    const first = rollups.findIndex(rollup => rollup.offsetSeconds >= viewport.startSeconds)
    for (let index = first; index < rollups.length; index += 7) {
      expect(lockFor({ rollups, durationSeconds: end, viewport, selectedIndex: index })).toBe(Math.floor((index - first) / 2))
    }
    // A minute outside the window still draws no lock.
    expect(lockFor({ rollups, durationSeconds: end, viewport, selectedIndex: first - 1 })).toBeNull()
  })

  it('previews a hovered Top Moments row the same way', () => {
    const step = 254
    const rollups = series(480, step)
    const duration = 480 * step
    const html = renderToStaticMarkup(
      <PulseOverviewChart rollups={rollups} durationSeconds={duration} viewport={{ startSeconds: 0, endSeconds: duration }} previewIndex={201} />,
    )
    expect(attr(html, 'data-chart-mode')).toBe('preview')
    expect(attr(html, 'data-chart-preview-index')).toBe('50')
  })
})
