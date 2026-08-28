import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MAX_PLOTTED_EMOTES } from '../src/index.ts'
import {
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

describe('chart controls', () => {
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

  it('renders a compact long-stream viewport rail with explicit presets', () => {
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={longRollups}
        streamStartedAt="2026-07-31T00:00:00.000Z"
        durationSeconds={20 * 60}
        variant="console"
        motionEnabled={false}
      />,
    )

    expect(markup).toContain('data-chart-viewport-controls')
    expect(markup).toContain('data-chart-viewport-readout')
    expect(markup).toContain('>15m</button>')
    expect(markup).toContain('>Full</button>')
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

  it('ordinary MultiSignal wheel prevents page scroll without ctrl', () => {
    const preventDefault = vi.fn()
    const onViewportChange = vi.fn()
    handleMultiSignalWheelEvent({
      event: {
        deltaX: 0,
        deltaY: -100,
        deltaMode: 0,
        preventDefault,
      },
      viewport: { startSeconds: 0, endSeconds: 3600 },
      durationSeconds: 3600,
      anchorSeconds: 1800,
      onViewportChange,
    })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(onViewportChange).toHaveBeenCalledOnce()
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
