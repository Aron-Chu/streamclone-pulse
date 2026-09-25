import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChartReadoutBand } from '../src/ui/ChartReadoutBand.tsx'

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
  })
})
