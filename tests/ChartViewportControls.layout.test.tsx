import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChartViewportControls } from '../src/ui/ChartViewportControls.tsx'
import {
  RAIL_PROGRAMMATIC_TRANSITION,
  railThumbTransition,
} from '../src/ui/ChartPositionRail.tsx'

const viewport = { startSeconds: 0, endSeconds: 7_200 }

function renderControls(overrides: Partial<Parameters<typeof ChartViewportControls>[0]> = {}) {
  return renderToStaticMarkup(
    <ChartViewportControls
      viewport={viewport}
      durationSeconds={7_200}
      zoomed={false}
      markersEnabled={false}
      showZoomHint
      onViewportChange={() => undefined}
      onToggleMarkers={() => undefined}
      onReset={() => undefined}
      onDismissZoomHint={() => undefined}
      onZoomIn={() => undefined}
      onZoomOut={() => undefined}
      {...overrides}
    />,
  )
}

describe('ChartViewportControls layout contract', () => {
  it('keeps the rail and controls in a wrapping, border-box row', () => {
    const markup = renderControls({ zoomed: true, markersEnabled: true })
    const row = markup.match(/<div style="([^"]+)" data-chart-viewport-controls/)?.[1] ?? ''

    expect(row).toContain('box-sizing:border-box')
    expect(row).toContain('display:flex')
    expect(row).toContain('flex-wrap:wrap')
    expect(markup).toContain('box-sizing:border-box')
    expect(markup).toContain('flex:1 1 0')
    expect(markup).not.toMatch(/flex:1 1 0[^\"]*width:100%/)
    expect(markup).toContain('data-chart-zoomed="true"')
    expect(markup).toContain('>Markers on</button>')
    expect(markup).toContain('>Reset view</button>')
    expect(markup).toContain('data-chart-zoom-cluster="true"')
    expect(markup).toContain('data-chart-zoom-in="true"')
    expect(markup).toContain('data-chart-zoom-out="true"')
    expect(markup).toContain('data-chart-zoom-reset="true"')
  })

  it('disables zoom-out and hides reset until the chart is zoomed', () => {
    const markup = renderControls({ zoomed: false })
    expect(markup).toMatch(/data-chart-zoom-out="true"[^>]*disabled=""/)
    expect(markup).not.toContain('data-chart-zoom-reset="true"')
    const zoomed = renderControls({ zoomed: true })
    expect(zoomed).not.toMatch(/data-chart-zoom-out="true"[^>]*disabled/)
    expect(zoomed).not.toMatch(/data-chart-zoom-reset="true"[^>]*disabled/)
    expect(zoomed).toContain('>Reset view</button>')
    expect(zoomed).not.toContain('Jump to')
  })

  it('paints the window thumb with the portal analytics rail material', () => {
    const markup = renderControls()
    const thumb = markup.match(/<div style="([^"]+)" data-chart-rail-thumb/)?.[1] ?? ''
    const track = markup.match(/style="([^"]+)"\s+data-chart-rail=/)?.[1] ?? ''
    // Measured from the running portal rail at /analytics/:login/:date.
    expect(track).toContain('background:rgba(255, 255, 255, 0.035)')
    expect(track).toContain('border:1px solid rgba(255, 255, 255, 0.1)')
    expect(track).toContain('height:14px')
    expect(thumb).toContain('background:rgba(52, 211, 153')
    expect(thumb).toContain('border:1px solid rgba(110, 231, 183, 0.98)')
    expect(thumb).toContain('top:1px')
    expect(thumb).toContain('bottom:1px')
  })

  it('animates only programmatic rail changes, never drag or reduced motion', () => {
    expect(railThumbTransition({
      animateChanges: true,
      dragging: false,
      reducedMotion: false,
    })).toBe(RAIL_PROGRAMMATIC_TRANSITION)
    expect(railThumbTransition({
      animateChanges: true,
      dragging: true,
      reducedMotion: false,
    })).toBe('none')
    expect(railThumbTransition({
      animateChanges: true,
      dragging: false,
      reducedMotion: true,
    })).toBe('none')
    expect(railThumbTransition({
      animateChanges: false,
      dragging: false,
      reducedMotion: false,
    })).toBe('none')
  })

  it('shows the visible elapsed range without a latest action', () => {
    const markup = renderControls({
      viewport: { startSeconds: 3_600, endSeconds: 5_400 },
      zoomed: true,
    })
    expect(markup).toContain('data-chart-visible-range="true"')
    expect(markup).toContain('01:00:00–01:30:00 / 02:00:00')
    expect(markup).not.toContain('Jump to now')
    expect(markup).not.toContain('Jump to end')
  })

  it('gives the rail its own full-width line above the actions', () => {
    const markup = renderControls({ zoomed: true, markersEnabled: true })
    const line = markup.match(/<div style="([^"]+)" data-chart-rail-line/)?.[1] ?? ''
    expect(line).toContain('flex-basis:100%')
    expect(line).toContain('box-sizing:border-box')
  })

  it('renders the zoom hint in the same shared control surface', () => {
    const markup = renderControls()
    expect(markup).toContain('data-chart-zoom-hint="true"')
    expect(markup).toContain('Scroll to zoom')
    expect(markup).toContain('Shift + scroll or drag to pan')
    expect(markup).toContain('>Got it</button>')
  })
})
