import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ChartPositionRail,
  LONG_STREAM_OVERVIEW_SECONDS,
  MIN_MEANINGFUL_CHART_DURATION_SECONDS,
  resolveRailKeyboardViewport,
  resolveRailPointerViewport,
  shouldShowChartRail,
} from '../src/ui/ChartPositionRail.tsx'

describe('ChartPositionRail', () => {
  it('shows a full-range rail once a short timeline has meaningful data', () => {
    const fullViewport = { startSeconds: 0, endSeconds: 60 * 60 }
    expect(shouldShowChartRail(fullViewport, 60 * 60)).toBe(true)
    expect(
      shouldShowChartRail(
        { startSeconds: 0, endSeconds: MIN_MEANINGFUL_CHART_DURATION_SECONDS },
        MIN_MEANINGFUL_CHART_DURATION_SECONDS,
      ),
    ).toBe(true)
    expect(shouldShowChartRail({ startSeconds: 0, endSeconds: 30 }, 30)).toBe(false)
    expect(shouldShowChartRail({ startSeconds: 0, endSeconds: 30 * 60 }, 60 * 60)).toBe(true)
  })

  it('shows the overview rail for long timelines at the full range', () => {
    const durationSeconds = LONG_STREAM_OVERVIEW_SECONDS
    expect(shouldShowChartRail({ startSeconds: 0, endSeconds: durationSeconds }, durationSeconds)).toBe(true)
  })

  it('renders an accessible rail with a bounded viewport thumb', () => {
    const html = renderToStaticMarkup(
      <ChartPositionRail
        viewport={{ startSeconds: 3_600, endSeconds: 7_200 }}
        durationSeconds={7_200}
        onViewportChange={() => undefined}
        ariaLabel="Chart zoom and position"
      />,
    )

    expect(html).toContain('data-chart-rail="true"')
    expect(html).toContain('data-chart-rail-thumb="true"')
    expect(html).toContain('aria-label="Chart zoom and position"')
    expect(html).toContain('aria-valuemax="7200"')
    expect(html).toContain('data-chart-rail-handle="start"')
    expect(html).toContain('data-chart-rail-handle="end"')
    expect(html).not.toContain('display:none')
  })

  it('can keep the visible range label with controls above the plot', () => {
    const html = renderToStaticMarkup(
      <ChartPositionRail
        viewport={{ startSeconds: 3_600, endSeconds: 7_200 }}
        durationSeconds={7_200}
        onViewportChange={() => undefined}
        hideRangeLabel
      />,
    )

    expect(html).toContain('data-chart-rail="true"')
    expect(html).not.toContain('Viewing 01:00:00')
  })

  it('renders an incoming stale viewport at the covered edge', () => {
    const html = renderToStaticMarkup(
      <ChartPositionRail
        viewport={{ startSeconds: 2_000, endSeconds: 4_000 }}
        durationSeconds={25_200}
        coverageStartSeconds={21_060}
        onViewportChange={() => undefined}
        ariaLabel="Chart zoom and position"
      />,
    )

    expect(html).toContain('aria-valuenow="21060"')
    expect(html).toContain('data-chart-rail-uncovered')
  })

  it('bounds pointer navigation to covered timeline data', () => {
    expect(resolveRailPointerViewport({
      clientX: 8,
      trackLeft: 0,
      trackWidth: 100,
      viewport: { startSeconds: 300, endSeconds: 600 },
      durationSeconds: 1_000,
      coverageStartSeconds: 200,
    })).toBeNull()

    const result = resolveRailPointerViewport({
      clientX: 90,
      trackLeft: 0,
      trackWidth: 100,
      viewport: { startSeconds: 300, endSeconds: 600 },
      durationSeconds: 1_000,
      coverageStartSeconds: 200,
    })
    expect(result?.offsetSeconds).toBe(900)
    expect(result?.viewport.startSeconds).toBeGreaterThanOrEqual(200)
    expect(result?.viewport.endSeconds).toBeLessThanOrEqual(1_000)
  })

  it('keeps a short-stream rail bounded while still reporting the clicked offset', () => {
    const result = resolveRailPointerViewport({
      clientX: 50,
      trackLeft: 0,
      trackWidth: 100,
      viewport: { startSeconds: 0, endSeconds: 240 },
      durationSeconds: 240,
    })

    expect(result?.offsetSeconds).toBe(120)
    expect(result?.viewport).toEqual({ startSeconds: 0, endSeconds: 240 })
  })

  it('keeps keyboard pan and Home/End navigation inside coverage', () => {
    const args = {
      viewport: { startSeconds: 300, endSeconds: 600 },
      durationSeconds: 1_000,
      coverageStartSeconds: 200,
    }
    expect(resolveRailKeyboardViewport({ ...args, key: 'ArrowLeft' })?.viewport).toEqual({
      startSeconds: 240,
      endSeconds: 540,
    })
    expect(resolveRailKeyboardViewport({ ...args, key: 'Home' })?.viewport).toEqual({
      startSeconds: 200,
      endSeconds: 500,
    })
    expect(resolveRailKeyboardViewport({ ...args, key: 'End' })?.viewport).toEqual({
      startSeconds: 700,
      endSeconds: 1_000,
    })
    expect(resolveRailKeyboardViewport({ ...args, key: 'ArrowRight', shiftKey: true })?.viewport).toEqual({
      startSeconds: 700,
      endSeconds: 1_000,
    })
  })
})
