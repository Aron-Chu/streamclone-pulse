import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MAX_PLOTTED_EMOTES } from '../src/index.ts'
import {
  activityBarAtPlotX,
  PulseMultiSignalChartInner,
  handleMultiSignalWheelEvent,
} from '../src/PulseMultiSignalChart.tsx'

const rollups = [
  { minuteTs: '2026-07-31T00:00:00.000Z', viewerAvg: 100, viewerSamples: 2, chatCount: 10, totalEmoteCount: 2, emotes: { Kappa: 2 } },
  { minuteTs: '2026-07-31T00:01:00.000Z', viewerAvg: 120, viewerSamples: 2, chatCount: 12, totalEmoteCount: 3, emotes: { Kappa: 3 } },
]

const longRollups = Array.from({ length: 20 }, (_, index) => ({
  minuteTs: new Date(Date.parse('2026-07-31T00:00:00.000Z') + index * 60_000).toISOString(),
  viewerAvg: 100 + index,
  viewerSamples: 2,
  chatCount: 10 + index,
  totalEmoteCount: 2 + index,
}))

function activityRects(markup: string, signal = 'chat') {
  return [...markup.matchAll(new RegExp(`<rect[^>]*data-activity-bar="${signal}"[^>]*>`, 'g'))]
    .map(([rect]) => ({
      x: Number(rect.match(/\bx="([^"]+)"/)?.[1]),
      width: Number(rect.match(/\bwidth="([^"]+)"/)?.[1]),
    }))
}

