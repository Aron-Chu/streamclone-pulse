import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ExtensionRollup } from '../src/shared/messages.ts'
import { PulseOverviewChart } from '../src/ui/PulseOverviewChart.tsx'

/**
 * Prospective-history rule: minutes before the first Helix sample were never
 * observed, so the viewer line must not draw them. An eased ramp from zero was
 * removed because it both invented that prefix and overwrote authoritative
 * sampled zeroes ([0, 0, 100] rendered as [0, 50, 100]).
 */
function chart(rollups: ExtensionRollup[]) {
  return renderToStaticMarkup(
    <PulseOverviewChart
      rollups={rollups}
      durationSeconds={rollups.length * 60}
      streamStartedAt="2026-06-11T12:00:00.000Z"
      showViewerStrip
      isLive
    />,
  )
}

function viewerPathStartX(markup: string): number {
  const group = markup.match(/data-chart-viewer-line="true"[\s\S]*?<\/g>/)
  expect(group).not.toBeNull()
  const move = group![0].match(/ d="M\s*([\d.]+)/)
  expect(move).not.toBeNull()
  return Number(move![1])
}

function minute(offsetSeconds: number, extra: Partial<ExtensionRollup> = {}): ExtensionRollup {
  return { offsetSeconds, chatCount: 20, sevenTvEmoteCount: 4, totalEmoteCount: 8, ...extra }
}

describe('viewer lane leading edge', () => {
  it('starts the viewer line at the first sample, not at stream start', () => {
    // Samples begin at minute 6 of 10. Chat is active from minute 0 throughout,
    // so any leading-edge synthesis would be visible as a line reaching x=PAD_LEFT.
    const late = Array.from({ length: 10 }, (_, i) =>
      minute(i * 60, i >= 6 ? { viewerSamples: 1, viewerCount: 900 + i } : {}),
    )
    const early = Array.from({ length: 10 }, (_, i) =>
      minute(i * 60, { viewerSamples: 1, viewerCount: 900 + i }),
    )

    const lateStartX = viewerPathStartX(chart(late))
    const earlyStartX = viewerPathStartX(chart(early))

    // The fully sampled series starts at the plot's left padding; the late one
    // must start materially to the right of it.
    expect(earlyStartX).toBeLessThan(10)
    expect(lateStartX).toBeGreaterThan(earlyStartX + 50)
  })

  it('preserves authoritative sampled zeroes that precede the first positive value', () => {
    // The removed ramp keyed off the first POSITIVE value, so these observed
    // zeroes would have been rewritten into an ascending curve.
    const rollups = [
      minute(0, { viewerSamples: 1, viewerCount: 0 }),
      minute(60, { viewerSamples: 1, viewerCount: 0 }),
      minute(120, { viewerSamples: 1, viewerCount: 100 }),
    ]
    const markup = chart(rollups)
    const group = markup.match(/data-chart-viewer-line="true"[\s\S]*?<\/g>/)
    expect(group).not.toBeNull()

    const coords = [...group![0].matchAll(/[ML]\s*([\d.]+)\s+([\d.]+)/g)]
      .map(match => ({ x: Number(match[1]), y: Number(match[2]) }))
    expect(coords.length).toBeGreaterThanOrEqual(2)

    // Two observed zeroes then a rise: the first two plotted y values must be
    // identical (flat at the axis floor), not stepped.
    const [first, second] = coords
    expect(first!.y).toBeCloseTo(second!.y, 5)
    // And the series still starts at the left edge, because minute 0 IS sampled.
    expect(first!.x).toBeLessThan(10)
  })
})
