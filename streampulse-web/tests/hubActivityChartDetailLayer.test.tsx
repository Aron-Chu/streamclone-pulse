import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HubActivityChart, buildLinearLine, splitLinePaths } from '../src/ui/components/hub/HubActivityChart'
import { resolveChartBucketSelection } from '../src/lib/hubActivitySummary'
import type { HubActivityPoint } from '../src/lib/publicHub'

function makeSource(timestamps: number[]): HubActivityPoint[] {
  return timestamps.map((t) => ({
    t,
    chat: 0,
    seventv: 0,
    viewers: 0,
  }))
}

function makePoints(): Array<{ t: number; chat: number; seventv: number; viewers: number; emotes: number; hasChatRollup?: boolean; bucketComplete?: boolean }> {
  const end = Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000
  return [
    { t: end - 4 * 60_000, chat: 5, seventv: 0, viewers: 100, emotes: 6, hasChatRollup: true, bucketComplete: true },
    { t: end - 3 * 60_000, chat: 6, seventv: 0, viewers: 110, emotes: 7, hasChatRollup: true, bucketComplete: true },
    { t: end - 2 * 60_000, chat: 4, seventv: 0, viewers: 120, emotes: 5, hasChatRollup: true, bucketComplete: true },
    { t: end - 1 * 60_000, chat: 8, seventv: 0, viewers: 130, emotes: 9, hasChatRollup: true, bucketComplete: true },
    { t: end, chat: 9, seventv: 0, viewers: 140, emotes: 10, hasChatRollup: true, bucketComplete: true },
  ]
}

describe('buildLinearLine (Phase 2a detail path builder)', () => {
  it('returns empty for fewer than 2 points', () => {
    expect(buildLinearLine([])).toBe('')
    expect(buildLinearLine([{ x: 1, y: 2 }])).toBe('')
  })

  it('emits M then L commands with two decimals', () => {
    const d = buildLinearLine([
      { x: 0.1, y: 0.2 },
      { x: 10.123456, y: 20.987654 },
      { x: 30, y: 40 },
    ])
    expect(d).toBe('M 0.10 0.20 L 10.12 20.99 L 30.00 40.00')
  })

  it('differs from buildLine (smooth) by never emitting C / curve commands', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
      { x: 30, y: 10 },
    ]
    const linear = buildLinearLine(pts)
    expect(linear).not.toMatch(/\bC\b/)
    expect(linear.startsWith('M ')).toBe(true)
    expect(linear.match(/\bL\b/g)?.length).toBe(3)
  })
})

describe('splitLinePaths geometry parameter (Phase 2a)', () => {
  const src = makeSource([1_000, 2_000, 3_000])
  const pts = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 20, y: 0 },
  ]

  it('returns empty for fewer than 2 points', () => {
    expect(splitLinePaths([], src, 5)).toEqual([])
    expect(splitLinePaths([{ x: 1, y: 2 }], src, 5)).toEqual([])
  })

  it('smooth geometry produces at least one path with C commands', () => {
    const paths = splitLinePaths(pts, src, 5, undefined, undefined, 'smooth')
    expect(paths.length).toBeGreaterThan(0)
    expect(paths[0]).toMatch(/\bC\b/)
  })

  it('linear geometry produces paths without C commands (straight segments only)', () => {
    const paths = splitLinePaths(pts, src, 5, undefined, undefined, 'linear')
    expect(paths.length).toBeGreaterThan(0)
    for (const p of paths) {
      expect(p).not.toMatch(/\bC\b/)
      expect(p.startsWith('M ')).toBe(true)
    }
  })

  it('returns one continuous path when all buckets have non-zero samples', () => {
    const sampleValues = [1, 1, 1]
    const smoothPaths = splitLinePaths(pts, src, 5, sampleValues, undefined, 'smooth')
    const linearPaths = splitLinePaths(pts, src, 5, sampleValues, undefined, 'linear')
    expect(smoothPaths.length).toBe(1)
    expect(linearPaths.length).toBe(1)
  })

  it('splits the run into multiple segments at a zero-value bucket', () => {
    const allSample = [1, 1, 1, 1, 1]
    const withZero = [1, 1, 0, 1, 1]
    const continuousSource = makeSource([0, 60_000, 120_000, 180_000, 240_000])
    const continuousPts = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 5 },
      { x: 30, y: 8 },
      { x: 40, y: 12 },
    ]
    const baseline = splitLinePaths(continuousPts, continuousSource, 5, allSample, undefined, 'linear')
    const split = splitLinePaths(continuousPts, continuousSource, 5, withZero, undefined, 'linear')
    expect(baseline.length).toBe(1)
    expect(split.length).toBeGreaterThanOrEqual(2)
  })
})

