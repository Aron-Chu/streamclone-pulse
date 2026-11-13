// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PulseOverviewChart } from '../src/ui/PulseOverviewChart.tsx'

// Glyph metrics captured from actual Windows Chromium getBBox with theme.font
// and these unchanged 11 px strings. Native-browser proof separately exercises
// the real API; this fixture lets ordinary unit CI catch placement regressions.
const metrics = {
  'Viewer tracking began': { width: 117.62939453125, bearing: -1 },
  'Viewer tracking ended': { width: 117.4951171875, bearing: -117.3125 },
}
let root: Root
let container: HTMLDivElement
let viewportWidth: number
let glyphsVisible: boolean
let resizeCallbacks: ResizeObserverCallback[]
const originalBBox = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'getBBox')
const box = (node: SVGElement) => {
  if (!glyphsVisible) return { x: 0, y: 0, width: 0, height: 0 }
  const x = Number(node.getAttribute('x'))
  const y = Number(node.getAttribute('y'))
  const metric = metrics[node.textContent as keyof typeof metrics]
  return metric
    ? { x: x + metric.bearing, y: y - 12, width: metric.width, height: 15 }
    : { x, y, width: Number(node.getAttribute('width')), height: Number(node.getAttribute('height')) }
}
const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => (
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
)

beforeEach(() => {
  viewportWidth = 320
  glyphsVisible = true
  resizeCallbacks = []
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback) }
    observe() {}
    disconnect() {}
  })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    x: 0, y: 0, left: 0, top: 0, right: viewportWidth, bottom: 160,
    width: viewportWidth, height: 160, toJSON() {},
  }))
  Object.defineProperty(SVGElement.prototype, 'getBBox', { configurable: true, value(this: SVGElement) { return box(this) } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  if (originalBBox) Object.defineProperty(SVGElement.prototype, 'getBBox', originalBBox)
  else delete (SVGElement.prototype as SVGElement & { getBBox?: () => unknown }).getBBox
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function render(start: number | null, end: number | null, compact = true, height = compact ? 160 : 220, show = true, loading = false, empty = false) {
  await act(async () => root.render(<PulseOverviewChart reducedMotion isLive={false}
    height={height} durationSeconds={3600} viewerLaneCompact={compact} showViewerStrip={show} loading={loading}
    viewerSampleWindowComplete viewerSampleStartOffsetSeconds={start} viewerSampleEndOffsetSeconds={end}
    rollups={empty ? [] : Array.from({ length: 61 }, (_, i) => ({ offsetSeconds: i * 60, viewerCount: 100 + i, viewerSamples: 1, chatCount: 10 }))}
  />))
}
async function resize(width: number) {
  viewportWidth = width
  await act(async () => resizeCallbacks.forEach(callback => callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver)))
}
function expectReadableLabels(count: number) {
  const labels = [...container.querySelectorAll<SVGTextElement>('[data-viewer-sample-marker] text')]
  const tag = container.querySelector<SVGRectElement>('[data-chart-viewer-lane-label] rect')!
  expect(labels).toHaveLength(count)
  for (const label of labels) {
    const bounds = box(label)
    expect(bounds.x).toBeGreaterThanOrEqual(4)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewportWidth - 12 + 0.01)
    expect(overlaps(bounds, box(tag))).toBe(false)
    expect(label.getAttribute('font-size')).toBe('11')
    expect(label.textContent).toMatch(/^Viewer tracking (began|ended)$/)
  }
  if (labels.length === 2) expect(overlaps(box(labels[0]), box(labels[1]))).toBe(false)
}

