// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MomentMedia, MomentSignal, safePresentationUrl } from './MomentMedia.tsx'
import { MomentStats, MomentEmotes, emoteShare } from './MomentStats.tsx'
import { demoReference } from '../../../docs/pulse-extension/monetization-mockups/library-workflow/demoRepository.ts'
import { demoContexts } from '../../../docs/pulse-extension/monetization-mockups/library-workflow/demoContexts.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
let container: HTMLDivElement
async function render(node: ReactNode) {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => root!.render(node))
}
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren() })

describe('Moment media and statistics', () => {
  it('labels approximate frames and recovers from expired artwork', async () => {
    await render(<MomentMedia moment={demoReference} presentation={{ image: { url: 'https://example.com/frame.webp', sampledOffsetSeconds: 6130 } }} />)
    const img = container.querySelector('img')!
    expect(img.alt).toContain('near 01:42:10')
    expect(container.textContent).toContain('not an archived copy')
    await act(async () => img.dispatchEvent(new Event('error')))
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('Preview image unavailable')
  })
  it('rejects unsafe links and does not invent a baseline', async () => {
    for (const url of ['javascript:alert(1)', 'https://user:pass@example.com', 'http://example.com', 'broken']) expect(safePresentationUrl(url)).toBeUndefined()
    await render(<MomentSignal />)
    expect(container.textContent).toContain('Stream comparison unavailable')
  })
  it('uses a same-minute emote denominator and allows density above 100', async () => {
    expect(emoteShare(156, 520)).toBe('30.0%')
    expect(emoteShare(0, 520)).toBe('0.0%')
    for (const total of [null, 0, NaN, -1, 100]) expect(emoteShare(156, total)).toBeNull()
    const context = demoContexts.two
    if (context.kind !== 'ready') throw new Error('Missing fixture')
    await render(<MomentStats context={context.value} />)
    expect(container.textContent).toContain('125.0')
    expect(container.textContent).toContain('not a percentage of viewers')
  })
  it('preserves emote names, providers and counts on CDN failure', async () => {
    const context = demoContexts.two
    if (context.kind !== 'ready') throw new Error('Missing fixture')
    await render(<MomentEmotes context={context.value} />)
    const img = container.querySelector('img')!
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer')
    await act(async () => img.dispatchEvent(new Event('error')))
    expect(container.textContent).toContain('forsenPls')
    expect(container.textContent).toContain('7TV')
    expect(container.textContent).toContain('156 uses / min')
  })
  it('keeps missing viewer counts unavailable, not zero', async () => {
    const context = demoContexts.one
    if (context.kind !== 'ready') throw new Error('Missing fixture')
    await render(<MomentStats context={context.value} />)
    expect(container.querySelector('dd')?.textContent).toBe('Not available')
  })
})
