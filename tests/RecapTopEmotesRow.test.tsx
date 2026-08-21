import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RecapTopEmotesRow } from '../src/ui/RecapTopEmotesRow.tsx'

describe('RecapTopEmotesRow', () => {
  it('renders a ranked row list instead of wrap chips', () => {
    const markup = renderToStaticMarkup(
      <RecapTopEmotesRow
        backendUrl="http://localhost:8081"
        emotes={[
          { name: 'KEKW', count: 120, id: 'a' },
          { name: 'OMEGALUL', count: 80, id: 'b' },
          { name: 'Pog', count: 40, id: 'c' },
        ]}
      />,
    )
    expect(markup).toContain('Top emotes this stream')
    expect(markup).toContain('data-recap-top-emotes="ranked"')
    expect(markup).toContain('pulse-top-emote-row')
    expect(markup).toContain('>1<')
    expect(markup).toContain('>2<')
    expect(markup).toContain('KEKW')
    expect(markup).not.toContain('pulse-top-emote-chip')
    expect(markup).not.toContain('Plot emotes on the chart above.')
  })
})