describe('viewer sampling label glyph bounds', () => {
  it('keeps an early completed marker right of the tag and inside the plot', async () => {
    await render(null, 120)
    expectReadableLabels(1)
  })
  it('keeps a near-right start label inside the plot', async () => {
    await render(3540, null)
    expectReadableLabels(1)
  })
  it.each([[60, 120], [3300, 3540]])('separates both short-lane labels at %s–%s', async (start, end) => {
    await render(start, end)
    expectReadableLabels(2)
  })
  it('uses separate rows when a narrow lane cannot fit both full labels', async () => {
    viewportWidth = 280
    await render(60, 120)
    expectReadableLabels(2)
    const labels = [...container.querySelectorAll<SVGTextElement>('[data-viewer-sample-marker] text')]
    expect(Number(labels[1].getAttribute('y'))).toBeGreaterThan(Number(labels[0].getAttribute('y')))
  })
  it('keeps normal full-window label text and markers', async () => {
    await render(0, 3600, false)
    expectReadableLabels(2)
    expect(container.querySelector('[data-viewer-sample-marker="start"] line')?.getAttribute('x1')).toBe('4')
    expect(container.querySelector('[data-viewer-sample-marker="end"] line')?.getAttribute('x1')).toBe('308')
  })
  it('separates overlapping full-lane labels and repositions after new samples', async () => {
    await render(600, 3000, false)
    expectReadableLabels(2)
    await render(3540, null, false)
    expectReadableLabels(1)
  })
  it.each([159, 162, 166])('clears the tag at a near-threshold lane height (%s px chart)', async height => {
    await render(0, null, false, height)
    expectReadableLabels(1)
  })
  it('removes stacked lane space when viewers hide, then measures on show', async () => {
    viewportWidth = 280
    await render(60, 120)
    expectReadableLabels(2)
    await render(60, 120, true, 160, false)
    expect(container.querySelector('svg')?.getAttribute('data-chart-viewer-lane')).toBe('false')
    expect(container.querySelector('clipPath[id$="-activity-clip"] rect')?.getAttribute('y')).toBe('18')
    await render(60, 120)
    expectReadableLabels(2)
  })
  it('remeasures an initially hidden chart when visibility changes at the same width', async () => {
    glyphsVisible = false
    await render(60, 120)
    glyphsVisible = true
    await resize(320)
    expectReadableLabels(2)
  })
  it('stays stable across stacked width changes near the tag-clearance threshold', async () => {
    viewportWidth = 280
    await render(0, 3600, false, 159)
    expectReadableLabels(2)
    await resize(320)
    expectReadableLabels(2)
    await resize(280)
    expectReadableLabels(2)
  })
  it('places narrow full-lane rows below the tag', async () => {
    viewportWidth = 250
    await render(60, 120, false)
    expectReadableLabels(2)
  })
  it('repositions newly mounted text after loading replaces the SVG with unchanged data', async () => {
    await render(null, 120)
    expectReadableLabels(1)
    await render(null, 120, true, 160, true, true)
    expect(container.querySelector('svg')).toBeNull()
    await render(null, 120)
    expectReadableLabels(1)
  })
  it('repositions both labels after an empty placeholder replaces the plot', async () => {
    await render(60, 120)
    expectReadableLabels(2)
    await render(60, 120, true, 160, true, false, true)
    expect(container.querySelector('svg')).toBeNull()
    await render(60, 120)
    expectReadableLabels(2)
  })
  it('rebuilds a stacked lane after a loading placeholder at the same width', async () => {
    viewportWidth = 280
    await render(60, 120)
    expectReadableLabels(2)
    await render(60, 120, true, 160, true, true)
    expect(container.querySelector('svg')).toBeNull()
    await render(60, 120)
    expectReadableLabels(2)
  })
})

// Paint-order regression for the curve/tag issue, separate from marker labels.
it('paints the opaque Viewers tag after the viewer curve', async () => {
  await render(null, 120)
  const tag = container.querySelector('[data-chart-viewer-lane-label]')!
  const line = container.querySelector('[data-chart-viewer-line]')!
  expect(tag.querySelector('rect')!.getAttribute('fill')).toMatch(/^#080f18$|^rgb\(8, 15, 24\)$/i)
  expect(line.compareDocumentPosition(tag) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  expectReadableLabels(1)
})
