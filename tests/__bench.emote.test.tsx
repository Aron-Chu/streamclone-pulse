import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SevenTvEmotePanel } from '../src/ui/SevenTvEmotePanel.tsx'
import type { ExtensionEmote } from '../src/shared/messages.ts'

function makeEmotes(count: number): ExtensionEmote[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    name: `Bench${index + 1}`,
    count: 10_000 - index * 17,
    imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/1.0',
  }))
}

function time(label: string, iterations: number, fn: () => void): void {
  fn()
  const start = performance.now()
  for (let index = 0; index < iterations; index += 1) fn()
  const total = performance.now() - start
  // eslint-disable-next-line no-console
  console.log(`${label.padEnd(44)} ${(total / iterations).toFixed(3)} ms/op`)
}

describe('emote panel render benchmark', () => {
  it('measures rendering the complete scrollable catalog', () => {
    const topEmotes = makeEmotes(60)
    const props = {
      expanded: true,
      onToggleExpanded: () => {},
      backendUrl: 'http://localhost:8081',
      rollups: [],
      topEmotes,
      selectedKeys: [],
      onToggleEmote: () => {},
      selectedOffsetSeconds: null,
      maxSelected: 6,
      sidebarCompact: true,
    }
    const markup = renderToStaticMarkup(<SevenTvEmotePanel {...props} />)
    expect(markup).toContain('alt="Bench60"')
    expect((markup.match(/data-plot-emote-row=/g) ?? []).length).toBe(60)

    time('emote panel SSR render (60 chips)', 100, () => {
      renderToStaticMarkup(<SevenTvEmotePanel {...props} />)
    })
  })
})
