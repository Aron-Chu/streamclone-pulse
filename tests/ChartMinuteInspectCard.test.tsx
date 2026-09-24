// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ChartMinuteInspectCard } from '../src/ui/ChartMinuteInspectCard.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('ChartMinuteInspectCard', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
  })

  it('keeps the canonical bucket offset and passes it to Jump exactly once', () => {
    const jumps: number[] = []
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <ChartMinuteInspectCard
          rollup={{
            offsetSeconds: 9_561,
            chatCount: 476,
            sevenTvEmoteCount: 428,
            totalEmoteCount: 428,
            viewerCount: 20_300,
            topEmotes: [{ name: 'LOL', count: 89 }],
          }}
          backendUrl="https://api.streampulse.stream"
          jumpLabel="Jump in player"
          onJump={offset => jumps.push(offset)}
          onClose={() => undefined}
        />,
      )
    })

    expect(container.textContent).toContain('02:39:21')
    expect(container.textContent).not.toContain('02:39:00')
    expect(container.querySelector('[data-moment-inspector-activity="true"]')?.textContent)
      .toBe('20.3K viewers · 476 chat · 428 emotes')
    expect(container.querySelector('[data-moment-inspector-metrics="true"]')).toBeNull()

    // The redesigned action renders a glyph before the label, so match on the
    // label rather than exact textContent.
    const jump = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Jump in player'))
    expect(jump).toBeDefined()
    expect(container.querySelector('[data-chart-minute-card="true"]')?.getAttribute('data-chart-action'))
      .toBe('true')
    act(() => jump?.click())
    expect(jumps).toEqual([9_561])
  })

  it('keeps the inspector selection alive until an action click is handled', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <ChartMinuteInspectCard
          rollup={{ offsetSeconds: 120, chatCount: 10, totalEmoteCount: 2, topEmotes: [] }}
          backendUrl="https://api.streampulse.stream"
          jumpLabel="Jump in player"
          onJump={() => undefined}
          onClose={() => undefined}
        />,
      )
    })

    // The redesigned action renders a glyph before the label, so match on the
    // label rather than exact textContent.
    const jump = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.includes('Jump in player'))
    expect(jump).toBeDefined()

    let documentPointerDowns = 0
    let documentClicks = 0
    const onDocumentPointerDown = () => { documentPointerDowns += 1 }
    const onDocumentClick = () => { documentClicks += 1 }
    document.addEventListener('pointerdown', onDocumentPointerDown)
    document.addEventListener('click', onDocumentClick)
    act(() => {
      jump?.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }))
      jump?.click()
    })
    document.removeEventListener('pointerdown', onDocumentPointerDown)
    document.removeEventListener('click', onDocumentClick)

    expect(documentPointerDowns).toBe(0)
    expect(documentClicks).toBe(0)
  })

  it('matches the selected-moment surface without a fixed height or decorative waveform', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <ChartMinuteInspectCard
          rollup={{ offsetSeconds: 120, chatCount: 10, totalEmoteCount: 2 }}
          backendUrl="https://api.streampulse.stream"
          onClose={() => undefined}
        />,
      )
    })

    const card = container.querySelector<HTMLElement>('[data-chart-minute-card="true"]')
    expect(card?.style.background).toBe('rgba(255, 255, 255, 0.025)')
    expect(card?.style.background).not.toContain('gradient')
    expect(card?.style.minHeight).toBe('')
    expect(card?.textContent).toContain('Minute activity')
    expect(container.querySelector('svg')).toBeNull()
    expect(container.textContent).not.toContain('Minute bucket')
    expect(container.querySelector('[data-moment-inspector-emotes="true"]')).toBeNull()
    expect(container.textContent).not.toContain('Top emotes')
    expect(container.textContent).not.toContain('No emote breakdown')
  })




  it('reports an unsampled minute honestly when viewerSamples is 0', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <ChartMinuteInspectCard
          rollup={{ offsetSeconds: 600, chatCount: 120, totalEmoteCount: 40, viewerSamples: 0 }}
          backendUrl="https://api.streampulse.stream"
          onClose={() => undefined}
        />,
      )
    })

    expect(container.querySelector('[data-viewer-sample-state]')?.getAttribute('data-viewer-sample-state'))
      .toBe('not-sampled')
    expect(container.textContent).toContain('Viewers not sampled · 120 chat · 40 emotes')
  })

  it('renders the preview variant without any action or close control', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <ChartMinuteInspectCard
          rollup={{
            offsetSeconds: 600,
            chatCount: 120,
            totalEmoteCount: 40,
            topEmotes: [{ name: 'LOL', count: 12 }],
          }}
          backendUrl="https://api.streampulse.stream"
          interactionState="preview"
        />,
      )
    })

    const card = container.querySelector<HTMLElement>('[data-moment-inspector-card="true"]')
    expect(card?.getAttribute('data-moment-inspector-state')).toBe('preview')
    expect(card?.classList.contains('pulse-moment-inspector-card')).toBe(true)
    // A hover card must not offer click targets that vanish with the pointer.
    expect(container.querySelectorAll('button')).toHaveLength(0)
    // Preview emotes are free: rollup.topEmotes is already in the payload.
    expect(container.querySelector('[data-emote-name="LOL"]')).not.toBeNull()
  })

  it('orders the compact activity line as viewers, chat, then emotes', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <ChartMinuteInspectCard
          rollup={{
            offsetSeconds: 600,
            chatCount: 476,
            totalEmoteCount: 428,
            viewerCount: 20_300,
            viewerSamples: 2,
          }}
          backendUrl="https://api.streampulse.stream"
          onClose={() => undefined}
        />,
      )
    })

    const activity = container.querySelector<HTMLElement>('[data-moment-inspector-activity="true"]')
    expect(activity?.textContent).toBe('20.3K viewers · 476 chat · 428 emotes')
    expect(activity?.getAttribute('data-viewer-sample-state')).toBe('sampled')
    expect(container.querySelector('[data-moment-inspector-metrics="true"]')).toBeNull()
    expect(container.querySelector('[data-moment-inspector-state="selected"]')?.classList.contains('pulse-moment-selection-card')).toBe(true)
  })

  it('renders selected-minute emotes as vertical name and usage rows', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <ChartMinuteInspectCard
          rollup={{
            offsetSeconds: 600,
            chatCount: 10,
            totalEmoteCount: 2,
            topEmotes: [{ name: 'LOL', count: 1_234 }],
          }}
          backendUrl="https://api.streampulse.stream"
          onClose={() => undefined}
        />,
      )
    })

    const row = container.querySelector<HTMLElement>('[data-moment-inspector-emote-row="true"]')
    expect(row?.textContent).toContain('LOL')
    expect(row?.textContent).toContain('1,234 uses')
    expect((row?.lastElementChild as HTMLElement | null)?.style.flexShrink).toBe('0')
  })

  it('offers only Jump and Analytics for a committed raw minute', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <ChartMinuteInspectCard
          rollup={{ offsetSeconds: 9_561, chatCount: 10, totalEmoteCount: 2 }}
          backendUrl="https://api.streampulse.stream"
          jumpLabel="Jump in player"
          onJump={() => undefined}
          onAnalytics={() => undefined}
          onClose={() => undefined}
        />,
      )
    })

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    expect(buttons.some(button => button.textContent?.includes('Jump in player'))).toBe(true)
    expect(buttons.some(button => button.textContent?.includes('Analytics'))).toBe(true)
    expect(buttons.some(button => button.textContent === 'Bookmark')).toBe(false)
  })

  it('keeps the preview variant free of actions', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <ChartMinuteInspectCard
          rollup={{ offsetSeconds: 600, chatCount: 10, totalEmoteCount: 2 }}
          backendUrl="https://api.streampulse.stream"
          interactionState="preview"
        />,
      )
    })

    expect(container.querySelectorAll('button')).toHaveLength(0)
  })
})