describe('chart controls', () => {
  it('does not select a neighboring activity bar across a timestamp gap', () => {
    const bars = [
      { x: 90, width: 4, hasValue: true },
      { x: 100, width: 4, hasValue: true },
      { x: 300, width: 4, hasValue: true },
    ]

    expect(activityBarAtPlotX(bars, 180)).toBeNull()
    expect(activityBarAtPlotX(bars, 100)).toBe(bars[1])
    expect(activityBarAtPlotX(bars, 302)).toBe(bars[2])
  })

  it.each([false, true])('keeps sparse activity at measured timestamps (expanded=%s)', activityExpanded => {
    const sparseRollups = [0, 1, 20, 21, 22].map((minute, index) => ({
      ...longRollups[index]!,
      minuteTs: new Date(Date.parse(longRollups[0]!.minuteTs) + minute * 60_000).toISOString(),
    }))
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={sparseRollups}
        streamStartedAt={longRollups[0]!.minuteTs}
        durationSeconds={23 * 60}
        activityExpanded={activityExpanded}
        motionEnabled={false}
      />,
    )
    for (const signal of ['chat', 'emotes']) {
      const bars = activityRects(markup, signal)
      expect(bars).toHaveLength(5)
      // The shared 1000-unit plot spans x=90..966, with a 22-minute domain.
      expect(bars[1]!.x + bars[1]!.width / 2).toBeCloseTo(90 + 876 / 22, 4)
      expect(bars[2]!.x + bars[2]!.width / 2).toBeCloseTo(90 + 20 * 876 / 22, 4)
      for (let index = 1; index < bars.length; index++) {
        expect(bars[index]!.x).toBeGreaterThan(bars[index - 1]!.x + bars[index - 1]!.width)
      }
    }
  })

  it.each([0, 2])('excludes line halo samples from bars at a %sm zoom start', startMinute => {
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={longRollups}
        streamStartedAt={longRollups[0]!.minuteTs}
        durationSeconds={20 * 60}
        viewport={{ startSeconds: startMinute * 60, endSeconds: (startMinute + 15) * 60 }}
        motionEnabled={false}
      />,
    )
    for (const signal of ['chat', 'emotes']) {
      const bars = activityRects(markup, signal)
      expect(bars).toHaveLength(16)
      expect(new Set(bars.map(bar => bar.x)).size).toBe(16)
      for (let index = 1; index < bars.length; index++) {
        expect(bars[index]!.x).toBeGreaterThan(bars[index - 1]!.x + bars[index - 1]!.width)
      }
    }
  })

  it('keeps viewer-led layout as the shared default and exposes equal lanes as opt-in', () => {
    const sharedMarkup = renderToStaticMarkup(
      <PulseMultiSignalChartInner rollups={rollups} motionEnabled={false} />,
    )
    const portalMarkup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={rollups}
        motionEnabled={false}
        layoutMode="equal-signals"
        selectedEmotes={new Set(['Kappa'])}
      />,
    )

    expect(sharedMarkup).toContain('data-chart-layout-mode="viewer-led"')
    expect(portalMarkup).toContain('data-chart-layout-mode="equal-signals"')
    expect(portalMarkup).toContain('data-plotted-emote-lane-position="after-bars"')
    expect(portalMarkup).toContain('data-plotted-emote-lane="true"')
  })

  it('keeps the local Markers and Expand controls when mode props are omitted', () => {
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={rollups}
        variant="compact"
        motionEnabled={false}
      />,
    )

    expect(markup).toContain('>Markers</button>')
    expect(markup).toContain('>Expand</button>')
  })

  it('hides duplicate local controls when both values are parent-controlled', () => {
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={rollups}
        variant="compact"
        motionEnabled={false}
        showSpikes={false}
        activityExpanded={false}
      />,
    )

    expect(markup).not.toContain('>Markers</button>')
    expect(markup).not.toContain('>Expand</button>')
  })

  it('exports the shared plotted-emote cap', () => {
    expect(MAX_PLOTTED_EMOTES).toBe(6)
  })

  it('never floats viewport controls over the plot', () => {
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={longRollups}
        streamStartedAt="2026-07-31T00:00:00.000Z"
        durationSeconds={20 * 60}
        variant="console"
        motionEnabled={false}
      />,
    )

    // An overlay pinned to the top-right of the plot covered the viewer peak.
    // The console owns these controls now (see AnalyticsChart's range row).
    expect(markup).not.toContain('data-chart-viewport-controls')
    expect(markup).not.toContain('data-chart-viewport-readout')
    expect(markup).not.toContain('>15m</button>')
  })

  it('omits per-bar native tooltips that duplicate the hover readout', () => {
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={longRollups}
        streamStartedAt="2026-07-31T00:00:00.000Z"
        durationSeconds={20 * 60}
        variant="console"
        motionEnabled={false}
      />,
    )

    // Every activity bar used to carry a <title>, so ~44% of the chart's SVG
    // nodes were native tooltips restating the hover readout a second later.
    expect(markup).not.toMatch(/data-activity-bar=[^>]*>\s*<title>/)
    expect(markup).not.toContain('Chat average ')
    expect(markup).not.toContain('/min at 00:')
  })

  it('keeps the emote histogram and trend line when activity is collapsed', () => {
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={longRollups}
        streamStartedAt="2026-07-31T00:00:00.000Z"
        durationSeconds={20 * 60}
        variant="console"
        activityExpanded={false}
        motionEnabled={false}
      />,
    )

    expect(markup).toContain('data-activity-bar="emotes"')
    expect(markup).toContain('data-activity-bar="chat"')
    expect(markup).toContain('data-emote-trend="true"')
  })

  it('lets emote bars fill their render interval instead of 3px needles', () => {
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={longRollups}
        streamStartedAt="2026-07-31T00:00:00.000Z"
        durationSeconds={20 * 60}
        variant="console"
        activityExpanded={false}
        motionEnabled={false}
      />,
    )
    const widths = [...markup.matchAll(/data-activity-bar="emotes"[^>]*width="([^"]+)"/g)]
      .map((match) => Number(match[1]))
      .concat(
        [...markup.matchAll(/width="([^"]+)"[^>]*data-activity-bar="emotes"/g)]
          .map((match) => Number(match[1])),
      )
      .filter((value) => Number.isFinite(value) && value > 0)
    const unique = [...new Set(widths)]

    expect(unique.length).toBeGreaterThan(0)
    expect(Math.max(...unique)).toBeGreaterThan(8)
  })

  it('uses extension-style slot fill when the chart is zoomed', () => {
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={longRollups}
        streamStartedAt="2026-07-31T00:00:00.000Z"
        durationSeconds={20 * 60}
        viewport={{ startSeconds: 0, endSeconds: 15 * 60 }}
        variant="console"
        activityExpanded={false}
        motionEnabled={false}
      />,
    )
    const widths = [...markup.matchAll(/<rect[^>]*data-activity-bar="chat"[^>]*>/g)]
      .map((match) => Number(match[0].match(/\bwidth="([^"]+)"/)?.[1]))
      .filter((value) => Number.isFinite(value) && value > 0)
    const bars = widths.length
    // Boundary bars are clipped, not shifted away from their source timestamp.
    const uniqueWidths = new Set(widths.slice(1, -1).map((value) => value.toFixed(4)))

    expect(bars).toBeGreaterThan(1)
    expect(uniqueWidths).toHaveLength(1)
    expect(widths[0]).toBeGreaterThan(12)
  })

  it('uses the same dense time-bin cadence for chat and emote bars', () => {
    const denseRollups = Array.from({ length: 566 }, (_, index) => ({
      minuteTs: new Date(Date.parse('2026-07-31T00:00:00.000Z') + index * 60_000).toISOString(),
      viewerAvg: 10_000 + (index % 17) * 20,
      viewerSamples: 1,
      chatCount: 100 + (index % 23),
      totalEmoteCount: 30 + (index % 19),
    }))
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={denseRollups}
        streamStartedAt="2026-07-31T00:00:00.000Z"
        durationSeconds={566 * 60}
        variant="console"
        activityExpanded={false}
        motionEnabled={false}
      />,
    )
    const chatCount = (markup.match(/data-activity-bar="chat"/g) ?? []).length
    const emoteCount = (markup.match(/data-activity-bar="emotes"/g) ?? []).length

    expect(chatCount).toBeGreaterThanOrEqual(200)
    expect(emoteCount).toBe(chatCount)
  })

  it('keeps dense bars uniform when downsampled timestamps skip minutes', () => {
    const denseRollups = Array.from({ length: 241 }, (_, index) => ({
      minuteTs: new Date(Date.parse('2026-07-31T00:00:00.000Z') + (
        index * 60_000 + Math.floor(index / 8) * 60_000
      )).toISOString(),
      viewerAvg: 10_000 + (index % 17) * 20,
      viewerSamples: 1,
      chatCount: 100 + (index % 23),
      totalEmoteCount: 30 + (index % 19),
    }))
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={denseRollups}
        streamStartedAt="2026-07-31T00:00:00.000Z"
        durationSeconds={271 * 60}
        variant="console"
        activityExpanded={false}
        motionEnabled={false}
      />,
    )
    const widths = [...markup.matchAll(/<rect[^>]*data-activity-bar="chat"[^>]*>/g)]
      .map((match) => Number(match[0].match(/\bwidth="([^"]+)"/)?.[1]))
      .filter((value) => Number.isFinite(value) && value > 0)
    const uniqueWidths = new Set(widths.slice(1, -1).map((value) => value.toFixed(4)))
    const xPositions = [...markup.matchAll(/<rect[^>]*data-activity-bar="chat"[^>]*>/g)]
      .map((match) => Number(match[0].match(/\bx="([^"]+)"/)?.[1]))
      .filter((value) => Number.isFinite(value))
    const viewBoxWidth = Number(markup.match(/<svg[^>]*viewBox="0 0 ([^ ]+)/)?.[1])

    expect(widths.length).toBeGreaterThanOrEqual(200)
    expect(widths.length).toBeLessThanOrEqual(denseRollups.length)
    expect(uniqueWidths).toHaveLength(1)
    expect(xPositions[0]).toBeGreaterThanOrEqual(0)
    expect(xPositions.at(-1)! + widths.at(-1)!).toBeLessThanOrEqual(viewBoxWidth)
    // Real timestamp gaps remain visible on the shared time axis; only the
    // visual bar cadence is uniform. Requiring equal X deltas would put bars
    // back into index slots and detach them from hover/selection time.
    expect(new Set(xPositions.map((value) => value.toFixed(4))).size).toBeGreaterThan(1)
  })

  it('keeps downsampled overview bars above the 1px needle floor', () => {
    const longRollups = Array.from({ length: 566 }, (_, index) => ({
      minuteTs: new Date(
        Date.parse('2026-07-31T00:00:00.000Z') + index * 60_000,
      ).toISOString(),
      viewerAvg: 10_000 + (index % 17) * 20,
      viewerSamples: 1,
      chatCount: 100 + (index % 23),
      totalEmoteCount: 30 + (index % 19),
    }))
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={longRollups}
        streamStartedAt="2026-07-31T00:00:00.000Z"
        durationSeconds={566 * 60}
        variant="console"
        activityExpanded={false}
        motionEnabled={false}
      />,
    )
    const widths = [...markup.matchAll(/<rect[^>]*data-activity-bar="chat"[^>]*>/g)]
      .map((match) => Number(match[0].match(/\bwidth="([^"]+)"/)?.[1]))
      .filter((value) => Number.isFinite(value) && value > 0)

    expect(widths.length).toBeGreaterThanOrEqual(200)
    expect(Math.min(...widths)).toBeGreaterThan(1)
    expect(new Set(widths.slice(1, -1).map((value) => value.toFixed(4)))).toHaveLength(1)
  })

  it('keeps sparse activity bars within the shared render budget', () => {
    const sparseRollups = Array.from({ length: 300 }, (_, index) => ({
      minuteTs: new Date(
        Date.parse('2026-07-31T00:00:00.000Z') + index * 2 * 60_000,
      ).toISOString(),
      viewerAvg: 10_000 + (index % 17) * 20,
      viewerSamples: 1,
      chatCount: 100 + (index % 23),
      totalEmoteCount: 30 + (index % 19),
    }))
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={sparseRollups}
        streamStartedAt="2026-07-31T00:00:00.000Z"
        durationSeconds={599 * 60}
        variant="console"
        activityExpanded={false}
        motionEnabled={false}
      />,
    )

    for (const signal of ['chat', 'emotes']) {
      const bars = activityRects(markup, signal)
      expect(bars).toHaveLength(240)
    }
  })

  it('keeps activity geometry finite when timestamps are malformed', () => {
    const malformedRollups = Array.from({ length: 100 }, (_, index) => ({
      minuteTs: 'invalid',
      viewerAvg: 10_000 + index,
      viewerSamples: 1,
      chatCount: 100 + index,
      totalEmoteCount: 30 + index,
    }))
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={malformedRollups}
        durationSeconds={99 * 60}
        variant="console"
        activityExpanded={false}
        motionEnabled={false}
      />,
    )

    for (const signal of ['chat', 'emotes']) {
      const bars = activityRects(markup, signal)
      expect(bars.length).toBeGreaterThan(0)
      expect(bars.every((bar) => Number.isFinite(bar.x) && Number.isFinite(bar.width))).toBe(true)
      expect(Math.min(...bars.map((bar) => bar.x))).toBeGreaterThanOrEqual(0)
      expect(Math.max(...bars.map((bar) => bar.x + bar.width))).toBeLessThanOrEqual(1000)
    }
  })

  it('hides decorative SVG primitives behind one concise chart summary', () => {
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={rollups}
        streamStartedAt="2026-07-31T00:00:00.000Z"
        onSelectRollup={vi.fn()}
        motionEnabled={false}
      />,
    )

    expect(markup).toContain('data-chart-decorative-primitives="true"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('Timeline with 2 measured minute rows.')
    expect(markup).toContain('aria-live="polite"')
  })

  it('offers a complete paginated data-table alternative', () => {
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={longRollups}
        streamStartedAt="2026-07-31T00:00:00.000Z"
        motionEnabled={false}
      />,
    )

    expect(markup).toContain('data-shared-chart-data-alternative="true"')
    expect(markup).toContain('Chart data table (20 rows)')
    expect(markup).toContain('<table')
    expect(markup).toContain('Complete analytics timeline data, paginated')
    expect(markup).toContain('Chat / min')
    expect(markup).toContain('Emotes / min')
  })

  it('renders backend reaction windows at their real interval without hiding emote bars', () => {
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={rollups}
        streamStartedAt="2026-07-31T00:00:00.000Z"
        reactionPoints={[
          {
            offsetSeconds: 30,
            durationSeconds: 15,
            reactionScore: 86,
            confidence: 0.75,
            reason: 'emote_spike',
            precisionSeconds: 1,
          },
        ]}
        showSpikes
        motionEnabled={false}
      />,
    )

    expect(markup).toContain('data-reaction-bar="true"')
    expect(markup).toContain('data-reaction-offset="30"')
    expect(markup).toContain('data-reaction-score="86"')
    expect(markup).toContain('Reaction markers')
    expect(markup).toContain('Reaction window · emote_spike · 86/100')
    expect(markup).toContain('±1s')
    expect(markup).toContain('data-reaction-peak="true"')
    expect(markup).toContain('data-activity-bar="emotes"')
  })

  it('MarkersToggleHidesMarkersNotSignals', () => {
    const hidden = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={rollups}
        streamStartedAt="2026-07-31T00:00:00.000Z"
        reactionPoints={[{
          offsetSeconds: 30,
          durationSeconds: 15,
          reactionScore: 86,
          confidence: 0.75,
          reason: 'emote_spike',
        }]}
        showSpikes={false}
        activityExpanded
        motionEnabled={false}
      />,
    )
    const visible = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={rollups}
        streamStartedAt="2026-07-31T00:00:00.000Z"
        reactionPoints={[{
          offsetSeconds: 30,
          durationSeconds: 15,
          reactionScore: 86,
          confidence: 0.75,
          reason: 'emote_spike',
        }]}
        showSpikes
        activityExpanded
        motionEnabled={false}
      />,
    )

    expect(hidden).not.toContain('data-reaction-bar="true"')
    expect(hidden).not.toContain('data-reaction-peak="true"')
    expect(hidden).toContain('data-activity-bar="chat"')
    expect(hidden).toContain('data-activity-bar="emotes"')
    expect(visible).toContain('data-reaction-bar="true"')
    expect(visible).toContain('data-reaction-peak="true"')
  })

  it('keeps an exact selected offset marker separate from the minute rollup cursor', () => {
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={rollups}
        streamStartedAt="2026-07-31T00:00:00.000Z"
        selectedRollup={rollups[0]}
        selectedOffsetSeconds={45}
        motionEnabled={false}
      />,
    )

    expect(markup).toContain('data-moment-selected-marker="true"')
  })

  describe('wheel semantics', () => {
    const wheel = (
      overrides: Partial<{
        deltaX: number
        deltaY: number
        deltaMode: number
        altKey: boolean
        ctrlKey: boolean
        metaKey: boolean
        shiftKey: boolean
      }> = {},
    ) => ({
      deltaX: 0,
      deltaY: -100,
      deltaMode: 0,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      ...overrides,
    })

    const run = (
      event: ReturnType<typeof wheel>,
      overrides: Partial<{ viewport: { startSeconds: number; endSeconds: number }; durationSeconds: number; wheelZoomMode: 'modified' | 'direct' }> = {},
    ) => {
      const preventDefault = vi.fn()
      const onViewportChange = vi.fn()
      const consumed = handleMultiSignalWheelEvent({
        event: { ...event, preventDefault },
        viewport: { startSeconds: 0, endSeconds: 3600 },
        durationSeconds: 3600,
        anchorSeconds: 1800,
        onViewportChange,
        ...overrides,
      })
      return { consumed, preventDefault, onViewportChange }
    }

    it('lets an ordinary vertical wheel scroll the page instead of zooming', () => {
      const { consumed, preventDefault, onViewportChange } = run(wheel())
      expect(consumed).toBe(false)
      expect(preventDefault).not.toHaveBeenCalled()
      expect(onViewportChange).not.toHaveBeenCalled()
    })

    it('zooms directly when the session chart opts in', () => {
      const { consumed, preventDefault, onViewportChange } = run(wheel(), { wheelZoomMode: 'direct' })
      expect(consumed).toBe(true)
      expect(preventDefault).toHaveBeenCalledOnce()
      expect(onViewportChange.mock.calls[0][0].endSeconds - onViewportChange.mock.calls[0][0].startSeconds).toBeLessThan(3600)
    })

    it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { deltaY: 240 }])('preserves browser gestures and the full-range boundary in direct mode: %j', event => {
      const { consumed, preventDefault } = run(wheel(event), { wheelZoomMode: 'direct' })
      expect(consumed).toBe(false)
      expect(preventDefault).not.toHaveBeenCalled()
    })

    it('lets an ordinary downward wheel scroll the page at the full-window boundary', () => {
      // The original trap: fully zoomed out, scrolling down could not zoom out
      // any further yet still swallowed the event and stalled the document.
      const { consumed, preventDefault, onViewportChange } = run(wheel({ deltaY: 240 }))
      expect(consumed).toBe(false)
      expect(preventDefault).not.toHaveBeenCalled()
      expect(onViewportChange).not.toHaveBeenCalled()
    })

    it('lets alt + wheel scroll the page when there is no zoom left to apply', () => {
      // Already at the full window, so zooming out changes nothing. The gesture
      // is not consumed, matching HubChartNavigator's boundary rule: preventDefault
      // happens only when the chart actually applies the gesture.
      const { consumed, preventDefault, onViewportChange } = run(
        wheel({ altKey: true, deltaY: 240 }),
      )
      expect(consumed).toBe(false)
      expect(preventDefault).not.toHaveBeenCalled()
      expect(onViewportChange).not.toHaveBeenCalled()
    })

    it('zooms on the documented Alt+wheel gesture', () => {
      const { consumed, preventDefault, onViewportChange } = run(wheel({ altKey: true }))
      expect(consumed).toBe(true)
      expect(preventDefault).toHaveBeenCalledOnce()
      expect(onViewportChange).toHaveBeenCalledOnce()
    })

    it.each([
      ['ctrl', { ctrlKey: true }],
      ['cmd', { metaKey: true }],
    ] as const)('leaves %s + wheel to the browser instead of zooming the chart', (_label, modifier) => {
      const { consumed, preventDefault, onViewportChange } = run(wheel(modifier))
      expect(consumed).toBe(false)
      expect(preventDefault).not.toHaveBeenCalled()
      expect(onViewportChange).not.toHaveBeenCalled()
    })

    it('leaves shift + wheel to the surrounding navigator rail', () => {
      const { consumed, preventDefault } = run(wheel({ shiftKey: true }))
      expect(consumed).toBe(false)
      expect(preventDefault).not.toHaveBeenCalled()
    })

    it('does not zoom when the browser also claims the gesture (alt + ctrl)', () => {
      const { consumed, preventDefault } = run(wheel({ altKey: true, ctrlKey: true }))
      expect(consumed).toBe(false)
      expect(preventDefault).not.toHaveBeenCalled()
    })

    it('ignores a predominantly horizontal gesture even when alt is held', () => {
      const { consumed, preventDefault } = run(wheel({ deltaX: -200, deltaY: -10, altKey: true }))
      expect(consumed).toBe(false)
      expect(preventDefault).not.toHaveBeenCalled()
    })

    it('never consumes a wheel event when there is no duration to zoom', () => {
      const { consumed, preventDefault } = run(wheel({ altKey: true }), { durationSeconds: 0 })
      expect(consumed).toBe(false)
      expect(preventDefault).not.toHaveBeenCalled()
    })
  })

  it('never sets touch-action:none on the plot surface, in either drag mode', () => {
    for (const dragPanMode of ['off', 'zoomed'] as const) {
      const markup = renderToStaticMarkup(
        <PulseMultiSignalChartInner
          rollups={longRollups}
          streamStartedAt="2026-07-31T00:00:00.000Z"
          durationSeconds={20 * 60}
          variant="console"
          motionEnabled={false}
          dragPanMode={dragPanMode}
        />,
      )
      expect(markup).toContain('data-chart-touch-action="pan-y"')
      expect(markup).not.toMatch(/touch-action:\s*none/)
    }
  })
})

