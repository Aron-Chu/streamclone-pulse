import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChartViewportControls } from '../src/ui/ChartViewportControls.tsx'

function renderControls(selectedOffsetSeconds: number | null) {
  return renderToStaticMarkup(
    <ChartViewportControls
      viewport={{ startSeconds: 1_800, endSeconds: 2_400 }}
      durationSeconds={3_600}
      rangeLabel="Viewing 00:30:00 – 00:40:00"
      selectedOffsetSeconds={selectedOffsetSeconds}
      onViewportChange={() => undefined}
      onZoomIn={() => undefined}
      onZoomOut={() => undefined}
      onReset={() => undefined}
      onReturnToSelected={() => undefined}
    />,
  )
}

describe('ChartViewportControls selected bucket', () => {
  it('expands zoom context without changing the accessible reset action', () => {
    const html = renderControls(null)
    expect(html).toContain('data-chart-zoom-expanded="true"')
    expect(html).toContain('6.0x zoom')
    expect(html).toContain('aria-label="Reset chart view"')
    expect(html).not.toContain('Reset chart view to full stream')
  })

  it('uses available coverage rather than missing history for zoom context', () => {
    const html = renderToStaticMarkup(
      <ChartViewportControls
        viewport={{ startSeconds: 1800, endSeconds: 3600 }}
        durationSeconds={3600}
        coverageStartSeconds={1800}
        rangeLabel="Available history"
        onViewportChange={() => undefined}
        onZoomIn={() => undefined}
        onZoomOut={() => undefined}
        onReset={() => undefined}
      />,
    )
    expect(html).not.toContain('data-chart-zoom-expanded')
    expect(html).toContain('Chart zoom and position')
  })

  it('offers an accessible return action while the selected bucket is off-screen', () => {
    const html = renderControls(600)

    expect(html).toContain('data-chart-selection-state="off-screen"')
    expect(html).toContain('data-chart-return-to-selection="true"')
    expect(html).toContain('aria-label="Return to selected minute"')
    expect(html).toContain('data-chart-rail-selection-marker="true"')
  })

  it('keeps the rail marker without showing a return action for an in-view bucket', () => {
    const html = renderControls(2_000)

    expect(html).toContain('data-chart-selection-state="in-view"')
    expect(html).toContain('data-chart-rail-selection-marker="true"')
    expect(html).not.toContain('data-chart-return-to-selection="true"')
  })
})
