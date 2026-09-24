import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ExtensionPeak, ExtensionRollup, PulsePayload } from '../src/shared/messages.ts'
import { LiveStatsBand } from '../src/ui/LiveStatsBand.tsx'

function makePayload(peaks: ExtensionPeak[]): PulsePayload {
  return {
    login: 'test',
    isLive: true,
    tracking: true,
    currentOffsetSeconds: 600,
    startedAt: '2026-06-11T12:00:00.000Z',
    rollups: Array.from({ length: 10 }, (_, i) => ({
      offsetSeconds: i * 60,
      chatCount: 20 + i,
      sevenTvEmoteCount: 4,
      totalEmoteCount: 8 + i,
    })),
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
    peaks,
    topEmotes: [{ id: '1', name: 'KEKW', count: 12 }],
  }
}

const refinedPeak: ExtensionPeak = {
  offsetSeconds: 120,
  score: 92,
  reasons: ['chat_spike'],
  reasonLabel: 'Chat spike',
  dominantSignal: 'chat',
  chatCount: 40,
  emoteCount: 3,
  precisionSeconds: 1,
  reactionOnsetOffsetSeconds: 128,
  seekOffsetSeconds: 124,
}

describe('LiveStatsBand chart layout', () => {
  it('distinguishes stream analytics from the separate Analytics Hub action', () => {
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([])}
        backendUrl="https://api.example.test"
        onOpenFullAnalytics={vi.fn()}
      />,
    )
    expect(markup).toContain('Stream analytics')
    expect(markup).not.toContain('Open full analytics')
    expect(markup).not.toContain('Open Analytics Hub')
  })

  it('keeps Stream Activity, Games Played, chart, and picker in order', () => {
    const payload = makePayload([refinedPeak])
    payload.games = [
      {
        id: 'game-1',
        categoryId: '509658',
        gameName: 'Just Chatting',
        offsetSeconds: 0,
        durationSeconds: 600,
      },
      {
        id: 'game-2',
        categoryId: '516575',
        gameName: 'VALORANT',
        offsetSeconds: 480,
        durationSeconds: 120,
      },
    ]
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={payload}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={600}
        pinOffsetSeconds={null}
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    const activityIdx = markup.indexOf('Stream activity')
    const gamesIdx = markup.indexOf('data-games-played="true"')
    const toolbarIdx = markup.indexOf('data-chart-toolbar="true"')
    const chartIdx = markup.indexOf('data-testid="pulse-overview-chart"')
    const viewportIdx = markup.indexOf('data-chart-viewport-controls="true"')
    const plotIdx = markup.indexOf('Plot on chart')
    expect(activityIdx).toBeGreaterThan(-1)
    expect(gamesIdx).toBeGreaterThan(-1)
    expect(toolbarIdx).toBeGreaterThan(-1)
    expect(chartIdx).toBeGreaterThan(-1)
    expect(viewportIdx).toBeGreaterThan(-1)
    expect(plotIdx).toBeGreaterThan(-1)
    expect(activityIdx).toBeLessThan(gamesIdx)
    expect(gamesIdx).toBeLessThan(toolbarIdx)
    expect(toolbarIdx).toBeLessThan(chartIdx)
    expect(chartIdx).toBeLessThan(viewportIdx)
    expect(chartIdx).toBeLessThan(plotIdx)
    expect(markup.indexOf('data-chart-moment-toggle="true"')).toBeGreaterThan(toolbarIdx)
    expect(markup.indexOf('data-chart-moment-toggle="true"')).toBeLessThan(chartIdx)
  })

  it('keeps accessible zoom buttons beside the rail in the compact sidebar', () => {
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([refinedPeak])}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={600}
        sidebarFill
        compact
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    expect(markup).toContain('data-chart-rail="true"')
    expect(markup).toContain('data-chart-zoom-out="true"')
    expect(markup).toContain('data-chart-zoom-reset="true"')
    expect(markup).toContain('data-chart-zoom-in="true"')
    expect(markup).toContain('Spikes')
    expect(markup).toContain('aria-label="Expand stream activity chart"')
  })

  it('keeps variable coverage metadata below the chart beside viewport controls', () => {
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([])}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={600}
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    const chartIdx = markup.indexOf('data-testid="pulse-overview-chart"')
    const rangeIdx = markup.indexOf('data-chart-visible-range')
    const viewportIdx = markup.indexOf('data-chart-viewport-controls="true"')
    expect(chartIdx).toBeGreaterThan(-1)
    expect(rangeIdx).toBeGreaterThan(-1)
    expect(viewportIdx).toBeGreaterThan(-1)
    expect(chartIdx).toBeLessThan(rangeIdx)
    expect(chartIdx).toBeLessThan(viewportIdx)
    expect(rangeIdx).toBeLessThan(markup.indexOf('Plot on chart'))
  })

  it('renders the top readout band and the chart-owned selection card when pinned', () => {
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([refinedPeak])}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={600}
        pinOffsetSeconds={120}
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    expect(markup).toContain('data-chart-inspector-owner="activity-chart"')
    expect(markup.match(/data-chart-inspector-owner="activity-chart"/g)).toHaveLength(1)
    expect(markup).toContain('data-chart-inspector-kind="minute"')
    expect(markup).toContain('data-chart-minute-card="true"')
    expect(markup).toContain('data-chart-readout-state="selected"')
    expect(markup).toContain('Viewers')
    expect(markup).toContain('Viewers not sampled')
    expect(markup).toContain('chat')
    expect(markup).toContain('emotes')
  })

  it('labels a reserved but unsampled viewer lane as unavailable', () => {
    const payload = makePayload([refinedPeak])
    payload.helixEnabled = true
    payload.peakViewers = 20_300
    payload.currentOffsetSeconds = 60
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={payload}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={60}
        isLive
        pinOffsetSeconds={120}
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    expect(markup).toContain('data-chart-inspector-owner="activity-chart"')
    expect(markup).toContain('Viewers')
    expect(markup).toContain('Viewers not sampled')
    expect(markup).toContain('data-chart-viewer-lane-label="true"')
    expect(markup).toContain('data-chart-viewer-strip-share="0.28"')
  })

  it('labels extension refresh-off state as viewer updates paused', () => {
    const payload = makePayload([refinedPeak])
    payload.helixEnabled = true
    payload.currentOffsetSeconds = 60
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={payload}
        backendUrl="https://api.streampulse.stream"
        currentOffsetSeconds={60}
        isLive
        autoUpdate={false}
      />,
    )
    expect(markup).toContain('Viewer updates paused')
    expect(markup).not.toContain('Viewer data unavailable')
  })

  it('renders an idle readout band above the chart without a bottom inspector card', () => {
    const idle = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([refinedPeak])}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={600}
        pinOffsetSeconds={null}
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    expect(idle).not.toContain('data-chart-inspector-owner="activity-chart"')
    expect(idle).toContain('data-chart-readout-state="idle"')
    expect(idle).toContain('Hover the chart to inspect a minute')
  })

  it('keeps the rail and zoom controls visible for a short full-range chart', () => {
    const payload = makePayload([])
    payload.currentOffsetSeconds = 60
    payload.rollups = payload.rollups.slice(0, 1)
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={payload}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={60}
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    expect(markup).toContain('data-chart-rail="true"')
    expect(markup).toContain('data-chart-zoom-out="true"')
    expect(markup).toContain('data-chart-zoom-reset="true"')
    expect(markup).toContain('data-chart-zoom-in="true"')
    expect(markup).toContain('data-chart-rail-resize="start"')
    expect(markup).toContain('background:transparent')
    expect(markup).not.toContain('rgba(255,255,255,0.72)')
  })

  it('pins the chart index and renders the chart-owned minute inspector', () => {
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([refinedPeak])}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={7_200}
        pinOffsetSeconds={128}
        hasVodContext
        onJumpMoment={vi.fn()}
        onJumpToOffset={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    expect(markup).toContain('data-chart-locked-index="1"')
    expect(markup).toContain('data-chart-scrubber="true"')
    expect(markup).toContain('data-chart-inspector-owner="activity-chart"')
    expect(markup).toContain('data-chart-minute-card="true"')
    expect(markup).toContain('Plot on chart')
  })

  it('retains controlled raw-minute data when the selected bucket is outside the loaded subset', () => {
    const selectedMinute: ExtensionRollup = {
      offsetSeconds: 930,
      chatCount: 777,
      sevenTvEmoteCount: 9,
      totalEmoteCount: 14,
    }
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([])}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={1_200}
        pinOffsetSeconds={selectedMinute.offsetSeconds}
        chartMinuteSelection={selectedMinute}
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )

    expect(markup).not.toContain('data-chart-locked-index=')
    expect(markup).toContain('data-chart-inspector-owner="activity-chart"')
    expect(markup).toContain('777 chat')
    expect(markup).toContain('14 emotes')
  })

  it('updates the pinned chart index when the selected offset changes', () => {
    const first = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([refinedPeak])}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={600}
        pinOffsetSeconds={120}
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    const second = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([refinedPeak])}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={600}
        pinOffsetSeconds={240}
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    expect(first).toContain('data-chart-locked-index="2"')
    expect(second).toContain('data-chart-locked-index="4"')
  })

  it('keeps the chart scrubber available while idle', () => {
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([refinedPeak])}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={600}
        pinOffsetSeconds={null}
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    expect(markup).toContain('data-chart-scrubber="true"')
    expect(markup).toContain('data-chart-mode="idle"')
    expect(markup).not.toContain('data-chart-minute-card="true"')
  })

  it('does not open an inspector for a Top Moments row preview', () => {
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([refinedPeak])}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={600}
        pinOffsetSeconds={null}
        previewOffsetSeconds={120}
        hasVodContext
        onJumpMoment={vi.fn()}
        onJumpToOffset={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    // The Top Moments row sits BELOW the chart. Opening a card for a row hover
    // would shift that row out from under the pointer, so only chart hover
    // (component-internal state) drives the preview inspector.
    expect(markup).toContain('data-chart-preview-index="2"')
    expect(markup).not.toContain('data-chart-inspector-owner="activity-chart"')
    expect(markup).not.toContain('data-chart-minute-card="true"')
    expect(markup).not.toContain('data-moment-inspector-state="preview"')
  })

  it('lets a committed pin win over a preview minute', () => {
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([refinedPeak])}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={600}
        pinOffsetSeconds={240}
        previewOffsetSeconds={120}
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    expect(markup.match(/data-chart-inspector-owner="activity-chart"/g)).toHaveLength(1)
    expect(markup).toContain('data-chart-inspector-kind="minute"')
    expect(markup).not.toContain('data-chart-inspector-kind="minute-preview"')
    expect(markup).toContain('data-moment-inspector-state="selected"')
    expect(markup).toContain('data-chart-inspector-kind="minute" aria-live="polite"')
  })

  it('uses the same chart-owned inspector for a selected Top Moment', () => {
    const payload = makePayload([refinedPeak])
    payload.rollups[2] = {
      ...payload.rollups[2],
      topEmotes: [
        { id: '1', name: 'KEKW', count: 18 },
        { id: '2', name: 'LOL', count: 12 },
        { id: '3', name: 'PLACE', count: 7 },
      ],
    }
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={payload}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={600}
        pinOffsetSeconds={128}
        selectedMomentOffsetSeconds={128}
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    expect(markup).not.toContain('data-selected-minute-slot="true"')
    expect(markup).toContain('data-chart-inspector-owner="activity-chart"')
    expect(markup).toContain('data-chart-inspector-kind="moment"')
    expect(markup).toContain('data-selected-moment-card="true"')
    expect(markup).not.toContain('data-chart-minute-card="true"')
    expect(markup).toContain('Top emotes for selected moment')
    expect(markup).toContain('KEKW')
    expect(markup).toContain('18 uses')
    expect(markup).toContain('Jump in player')
    expect(markup).toContain('Open Analytics')
    const selectedCardStart = markup.indexOf('data-selected-moment-card="true"')
    const selectedCardEnd = markup.indexOf('</div>', selectedCardStart)
    expect(selectedCardStart).toBeGreaterThan(-1)
    expect(selectedCardEnd).toBeGreaterThan(selectedCardStart)
    expect(markup.slice(selectedCardStart, selectedCardEnd)).not.toContain('Bookmark')
  })

  it('keeps the chart lock visible for a quiet minute', () => {
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([refinedPeak])}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={600}
        pinOffsetSeconds={480}
        hasVodContext
        onJumpMoment={vi.fn()}
        onJumpToOffset={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    expect(markup).toContain('data-chart-scrubber="true"')
    expect(markup).toContain('data-chart-mode="locked"')
    expect(markup).toContain('data-chart-locked-index="8"')
    expect(markup).toContain('data-chart-inspector-owner="activity-chart"')
    expect(markup).toContain('data-chart-minute-card="true"')
    expect(markup).toContain('Plot on chart')
  })

  it('keeps an observed zero viewer sample distinct from an unsampled minute', () => {
    const payload = makePayload([refinedPeak])
    payload.rollups[2] = { ...payload.rollups[2], viewerSamples: 1 }
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={payload}
        backendUrl="https://api.streampulse.stream"
        currentOffsetSeconds={600}
        pinOffsetSeconds={120}
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    expect(markup).toContain('data-viewer-sample-state="sampled"')
    expect(markup).toContain('0 viewers')
    expect(markup).not.toContain('Viewers not sampled')
  })

  it('marks the honest viewer sampling interval for a completed stream', () => {
    const payload = makePayload([refinedPeak])
    payload.isLive = false
    payload.rollups = payload.rollups.map((rollup, index) => ({
      ...rollup,
      ...(index >= 3 && index <= 7 ? { viewerSamples: 1, viewerCount: 1_000 + index } : {}),
    }))
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={payload}
        backendUrl="https://api.streampulse.stream"
        currentOffsetSeconds={600}
        isLive={false}
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    expect(markup).toContain('data-viewer-sample-marker="start"')
    expect(markup).toContain('data-viewer-sample-marker="end"')
    expect(markup).toContain('Viewer tracking began')
    expect(markup).toContain('Viewer tracking ended')
    expect(markup).toContain('Viewer data 00:03:00–00:07:00')
  })
})
