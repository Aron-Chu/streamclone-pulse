// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Model the real proxy contract: `peek` is synchronous and only answers for
// already-warm entries, `resolve` performs the round-trip and warms the cache.
const { warmCache } = vi.hoisted(() => ({ warmCache: new Map<string, string>() }))

vi.mock('../src/shared/emoteImageProxy.ts', () => ({
  peekProxiedEmoteSrc: (url: string | undefined) => (url ? warmCache.get(url) : undefined),
  resolveProxiedEmoteSrc: vi.fn(async (url: string | undefined) => {
    if (!url) return undefined
    warmCache.set(url, url)
    return url
  }),
}))

import { PulseEmoteImg } from '../src/ui/PulseEmoteImg.tsx'

const AWARE = {
  id: '01FFWH9WV80000JT8GHDKHJNZC',
  name: 'Aware',
  provider: '7TV',
  count: 42,
}

describe('PulseEmoteImg', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    warmCache.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('renders a real 7TV image in the focusable hover preview', async () => {
    await act(async () => {
      root.render(createElement(PulseEmoteImg, {
        emote: AWARE,
        backendUrl: 'https://api.streampulse.stream',
        showHoverPreview: true,
        previewFocusable: true,
        width: 20,
        height: 20,
      }))
      await Promise.resolve()
    })

    const wrapper = container.querySelector('.pulse-emote-hover-wrap') as HTMLElement | null
    const images = [...container.querySelectorAll<HTMLImageElement>('img')]
    const preview = container.querySelector('[role="tooltip"]')

    expect(wrapper?.tabIndex).toBe(0)
    expect(wrapper?.getAttribute('aria-describedby')).toBe(preview?.id)
    expect(images).toHaveLength(2)
    expect(images[0]?.src).toContain('/emote/01FFWH9WV80000JT8GHDKHJNZC/4x.webp')
    expect(images[1]?.src).toContain('/emote/01FFWH9WV80000JT8GHDKHJNZC/4x.webp')
    expect(preview?.textContent).toContain('Aware')
    expect(preview?.textContent).toContain('42 uses')
  })

  // Regression: moving the pointer across chart buckets remounts the inspector
  // thumbnails. A remount that paints one placeholder frame before the resolved
  // src arrives reads as flicker, so a warm emote must paint an <img> on the
  // first frame.
  it('paints an <img> on first paint once the emote is warm, with no placeholder', async () => {
    const props = {
      emote: AWARE,
      backendUrl: 'https://api.streampulse.stream',
      eager: true,
      width: 18,
      height: 18,
    }

    // Cold mount: the placeholder is expected because nothing is cached yet.
    act(() => {
      root.render(createElement(PulseEmoteImg, props))
    })
    expect(container.querySelector('.pulse-emote-loading')).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()

    // Let the round-trip settle so the cache is warm.
    await act(async () => {
      await Promise.resolve()
    })
    expect(container.querySelector('img')).not.toBeNull()

    // Second mount of the same emote — the flicker case.
    act(() => root.unmount())
    root = createRoot(container)
    act(() => {
      root.render(createElement(PulseEmoteImg, props))
    })

    const img = container.querySelector<HTMLImageElement>('img')
    expect(container.querySelector('.pulse-emote-loading')).toBeNull()
    expect(img).not.toBeNull()
    expect(img?.getAttribute('loading')).toBe('eager')
  })

  it('lazy-loads by default and eager-loads only when asked', async () => {
    await act(async () => {
      root.render(createElement(PulseEmoteImg, {
        emote: AWARE,
        backendUrl: 'https://api.streampulse.stream',
      }))
      await Promise.resolve()
    })

    expect(container.querySelector('img')?.getAttribute('loading')).toBe('lazy')
  })
})
