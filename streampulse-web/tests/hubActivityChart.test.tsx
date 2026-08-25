import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HubActivityChart } from '../src/ui/components/hub/HubActivityChart'

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
    expect(container.textContent).toContain('Viewer samples partial — 1/3 buckets sampled; unsampled buckets are not zero viewers')
    expect(container.textContent).toContain('500 peak viewers · 1/3 sampled')
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
