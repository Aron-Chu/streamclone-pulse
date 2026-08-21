import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PulseMultiSignalChartInner } from '../src/PulseMultiSignalChart.tsx'
import type { ChartMinuteRollup } from '../src/types.ts'

const rollups: ChartMinuteRollup[] = [
  { minuteTs: '2026-07-12T00:00:00.000Z', viewerAvg: 100, viewerSamples: 2, chatCount: 10, totalEmoteCount: 5 },
  { minuteTs: '2026-07-12T00:02:00.000Z', viewerAvg: 120, viewerSamples: 2, chatCount: 12, totalEmoteCount: 8 },
]

function cursorX(markup: string): number | null {
  const line = markup.match(/<line[^>]*data-viewer-layer="cursor"[^>]*>/)?.[0]
  const value = line?.match(/x1="([^"]+)"/)?.[1]
  return value ? Number(value) : null
}

describe('shared timestamp cursor', () => {
  it.each([
    ['selectedRollup', { selectedRollup: { minuteTs: '2026-07-12T00:01:00.000Z' } }],
    ['previewRollup', { previewRollup: { minuteTs: '2026-07-12T00:01:00.000Z' } }],
  ] as const)('renders %s at the exact timestamp midpoint', (_name, props) => {
    const markup = renderToStaticMarkup(
      <PulseMultiSignalChartInner
        rollups={rollups}
        {...props}
        motionEnabled={false}
      />,
    )

    expect(cursorX(markup)).toBeCloseTo((90 + 966) / 2, 5)
    expect((markup.match(/data-viewer-layer="cursor"/g) ?? [])).toHaveLength(1)
  })
})
