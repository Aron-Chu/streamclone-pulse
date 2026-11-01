// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChartReadoutBand } from '../src/ui/ChartReadoutBand.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const topEmotes = [
  { id: '1', name: 'LOL', count: 106 },
  { id: '2', name: 'LO', count: 52 },
  { id: '3', name: 'BAND', count: 31 },
  { id: '4', name: 'Fourth', count: 10 },
]

describe('ChartReadoutBand', () => {
  it('shows the top three emote images in a recap preview header', () => {
    const markup = renderToStaticMarkup(
      <ChartReadoutBand
        mode="preview"
        offsetSeconds={27_120}
        viewerValue={15_769}
        chatValue={572}
        emoteValue={487}
        topEmotes={topEmotes}
        backendUrl="https://api.streampulse.stream"
        emoteScope="stream"
      />,
    )

    expect(markup).toContain('data-chart-readout-emote-scope="stream"')
    expect(markup.match(/data-chart-readout-emote="true"/g)).toHaveLength(3)
    expect(markup).toContain('LOL')
    expect(markup).toContain('LO')
    expect(markup).toContain('BAND')
    expect(markup).not.toContain('Fourth')
    expect(markup).toContain('Stream top emotes; this minute has no emote breakdown')
  })

  it('does not decorate the idle readout with unrelated emotes', () => {
    const markup = renderToStaticMarkup(
      <ChartReadoutBand
        mode="idle"
        topEmotes={topEmotes}
        backendUrl="https://api.streampulse.stream"
      />,
    )
    expect(markup).not.toContain('data-chart-readout-emotes="true"')
    // One quiet line: no title, blank clock or "Unavailable" metrics.
    expect(markup).toContain('Hover the chart to inspect a minute.')
    for (const text of ['Chart inspection', 'Unavailable', '—', 'data-chart-readout-metrics']) expect(markup).not.toContain(text)
  })

  it('updates in place when the inspected minute changes', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const band = (offsetSeconds: number, chatValue: number) => (
      <ChartReadoutBand
        mode="preview"
        offsetSeconds={offsetSeconds}
        chatValue={chatValue}
        topEmotes={topEmotes}
        backendUrl="https://api.streampulse.stream"
      />
    )
    try {
      act(() => root.render(band(60, 111)))
      const content = container.querySelector('.pulse-rb-content')
      const emote = container.querySelector('[data-chart-readout-emote="true"]')?.firstElementChild
      expect(emote).toBeTruthy()

      act(() => root.render(band(120, 222)))
      // Same nodes, new numbers: the emote pictures are not rebuilt every minute.
      expect(container.querySelector('.pulse-rb-content')).toBe(content)
      expect(container.querySelector('[data-chart-readout-emote="true"]')?.firstElementChild).toBe(emote)
      expect(container.querySelector('[data-chart-readout-metrics="true"]')?.textContent).toContain('222')
      expect(container.querySelector('[data-chart-readout="true"]')?.getAttribute('aria-atomic')).toBe('true')
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })
})
