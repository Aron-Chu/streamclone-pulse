import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PulseOverviewChart } from '../src/ui/PulseOverviewChart.tsx'

describe('PulseOverviewChart signal disclosure', () => {
  const rollups = [
    { offsetSeconds: 0, viewerCount: 100, chatCount: 10, sevenTvEmoteCount: 3 },
    { offsetSeconds: 60, viewerCount: 140, chatCount: 25, sevenTvEmoteCount: 9 },
    { offsetSeconds: 120, viewerCount: 120, chatCount: 18, sevenTvEmoteCount: 5 },
  ]

  it('keeps viewer, chat, and emote trends visible at rest without bars or composite overview', () => {
    const html = renderToStaticMarkup(<PulseOverviewChart reducedMotion rollups={rollups} />)

    expect(html).toContain('data-chart-mode="signals"')
    expect(html).toContain('data-chart-layer="signals" opacity="1"')
    expect(html).toContain('data-chart-layer="interaction" opacity="0"')
    expect(html).toContain('data-chart-series="viewers"')
    expect(html).toContain('data-chart-series="chat"')
    expect(html).toContain('data-chart-series="emotes"')
    expect(html).not.toContain('data-chart-layer="overview"')
    expect(html).toContain('data-chart-scrubber="true"')
    expect(html).not.toContain('data-chart-emote-marker')
    expect(html).toContain('outline:none')

    const signalBars = [...html.matchAll(/data-chart-signal-bar="(?:chat|emotes)"[^>]*opacity="([^"]+)"/g)]
    expect(signalBars.length).toBeGreaterThan(0)
    // Whisper bar material is always mounted but hidden through the ref-backed
    // group opacity; individual rects carry their translucent resting alphas.
    expect(html).toContain('data-chart-signal-group="chat" opacity="0"')
    expect(html).toContain('data-chart-signal-group="emotes" opacity="0"')
    expect(html).not.toContain('data-chart-layer="overview"')
    expect(html).toContain('data-chart-series="viewers"')
    expect(html).toContain('data-chart-series="chat"')
    expect(html).toContain('data-chart-series="emotes"')
  })

  it('keeps bars, crosshair, and committed time identity visible after pointer leave', () => {
    const html = renderToStaticMarkup(
      <PulseOverviewChart reducedMotion rollups={rollups} selectedIndex={1} />,
    )

    expect(html).toContain('data-chart-mode="detail"')
    expect(html).toContain('data-chart-active-index="1"')
    expect(html).toContain('data-chart-active-offset="60"')
    expect(html).toContain('data-chart-locked-index="1"')
    expect(html).toContain('data-chart-layer="interaction" opacity="1"')
    expect(html).toContain('data-chart-signal-group="chat" opacity="1"')
    expect(html).toContain('data-chart-signal-group="emotes" opacity="1"')
    expect(html).toContain('stroke="rgba(var(--pulse-accent-soft-rgb, 196, 181, 253), 0.88)"')
    // Compact readout: committed time plus the bucket's viewer value.
    expect(html).toContain('>00:01:00 · 140<')
  })

  it('keeps plotted geometry immediate with a single short hover-chrome fade', () => {
    const html = renderToStaticMarkup(
      <PulseOverviewChart rollups={rollups} selectedIndex={1} />,
    )

    // No broad line morphing: exactly one short opacity fade (hover chrome).
    expect(html.match(/transition:/g)).toHaveLength(1)
    expect(html).toContain('opacity 140ms cubic-bezier(0.22, 1, 0.36, 1)')
    expect(html).not.toContain('420ms')
    // Reduced motion removes even that.
    const still = renderToStaticMarkup(
      <PulseOverviewChart reducedMotion rollups={rollups} selectedIndex={1} />,
    )
    expect(still.match(/transition:/g) ?? []).toHaveLength(0)
  })

  it('keeps the committed lock primary while another bucket is a muted preview', () => {
    const html = renderToStaticMarkup(
      <PulseOverviewChart
        reducedMotion
        rollups={rollups}
        selectedIndex={0}
        previewIndex={2}
      />,
    )

    expect(html).toContain('data-chart-active-index="0"')
    expect(html).toContain('data-chart-locked-index="0"')
    expect(html).toContain('data-chart-preview-index="2"')
    expect(html).toContain('data-chart-hover-band="muted"')
    expect(html).toContain('>00:00:00<')
  })

  it('attenuates resting chat/emote/trace lines when rendering the full overview range', () => {
    const durationSeconds = 180
    const html = renderToStaticMarkup(
      <PulseOverviewChart
        reducedMotion
        rollups={rollups}
        durationSeconds={durationSeconds}
        viewport={{ startSeconds: 0, endSeconds: durationSeconds }}
      />,
    )

    // Chat smoothed line rests at 0.30 in overview (vs 0.58 zoomed).
    expect(html).toMatch(/data-chart-series="chat"[^>]*opacity="0\.3"/)
    expect(html).toMatch(/data-chart-series="emotes"[^>]*opacity="0\.3"/)
  })
})