describe('session chart motion chrome', () => {
  it('paints one outlined selected-minute band without a competing pin line', () => {
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={longRollups}
        streamStartedAt="2026-07-31T00:00:00.000Z"
        durationSeconds={20 * 60}
        variant="console"
        chromeless
        motionEnabled={false}
        selectedRollup={longRollups[4]}
      />,
    )

    expect(markup).toContain('data-chart-motion-chrome')
    expect(markup).toContain('data-chart-pin-band')
    expect(markup).not.toContain('data-chart-pin-line')
    expect(markup).toContain('data-time-chip')
    expect(markup).toContain('Selected 00:04')
    const bandWidth = Number(
      markup.match(/data-chart-pin-band[^>]*width="([^"]+)"/)?.[1]
      ?? markup.match(/width="([^"]+)"[^>]*data-chart-pin-band/)?.[1]
      ?? 0,
    )
    expect(bandWidth).toBeGreaterThan(1)
  })

  it('labels a different preview marker instead of leaving a second unexplained line', () => {
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={longRollups}
        streamStartedAt="2026-07-31T00:00:00.000Z"
        durationSeconds={20 * 60}
        variant="console"
        chromeless
        motionEnabled={false}
        selectedRollup={longRollups[4]}
        previewRollup={longRollups[7]}
      />,
    )

    expect(markup).toContain('data-moment-preview-marker="true"')
    expect(markup).toContain('data-preview-time-chip="true"')
    expect(markup).toContain('Preview 00:07')
  })

  it('keeps isolated pin chrome when motion settle is enabled', () => {
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={longRollups}
        streamStartedAt="2026-07-31T00:00:00.000Z"
        durationSeconds={20 * 60}
        variant="console"
        chromeless
        motionEnabled
        selectedRollup={longRollups[4]}
      />,
    )

    expect(markup).toContain('data-chart-motion-chrome')
    expect(markup).toContain('data-chart-pin-band')
    expect(markup).toContain('data-time-chip')
  })

  it('paints chat and emote presentation trends without using them as seek identity', () => {
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={longRollups}
        streamStartedAt="2026-07-31T00:00:00.000Z"
        durationSeconds={20 * 60}
        variant="console"
        chromeless
        motionEnabled={false}
      />,
    )

    expect(markup).toContain('data-presentation-trend="chat"')
    expect(markup).toContain('data-presentation-trend="emotes"')
    expect(markup).toContain('data-emote-trend="true"')
  })
})
