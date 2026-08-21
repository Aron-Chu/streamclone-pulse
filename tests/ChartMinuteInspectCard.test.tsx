import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ChartMinuteInspectCard } from '../src/ui/ChartMinuteInspectCard.tsx'
import type { ExtensionRollup } from '../src/shared/messages.ts'

const rollup: ExtensionRollup = {
  offsetSeconds: 4440,
  chatCount: 354,
  sevenTvEmoteCount: 243,
  totalEmoteCount: 243,
  topEmotes: [
    { id: '1', name: 'GG', count: 40, imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0' },
    { id: '2', name: 'W', count: 20, imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0' },
  ],
}

describe('ChartMinuteInspectCard', () => {
  it('renders the compact under-chart selection strip', () => {
    const markup = renderToStaticMarkup(
      <ChartMinuteInspectCard
        rollup={rollup}
        backendUrl="http://localhost:8081"
        jumpLabel="VOD"
        onJump={vi.fn()}
        onAnalytics={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(markup).toContain('data-chart-minute-card="true"')
    expect(markup).toContain('01:14:00')
    expect(markup).toContain('354 chat')
    expect(markup).toContain('243 emotes')
    expect(markup).toContain('>VOD<')
    expect(markup).toContain('>Analytics<')
    expect(markup).toContain('aria-label="Close selection"')
    expect(markup).toContain('alt="GG"')
    expect(markup).toContain('data-seek-offset="4440"')
  })

  it('jumps to the containing minute start, not leftover seconds', () => {
    const markup = renderToStaticMarkup(
      <ChartMinuteInspectCard
        rollup={{ ...rollup, offsetSeconds: 4475 }}
        backendUrl="http://localhost:8081"
        jumpLabel="VOD"
        onJump={vi.fn()}
        onAnalytics={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(markup).toContain('data-seek-offset="4440"')
  })
})
