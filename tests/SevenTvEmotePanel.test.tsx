import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SevenTvEmotePanel } from '../src/ui/SevenTvEmotePanel.tsx'
import type { ExtensionEmote, ExtensionRollup } from '../src/shared/messages.ts'
import { emoteSelectionKey } from '../src/ui/chatActivityEmotes.ts'

function makeEmotes(count: number): ExtensionEmote[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    name: `E${index + 1}`,
    count: 100 - index,
    provider: '7tv',
    imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0',
  }))
}

function activeRollup(emotes: ExtensionEmote[]): ExtensionRollup[] {
  return [{ offsetSeconds: 0, chatCount: 10, totalEmoteCount: 20, topEmotes: emotes }]
}

describe('SevenTvEmotePanel compact rail', () => {
  it('renders one always-visible six-option rail without disclosure or scrolling', () => {
    const emotes = makeEmotes(10)
    const html = renderToStaticMarkup(
      <SevenTvEmotePanel
        backendUrl="http://localhost:8081"
        rollups={activeRollup(emotes)}
        topEmotes={emotes}
        selectedKeys={[]}
        onToggleEmote={vi.fn()}
      />,
    )

    expect(html).toContain('data-plot-emote-rail="compact"')
    expect((html.match(/data-plot-emote-state=/g) ?? []).length).toBe(6)
    expect(html).not.toContain('aria-expanded')
    expect(html).not.toContain('data-emote-picker-scroll')
    expect(html).toContain('title="E6 · 95 uses · Toggle chart line"')
    expect(html).not.toContain('title="E7 ·')
  })

  it('keeps selected emotes visible first and marks selection without color alone', () => {
    const emotes = makeEmotes(8)
    const selectedKey = emoteSelectionKey(emotes[7]!)
    const html = renderToStaticMarkup(
      <SevenTvEmotePanel
        backendUrl="http://localhost:8081"
        rollups={activeRollup(emotes)}
        topEmotes={emotes}
        selectedKeys={[selectedKey]}
        selectedPlotColors={{ [selectedKey]: '#22c55e' }}
        onToggleEmote={vi.fn()}
      />,
    )

    expect(html.indexOf('title="E8')).toBeLessThan(html.indexOf('title="E1'))
    expect(html).toContain('data-plot-emote-state="selected"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('>✓<')
    expect(html).toContain('#22c55e')
  })

  it('keeps selected options removable at the six-emote cap', () => {
    const emotes = makeEmotes(7)
    const selectedKeys = emotes.slice(0, 6).map(emoteSelectionKey)
    const html = renderToStaticMarkup(
      <SevenTvEmotePanel
        backendUrl="http://localhost:8081"
        rollups={activeRollup(emotes)}
        topEmotes={emotes}
        selectedKeys={selectedKeys}
        onToggleEmote={vi.fn()}
      />,
    )

    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(6)
    expect(html).not.toContain('disabled=""')
  })

  it('exposes the full name and count in an above-positioned hover preview', () => {
    const emotes = makeEmotes(1)
    const html = renderToStaticMarkup(
      <SevenTvEmotePanel
        backendUrl="http://localhost:8081"
        rollups={activeRollup(emotes)}
        topEmotes={emotes}
        selectedKeys={[]}
        onToggleEmote={vi.fn()}
      />,
    )

    expect(html).toContain('pulse-emote-hover-wrap--above')
    expect(html).toContain('>E1<')
    expect(html).toContain('>100 uses<')
    expect(html).toContain('aria-label="E1, 100 uses. Toggle chart line"')
  })
})
