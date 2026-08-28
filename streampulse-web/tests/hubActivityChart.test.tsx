import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HubActivityChart, viewerTrendDisplayValues } from '../src/ui/components/hub/HubActivityChart'

describe('HubActivityChart chat measurement honesty', () => {
  it('keeps all provider lanes fixed at the chart footer without toggle buttons', () => {
    const end = Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000
    const { container } = render(
      <HubActivityChart
        points={[
          {
            t: end - 60_000,
            chat: 10,
            seventv: 8,
            twitch: 4,
            bttv: 2,
            ffz: 1,
            emotes: 15,
            viewers: 100,
            hasChatRollup: true,
            bucketComplete: true,
          },
          {
            t: end,
            chat: 20,
            seventv: 9,
            twitch: 5,
            bttv: 3,
            ffz: 2,
            emotes: 19,
            viewers: 200,
            hasChatRollup: true,
            bucketComplete: true,
          },
        ]}
        windowMinutes={2}
        channelCount={1}
      />,
    )

    expect(container.querySelector('.hx-provider-chips')).toBeNull()
    const lanes = container.querySelector('.hx-provider-lanes')
    expect(lanes).not.toBeNull()
    expect(lanes?.querySelectorAll('.hx-provider-lane')).toHaveLength(4)
    expect(lanes?.textContent).toContain('7TV')
    expect(lanes?.textContent).toContain('TW')
    expect(lanes?.textContent).toContain('BT')
    expect(lanes?.textContent).toContain('FFZ')

    const plot = container.querySelector('.hx-plot-stack__plot--chart')
    expect(plot).not.toBeNull()
    expect(Boolean(plot!.compareDocumentPosition(lanes!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
  })

  it('explains exact unclassified provider counts without adding a fifth lane', () => {
    const end = Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000
    const { container } = render(
      <HubActivityChart
        points={[{
          t: end - 60_000,
          chat: 10,
          seventv: 4,
          twitch: 2,
          bttv: 1,
          ffz: 1,
          other: 3,
          emotes: 11,
          viewers: 100,
          providerCountsComplete: true,
          hasChatRollup: true,
          bucketComplete: true,
        }, {
          t: end,
          chat: 12,
          seventv: 5,
          twitch: 2,
          bttv: 1,
          ffz: 1,
          other: 3,
          emotes: 12,
          viewers: 110,
          providerCountsComplete: true,
          hasChatRollup: true,
          bucketComplete: true,
        }]}
        windowMinutes={2}
        channelCount={1}
        providerTotalsComplete
      />,
    )

    expect(container.querySelectorAll('.hx-provider-lane')).toHaveLength(4)
    expect(container.querySelector('[data-provider-note]')?.textContent).toContain('Other / unclassified')
  })

  it('marks providers without rollups as unavailable instead of drawing zero data', () => {
    const end = Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000
    const { container } = render(
      <HubActivityChart
        points={[
          { t: end - 60_000, chat: 10, seventv: 8, emotes: 8, viewers: 100, bucketComplete: true },
          { t: end, chat: 20, seventv: 9, emotes: 9, viewers: 200, bucketComplete: true },
        ]}
        windowMinutes={2}
        channelCount={1}
      />,
    )

    expect(container.querySelectorAll('.hx-provider-lane.is-unavailable')).toHaveLength(3)
    expect(container.querySelectorAll('.hx-provider-lane__empty')).toHaveLength(3)
    expect(container.textContent).toContain('No measured samples')
  })

  it('renders measured chat as purple bars without mixed-unit bar segments', () => {
    const end = Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000
    const { container } = render(
      <HubActivityChart
        points={[
          { t: end - 60_000, chat: 10, seventv: 2, emotes: 2, viewers: 100, hasChatRollup: true, bucketComplete: true },
          { t: end, chat: 20, seventv: 4, emotes: 4, viewers: 200, hasChatRollup: true, bucketComplete: true },
        ]}
        windowMinutes={2}
        channelCount={1}
      />,
    )

    expect(container.querySelectorAll('[data-component="HubActivityBarSeries"] .hx-chat-bar')).toHaveLength(2)
    expect(container.querySelectorAll('.hx-bar-segment--viewers, .hx-bar-segment--emotes')).toHaveLength(0)
    expect(container.querySelectorAll('.hx-chart-line--viewers')).not.toHaveLength(0)
    expect(container.querySelectorAll('.hx-chart-line--emotes')).not.toHaveLength(0)
  })

  it('labels sparse viewer samples instead of presenting unsampled buckets as zero', () => {
    const end = Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000
    const { container } = render(
      <HubActivityChart
        points={[
          { t: end - 2 * 60_000, chat: 10, seventv: 2, emotes: 2, viewers: 0, hasChatRollup: true, bucketComplete: true },
          { t: end - 60_000, chat: 12, seventv: 3, emotes: 3, viewers: 0, hasChatRollup: true, bucketComplete: true },
          { t: end, chat: 14, seventv: 4, emotes: 4, viewers: 500, hasViewerRollup: true, hasChatRollup: true, bucketComplete: true },
        ]}
        windowMinutes={3}
        channelCount={1}
      />,
    )

    expect(container.querySelector('.hx-chart2--viewer-partial')).toBeTruthy()
    expect(container.textContent).toContain('Viewer samples partial — 1/3 buckets sampled')
    expect(container.textContent).toContain('unsampled buckets remain unknown, not zero viewers')
    expect(container.textContent).toContain('500 peak viewers · 1/3 coverage-qualified')
  })

  it('renders a dashed sampled trend while reserving the solid trace for contiguous complete coverage', () => {
    const end = Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000
    const { container } = render(
      <HubActivityChart
        points={[
          {
            t: end - 3 * 60_000,
            chat: 10,
            seventv: 2,
            emotes: 2,
            viewers: 100,
            viewerContributors: 3,
            viewerExpectedContributors: 3,
            viewerCoverage: 'complete',
            hasViewerRollup: true,
            hasChatRollup: true,
            bucketComplete: true,
          },
          {
            t: end - 2 * 60_000,
            chat: 12,
            seventv: 3,
            emotes: 3,
            viewers: 80,
            viewerContributors: 2,
            viewerExpectedContributors: 3,
            viewerCoverage: 'partial',
            hasViewerRollup: true,
            hasChatRollup: true,
            bucketComplete: true,
          },
          {
            t: end - 60_000,
            chat: 14,
            seventv: 4,
            emotes: 4,
            viewers: 70,
            viewerCoverage: 'unknown',
            hasViewerRollup: true,
            hasChatRollup: true,
            bucketComplete: true,
          },
          {
            t: end,
            chat: 16,
            seventv: 5,
            emotes: 5,
            viewers: 110,
            viewerContributors: 3,
            viewerExpectedContributors: 3,
            viewerCoverage: 'complete',
            hasViewerRollup: true,
            hasChatRollup: true,
            bucketComplete: true,
          },
        ]}
        windowMinutes={4}
        channelCount={3}
      />,
    )

    expect(container.querySelectorAll('.hx-chart-line--viewers-sampled')).toHaveLength(1)
    expect(container.querySelectorAll('.hx-chart-line--viewers')).toHaveLength(0)
    expect(container.querySelectorAll('.hx-chart-point--viewers-partial')).toHaveLength(0)
    expect(container.querySelector('[data-viewer-trend-smoothing="median-3-gap-safe"]')).toBeTruthy()
    expect(container.querySelector('.hx-chart2')?.classList.contains('hx-chart2--viewer-partial')).toBe(true)
    expect(container.textContent).toContain('2 buckets are coverage-qualified')
    expect(container.textContent).toContain('2 sampled buckets remain partial or unknown')
  })

  it('uses one hollow screen-space dot for an isolated viewer observation and never an SVG blob', () => {
    const end = Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000
    const { container } = render(<HubActivityChart
      points={[
        { t: end - 2 * 60_000, chat: 10, seventv: 2, viewers: 100, hasViewerRollup: true, viewerCoverage: 'partial', bucketComplete: true },
        { t: end - 60_000, chat: 12, seventv: 3, viewers: 0, hasViewerRollup: false, bucketComplete: true },
        { t: end, chat: 14, seventv: 4, viewers: 0, hasViewerRollup: false, bucketComplete: true },
      ]}
      windowMinutes={3}
      channelCount={1}
    />)
    expect(container.querySelectorAll('.hx-chart2 svg circle')).toHaveLength(0)
    expect(container.querySelectorAll('.hx-chart-line--viewers-sampled')).toHaveLength(0)
    expect(container.querySelectorAll('.hx-chart-marker-dot--viewers-partial')).toHaveLength(1)
  })

  it('keeps partial viewer spikes out of the qualified peak', () => {
    const end = Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000
    const { container } = render(<HubActivityChart
      points={[
        { t: end - 2 * 60_000, chat: 10, seventv: 2, viewers: 100, hasViewerRollup: true, viewerCoverage: 'complete', bucketComplete: true },
        { t: end - 60_000, chat: 11, seventv: 2, viewers: 120, hasViewerRollup: true, viewerCoverage: 'complete', bucketComplete: true },
        { t: end, chat: 12, seventv: 2, viewers: 999_999, hasViewerRollup: true, viewerCoverage: 'partial', bucketComplete: true },
      ]}
      windowMinutes={3}
      channelCount={1}
    />)
    expect(container.querySelectorAll('.hx-chart-line--viewers')).toHaveLength(1)
    expect(container.textContent).toContain('120 peak viewers')
    expect(container.textContent).not.toContain('999K peak viewers')
  })

  it('calms a legacy one-bucket spike without smoothing across a missing bucket', () => {
    const end = Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000
    const values = viewerTrendDisplayValues([
      { t: end - 4 * 60_000, chat: 10, seventv: 2, viewers: 100, hasViewerRollup: true, viewerCoverage: 'unknown', bucketComplete: true },
      { t: end - 3 * 60_000, chat: 10, seventv: 2, viewers: 10_000, hasViewerRollup: true, viewerCoverage: 'partial', bucketComplete: true },
      { t: end - 2 * 60_000, chat: 10, seventv: 2, viewers: 120, hasViewerRollup: true, viewerCoverage: 'unknown', bucketComplete: true },
      { t: end - 60_000, chat: 10, seventv: 2, viewers: 0, hasViewerRollup: false, gapKind: 'unmeasured', bucketComplete: true },
      { t: end, chat: 10, seventv: 2, viewers: 8_000, hasViewerRollup: true, viewerCoverage: 'unknown', bucketComplete: true },
    ], 5)
    expect(values).toEqual([100, 120, 120, 0, 8_000])
  })

  it('keeps provider lane presence and coverage honest when optional provider fields are sparse', () => {
    const end = Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000
    const { container } = render(
      <HubActivityChart
        points={[
          {
            t: end - 3 * 60_000,
            chat: 10,
            seventv: 2,
            twitch: 4,
            emotes: 6,
            viewers: 100,
            bucketComplete: true,
          },
          {
            t: end - 2 * 60_000,
            chat: 12,
            seventv: 3,
            twitch: 5,
            emotes: 8,
            viewers: 110,
            bucketComplete: true,
          },
          {
            t: end - 60_000,
            chat: 14,
            seventv: 4,
            emotes: 9,
            viewers: 120,
            bucketComplete: true,
          },
          {
            t: end,
            chat: 16,
            seventv: 5,
            emotes: 10,
            viewers: 130,
            bucketComplete: true,
          },
        ]}
        windowMinutes={4}
        channelCount={1}
      />,
    )

    const twitchLane = container.querySelector('[data-provider="twitch"]')
    const bttvLane = container.querySelector('[data-provider="bttv"]')
    expect(twitchLane?.querySelector('[data-provider-coverage]')?.textContent).toBe(
      '2/4 measured buckets · partial',
    )
    expect(twitchLane?.classList.contains('is-unavailable')).toBe(false)
    expect(bttvLane?.querySelector('[data-provider-coverage]')?.textContent).toBe('Unavailable')
    expect(bttvLane?.classList.contains('is-unavailable')).toBe(true)
    expect(bttvLane?.textContent).toContain('No measured samples')
  })

  it('withholds a malformed fallback payload instead of plotting misleading geometry', () => {
    const start = Math.floor((Date.now() - 40 * 60_000) / 60_000) * 60_000
    const { container } = render(
      <HubActivityChart
        points={[
          { t: start, chat: 10, seventv: 2, viewers: 100, bucketComplete: true },
          { t: start + 31 * 60_000, chat: 10, seventv: 2, viewers: 100, bucketComplete: true },
        ]}
        windowMinutes={30}
        channelCount={1}
        dataIssue="payload spans 31 minutes but advertises 30 served minutes"
      />,
    )

    expect(container.querySelector('[data-hub-chart-state="unavailable"]')).toBeTruthy()
    expect(container.querySelector('.hx-chart2')).toBeNull()
    expect(container.textContent).toContain('payload spans 31 minutes')
  })

  it('shows an explicit unmeasured state instead of an empty SVG shell', () => {
    const end = Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000
    const { container } = render(
      <HubActivityChart
        points={[
          { t: end - 60_000, chat: 0, seventv: 0, viewers: 0, gapKind: 'unmeasured' },
          { t: end, chat: 0, seventv: 0, viewers: 0, gapKind: 'unmeasured' },
        ]}
        windowMinutes={2}
        channelCount={1}
        emptyTitle="Recent live activity only"
      />,
    )

    expect(container.querySelector('[data-hub-chart-state="unmeasured"]')).toBeTruthy()
    expect(container.querySelector('.hx-chart2')).toBeNull()
  })

  it('shows a quiet state when measured buckets contain no signals', () => {
    const end = Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000
    const { container } = render(
      <HubActivityChart
        points={[
          { t: end - 60_000, chat: 0, seventv: 0, viewers: 0, hasChatRollup: true, hasViewerRollup: true, bucketComplete: true },
          { t: end, chat: 0, seventv: 0, viewers: 0, hasChatRollup: true, hasViewerRollup: true, bucketComplete: true },
        ]}
        windowMinutes={2}
        channelCount={1}
      />,
    )

    expect(container.querySelector('[data-hub-chart-state="quiet"]')).toBeTruthy()
    expect(container.querySelector('.hx-chart2')).toBeNull()
  })

  it('draws a gap band for explicit false but not an absent legacy flag', () => {
    const end = Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000
    const { container, rerender } = render(
      <HubActivityChart
        points={[
          { t: end - 60_000, chat: 0, seventv: 0, viewers: 100, hasChatRollup: true, bucketComplete: true },
          { t: end, chat: 0, seventv: 0, viewers: 100, hasChatRollup: false, bucketComplete: true },
        ]}
        windowMinutes={2}
        channelCount={1}
      />,
    )

    expect(container.querySelectorAll('.gap-fill--chat-rollup')).toHaveLength(1)
    expect(container.textContent).toContain('Partial IRC chat rollup coverage — 1 bucket missing')
    expect(container.querySelector('.now')).toBeNull()

    rerender(
      <HubActivityChart
        points={[
          { t: end - 60_000, chat: 0, seventv: 0, viewers: 100, hasChatRollup: true, bucketComplete: true },
          { t: end, chat: 0, seventv: 0, viewers: 100, bucketComplete: true },
        ]}
        windowMinutes={2}
        channelCount={1}
      />,
    )

    expect(container.querySelectorAll('.gap-fill--chat-rollup')).toHaveLength(0)
  })

  it('marks attested registered gaps distinctly from measured zeros', () => {
    const end = Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000
    const { container } = render(
      <HubActivityChart
        points={[
          {
            t: end - 60_000,
            chat: 12,
            seventv: 1,
            viewers: 100,
            hasChatRollup: true,
            hasViewerRollup: true,
            bucketComplete: true,
          },
          {
            t: end,
            chat: 0,
            seventv: 0,
            viewers: 0,
            hasChatRollup: false,
            hasViewerRollup: false,
            gapKind: 'attested',
            bucketComplete: true,
          },
        ]}
        windowMinutes={2}
        channelCount={1}
      />,
    )

    expect(container.querySelectorAll('.gap-fill--attested')).toHaveLength(1)
    expect(container.textContent).toContain('Attested historical gap — not measured')
  })
})
