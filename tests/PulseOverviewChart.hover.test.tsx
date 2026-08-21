import { useMemo, useRef } from 'react'
import type { ComponentProps, ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ExtensionRollup } from '../src/shared/messages.ts'
import { HoverBucketBand, PulseOverviewChart } from '../src/ui/PulseOverviewChart.tsx'
import { chartTooltipModel } from '../src/ui/chartReadout.ts'
import { wheelZoom } from '../src/ui/chartViewport.ts'

const rollups: ExtensionRollup[] = [
  { offsetSeconds: 0, chatCount: 10, sevenTvEmoteCount: 2, viewerCount: 100 },
  { offsetSeconds: 60, chatCount: 40, sevenTvEmoteCount: 8, viewerCount: 140 },
  { offsetSeconds: 120, chatCount: 15, sevenTvEmoteCount: 3, viewerCount: 120 },
  { offsetSeconds: 180, chatCount: 25, sevenTvEmoteCount: 5, viewerCount: 160 },
  { offsetSeconds: 240, chatCount: 30, sevenTvEmoteCount: 6, viewerCount: 180 },
]

function chatBarRects(markup: string): Array<{ x: number; width: number; height: number }> {
  const group = markup.split('data-chart-series="chat-bars"')[1]?.split('</g>')[0] ?? ''
  return [...group.matchAll(/<rect\b[^>]*\sx="([\d.]+)"[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/g)]
    .map(m => ({ x: Number(m[1]), width: Number(m[2]), height: Number(m[3]) }))
}

function emoteBarRects(markup: string): Array<{ x: number; width: number; height: number }> {
  const group = markup.split('data-chart-series="emote-bars"')[1]?.split('</g>')[0] ?? ''
  return [...group.matchAll(/<rect\b[^>]*\sx="([\d.]+)"[^>]*\swidth="([\d.]+)"[^>]*\sheight="([\d.]+)"/g)]
    .map(m => ({ x: Number(m[1]), width: Number(m[2]), height: Number(m[3]) }))
}

function renderAt(
  selectedIndex: number | null,
  previewIndex: number | null,
  overrides: Partial<ComponentProps<typeof PulseOverviewChart>> = {},
): string {
  return renderToStaticMarkup(
    <PulseOverviewChart
      rollups={rollups}
      durationSeconds={300}
      selectedIndex={selectedIndex}
      previewIndex={previewIndex}
      activityExpanded
      showViewerStrip
      onSelectIndex={() => undefined}
      onClearSelection={() => undefined}
      onHoverOffsetChange={() => undefined}
      onFocusedSeriesKeyChange={() => undefined}
      reducedMotion
      {...overrides}
    />,
  )
}

function Probe(props: ComponentProps<typeof PulseOverviewChart>): ReactElement {
  const counter = useRef({ count: 0 })
  counter.current.count += 1
  return (
    <div data-probe-count={counter.current.count}>
      <PulseOverviewChart {...props} />
    </div>
  )
}

function ProbeParent(props: { children?: ReactElement }): ReactElement {
  const memoChildren = useMemo(() => props.children, [props.children])
  return <>{memoChildren}</>
}

describe('PulseOverviewChart hover refactor', () => {
  it('keeps chat-bar geometry stable when only hover-state props change', () => {
    const hoverA = renderAt(null, 0)
    const hoverB = renderAt(null, 4)
    const hoverC = renderAt(2, null)
    const chatA = chatBarRects(hoverA)
    const chatB = chatBarRects(hoverB)
    const chatC = chatBarRects(hoverC)
    expect(chatA.length).toBeGreaterThan(0)
    expect(chatA).toEqual(chatB)
    expect(chatA).toEqual(chatC)
  })

  it('keeps emote-bar geometry stable when only hover-state props change', () => {
    const hoverA = renderAt(null, 0)
    const hoverB = renderAt(null, 4)
    const hoverC = renderAt(2, null)
    const emoteA = emoteBarRects(hoverA)
    const emoteB = emoteBarRects(hoverB)
    const emoteC = emoteBarRects(hoverC)
    expect(emoteA.length).toBeGreaterThan(0)
    expect(emoteA).toEqual(emoteB)
    expect(emoteA).toEqual(emoteC)
  })

  it('keeps viewer axis observability attributes stable across hover-only rendering', () => {
    const a = renderAt(null, 0)
    const b = renderAt(3, 1)
    expect(a.match(/data-viewer-axis-max="([^"]*)"/)?.[1]).toBe(
      b.match(/data-viewer-axis-max="([^"]*)"/)?.[1],
    )
    expect(a.match(/data-viewer-raw-max="([^"]*)"/)?.[1]).toBe(
      b.match(/data-viewer-raw-max="([^"]*)"/)?.[1],
    )
    expect(a.match(/data-plot-top="([^"]*)"/)?.[1]).toBe(
      b.match(/data-plot-top="([^"]*)"/)?.[1],
    )
  })

  it('renders exactly one capture rect with the drag-first style', () => {
    const a = renderAt(null, 0)
    const captures = a.match(/<rect[^>]*fill="transparent"[^>]*style="[^"]*cursor:grab[^"]*"/g) ?? []
    expect(captures.length).toBe(1)
    expect(a).toContain('touch-action')
  })

  it('emits the hoisted transition style (no per-render inline object) when inspecting', () => {
    const a = renderAt(1, null)
    expect(a).toMatch(/style="transition:[^"]+"/)
    const styleMatches = a.match(/style="transition:[^"]+"/g) ?? []
    const unique = new Set(styleMatches)
    expect(unique.size).toBeGreaterThanOrEqual(1)
  })

  it('counts one chart render per SSR pass via a probe wrapper', () => {
    const props: ComponentProps<typeof PulseOverviewChart> = {
      rollups,
      durationSeconds: 300,
      showViewerStrip: true,
      onSelectIndex: () => undefined,
      onClearSelection: () => undefined,
      onHoverOffsetChange: () => undefined,
      onFocusedSeriesKeyChange: () => undefined,
      reducedMotion: true,
    }
    const first = renderToStaticMarkup(<Probe {...props} />)
    const second = renderToStaticMarkup(<ProbeParent><Probe {...props} /></ProbeParent>)
    expect(Number(first.match(/data-probe-count="(\d+)"/)?.[1] ?? '0')).toBe(1)
    expect(Number(second.match(/data-probe-count="(\d+)"/)?.[1] ?? '0')).toBe(1)
  })

  it('keeps the same set of bar rect keys across renders to prove memo lane stability', () => {
    const a = chatBarRects(renderAt(null, 0))
    const b = chatBarRects(renderAt(null, 0))
    expect(a.map(r => r.x)).toEqual(b.map(r => r.x))
    expect(a.map(r => r.width)).toEqual(b.map(r => r.width))
  })

  it('routes wheel events on the capture rect into a halved viewport via onViewportChange', () => {
    const onViewportChange = vi.fn<(viewport: { startSeconds: number; endSeconds: number }) => void>()
    const longRollups: ExtensionRollup[] = Array.from({ length: 1200 }, (_, i) => ({
      offsetSeconds: i * 60,
      chatCount: 10,
      sevenTvEmoteCount: 2,
      viewerCount: 100,
    }))
    const wideMarkup = renderToStaticMarkup(
      <PulseOverviewChart
        rollups={longRollups}
        durationSeconds={72_000}
        showViewerStrip
        onSelectIndex={() => undefined}
        onClearSelection={() => undefined}
        onHoverOffsetChange={() => undefined}
        onFocusedSeriesKeyChange={() => undefined}
        onViewportChange={onViewportChange}
        reducedMotion
      />,
    )
    expect(wideMarkup).toContain('fill="transparent"')
    expect(wideMarkup).toContain('touch-action')

    const next = wheelZoom({
      viewport: { startSeconds: 0, endSeconds: 72_000 },
      deltaY: -100,
      anchorSeconds: 36_000,
      durationSeconds: 72_000,
    })
    expect((next.startSeconds + next.endSeconds) / 2).toBeCloseTo(36_000, 5)
    expect(next.endSeconds - next.startSeconds).toBeLessThan(72_000)
    onViewportChange(next)
    expect(onViewportChange).toHaveBeenCalledTimes(1)
    expect(onViewportChange.mock.calls[0]?.[0]).toEqual(next)
  })

  it('does not paint a hover bucket band until the pointer is over a column', () => {
    expect(renderAt(null, null)).not.toContain('data-chart-hover-band')
  })

  it('paints a bucket-width hover band instead of only a 1px lock highlight', () => {
    const markup = renderToStaticMarkup(
      <svg>
        <HoverBucketBand x={40} width={16} top={8} bottom={80} />
      </svg>,
    )
    expect(markup).toContain('data-chart-hover-band="solo"')
    expect(markup).toContain('width="16"')
    expect(markup).toContain('x="0"')
    expect(markup).toContain('data-chart-hover-x="40"')
    expect(markup).toContain('transform="translate(40 0)"')
    expect(markup).toContain('height="72"')
  })

  it('mutes the hover band when a pin is already locked', () => {
    const markup = renderToStaticMarkup(
      <svg>
        <HoverBucketBand x={12} width={8} top={0} bottom={40} muted />
      </svg>,
    )
    expect(markup).toContain('data-chart-hover-band="muted"')
  })

  it('keeps lock chrome primary while a different list bucket is previewed', () => {
    const markup = renderAt(2, 4, {
      selectedOffsetSeconds: 120,
      previewOffsetSeconds: 240,
    })
    expect(markup).toContain('data-chart-active-index="2"')
    expect(markup).toContain('data-chart-locked-index="2"')
    expect(markup).toContain('data-chart-pin-line="true"')
    expect(markup).toContain('data-chart-pin-index="2"')
    expect(markup).toContain('data-chart-hover-band="muted"')
    expect(markup).toContain('data-chart-preview-index="4"')
    expect(markup).toContain('data-chart-seam-owner="locked"')
    expect(markup).toContain('data-time-chip-owner="locked"')
    expect(markup).not.toContain('data-chart-preview-line="true"')
  })

  it('retains primary preview chrome when there is no committed lock', () => {
    const markup = renderAt(null, 4, { previewOffsetSeconds: 240 })
    expect(markup).toContain('data-chart-active-index="4"')
    expect(markup).not.toContain('data-chart-locked-index')
    expect(markup).toContain('data-chart-preview-line="true"')
    expect(markup).toContain('data-chart-preview-index="4"')
    expect(markup).toContain('data-chart-seam-owner="preview"')
    expect(markup).toContain('data-time-chip-owner="preview"')
  })

  it('clamps a wheel-up zoom to the 5-minute floor instead of oscillating', () => {
    const onViewportChange = vi.fn<(viewport: { startSeconds: number; endSeconds: number }) => void>()
    const longRollups: ExtensionRollup[] = Array.from({ length: 600 }, (_, i) => ({
      offsetSeconds: i * 60,
      chatCount: 10,
      sevenTvEmoteCount: 2,
      viewerCount: 100,
    }))
    renderToStaticMarkup(
      <PulseOverviewChart
        rollups={longRollups}
        durationSeconds={36_000}
        showViewerStrip
        onSelectIndex={() => undefined}
        onClearSelection={() => undefined}
        onHoverOffsetChange={() => undefined}
        onFocusedSeriesKeyChange={() => undefined}
        onViewportChange={onViewportChange}
        reducedMotion
      />,
    )
    const next = wheelZoom({
      viewport: { startSeconds: 0, endSeconds: 5 * 60 },
      deltaY: -100,
      anchorSeconds: 150,
      durationSeconds: 36_000,
    })
    expect(next.startSeconds).toBe(0)
    expect(next.endSeconds).toBe(5 * 60)
    expect(next).toEqual({ startSeconds: 0, endSeconds: 5 * 60 })
  })
})

describe('PulseOverviewChart hover tooltip values', () => {
  it('builds the portal-style tooltip values from a rollup (viewers/chat/emotes)', () => {
    const model = chartTooltipModel({
      offsetSeconds: 60,
      chatCount: 40,
      sevenTvEmoteCount: 8,
      viewerAvg: 140,
      viewerSamples: 1,
    })
    expect(model.viewers).toBe('140')
    expect(model.chat).toBe('40')
    expect(model.emotes).toBe('8')

    const empty = chartTooltipModel(undefined)
    expect(empty.viewers).toBe('—')
    expect(empty.chat).toBe('0')
    expect(empty.emotes).toBe('0')
  })
})