describe('resolveChartBucketSelection (Phase 2a unchanged contract)', () => {
  it('returns undefined when no point provided', () => {
    expect(resolveChartBucketSelection(undefined, null)).toBeUndefined()
  })

  it('returns null to clear selection when the same bucket is clicked twice', () => {
    const pt = { t: 1, chat: 1, seventv: 0, viewers: 0, emotes: 0, hasChatRollup: true, bucketComplete: true }
    expect(resolveChartBucketSelection(pt, 1)).toBeNull()
  })

  it('returns point.t for a fresh, signal-bearing bucket', () => {
    const pt = { t: 5, chat: 1, seventv: 0, viewers: 0, emotes: 0, hasChatRollup: true, bucketComplete: true }
    expect(resolveChartBucketSelection(pt, 1)).toBe(5)
  })
})

describe('HubActivityChart detail-layer render (Phase 2a)', () => {
  it('renders a detail layer with linear-segment paths and an aria-hidden group', () => {
    const { container } = render(<HubActivityChart points={makePoints()} windowMinutes={5} channelCount={1} />)
    const detailLayers = container.querySelectorAll('.hx-chart-detail-layer')
    expect(detailLayers.length).toBe(1)
    expect(detailLayers[0].getAttribute('aria-hidden')).toBe('true')
    const detailPaths = container.querySelectorAll('.hx-chart-detail-layer .hx-chart-line')
    expect(detailPaths.length).toBeGreaterThan(0)
    for (const p of Array.from(detailPaths)) {
      const d = p.getAttribute('d') ?? ''
      expect(d).not.toMatch(/\bC\b/)
      expect(d.startsWith('M ')).toBe(true)
    }
  })

  it('rest area paths use smooth geometry (with C commands)', () => {
    const { container } = render(<HubActivityChart points={makePoints()} windowMinutes={5} channelCount={1} />)
    // Rest lines use Catmull-Rom splines (C commands); the detail overlay
    // is a separate group with linear (M/L only) geometry. Verify the rest
    // class is rendered with smooth commands and that it is not the detail
    // overlay class.
    const restLines = container.querySelectorAll('.hx-chart-line--viewers:not(.hx-chart-line--viewers-detail), .hx-chart-line--emotes:not(.hx-chart-line--emotes-detail)')
    expect(restLines.length).toBeGreaterThan(0)
    const allRestD = Array.from(restLines)
      .map((p) => p.getAttribute('d') ?? '')
      .join(' ')
    expect(allRestD).toMatch(/\bC\b/)
  })

  it('detail layer is always rendered and starts inactive (no data-active attribute) at rest', () => {
    const { container } = render(<HubActivityChart points={makePoints()} windowMinutes={5} channelCount={1} />)
    const detail = container.querySelector('.hx-chart-detail-layer')
    expect(detail).not.toBeNull()
    // At rest, no hover is active — data-active is omitted (not 'false').
    expect(detail?.hasAttribute('data-active')).toBe(false)
  })

  it('sr region is announced politely and is the chart\'s only live region', () => {
    const { container } = render(<HubActivityChart points={makePoints()} windowMinutes={5} channelCount={1} />)
    const live = container.querySelector('.hx-chart-sr')
    expect(live).not.toBeNull()
    // role="status" carries an implicit aria-live="polite"; B-05 removed the redundant explicit attribute.
    expect(live?.getAttribute('role') === 'status' || live?.getAttribute('aria-live') === 'polite').toBe(true)
    // B-05 regression guard: nested live regions flood screen readers during scrub.
    expect(container.querySelectorAll('.hx-chart2 [aria-live]')).toHaveLength(0)
  })
})
