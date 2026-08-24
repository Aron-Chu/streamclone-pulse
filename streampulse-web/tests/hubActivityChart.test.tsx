import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HubActivityChart } from '../src/ui/components/hub/HubActivityChart'

describe('HubActivityChart chat measurement honesty', () => {
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

  it('renders a sparse single viewer sample as a point instead of a flat trend', () => {
    const end = Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000
    const { container } = render(
      <HubActivityChart
        points={[
          { t: end - 60_000, chat: 10, seventv: 2, emotes: 2, viewers: 0, hasChatRollup: true, bucketComplete: true },
          { t: end, chat: 20, seventv: 4, emotes: 4, viewers: 457_000, hasChatRollup: true, hasViewerRollup: true, bucketComplete: true },
        ]}
        windowMinutes={2}
        channelCount={1}
      />,
    )

    expect(container.querySelectorAll('.hx-chart-line--viewers')).toHaveLength(0)
    expect(container.querySelectorAll('.hx-chart-point--viewers')).toHaveLength(1)
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
