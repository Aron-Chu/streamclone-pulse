import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PulseMultiSignalChartInner } from '../src/PulseMultiSignalChart.tsx'
import type { ChartMinuteRollup } from '../src/types.ts'

const rollups: ChartMinuteRollup[] = [
  { minuteTs: '2026-07-12T00:00:00.000Z', viewerAvg: 100, chatCount: 10, totalEmoteCount: 5 },
  { minuteTs: '2026-07-12T00:02:00.000Z', viewerAvg: 120, chatCount: 12, totalEmoteCount: 8 },
]

function markerX(markup: string, stroke: string) {
  const escapedStroke = stroke.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const line = markup.match(new RegExp(`<line[^>]*x1="([^"]+)"[^>]*stroke="${escapedStroke}"`))
  return line ? Number(line[1]) : null
}

describe('external selection markers', () => {
  it.each([
    ['selectedRollup', { selectedRollup: { minuteTs: '2026-07-12T00:01:00.000Z' } }, '#f59e0b'],
    ['previewRollup', { previewRollup: { minuteTs: '2026-07-12T00:01:00.000Z' } }, 'rgba(245,158,11,0.45)'],
  ] as const)('renders %s at the exact midpoint between downsampled series points', (_name, props, stroke) => {
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={rollups}
        {...props}
      />,
    )

    const x = markerX(markup, stroke)
    const leftX = 90
    const rightX = 1000 - 34
    const midpoint = (leftX + rightX) / 2

    expect(x).not.toBeNull()
    expect(x).toBeCloseTo(midpoint, 5)
    expect(x).not.toBe(leftX)
    expect(x).not.toBe(rightX)
  })
})
