import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MomentVodPreview } from '../src/ui/components/moments/MomentVodPreview'

let width = 640
beforeEach(() => {
  width = 640
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width } }] as ResizeObserverEntry[], this as unknown as ResizeObserver) }
    disconnect() {}
  })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const first = 'https://www.twitch.tv/videos/123456?t=120s'

describe('selected verified preview lifecycle', () => {
  it.each([399, 400])('honors the exact Twitch minimum width at %ipx', boundary => {
    width = boundary
    const view = render(<MomentVodPreview href={first} />)
    expect(view.container.querySelectorAll('iframe')).toHaveLength(boundary === 400 ? 1 : 0)
    const linkName = boundary === 400 ? 'Watch at 2:00 on Twitch' : 'Watch on Twitch at 2:00'
    expect(screen.getByRole('link', { name: linkName }).getAttribute('href')).toBe(first)
    if (boundary === 400) expect(view.container.querySelector('iframe')!.src).toContain('autoplay=false')
  })
  it('loads immediately without autoplay and exposes one exact external action', () => {
    const view = render(<MomentVodPreview href={first} />)
    const source = new URL(view.container.querySelector('iframe')!.src)
    expect(source.origin).toBe('https://player.twitch.tv')
    expect(source.searchParams.get('video')).toBe('v123456')
    expect(source.searchParams.get('time')).toBe('120s')
    expect(source.searchParams.get('autoplay')).toBe('false')
    expect(screen.getByRole('link', { name: 'Watch at 2:00 on Twitch' }).getAttribute('href')).toBe(first)
  })
  it('honors close, but a different selected source gets its own automatic preview', () => {
    const view = render(<MomentVodPreview href={first} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    expect(view.container.querySelector('iframe')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Load Twitch preview/ }))
    view.rerender(<MomentVodPreview href="https://www.twitch.tv/videos/654321?t=300s" />)
    expect(view.container.querySelectorAll('iframe')).toHaveLength(1)
    expect(view.container.querySelector('iframe')!.src).toContain('video=v654321&time=300s')
  })
  it('does not instantiate a player below the supported width', () => {
    width = 390
    const view = render(<MomentVodPreview href={first} />)
    expect(view.container.querySelector('iframe')).toBeNull()
    expect(screen.getByRole('link', { name: 'Watch on Twitch at 2:00' })).toBeTruthy()
  })
  it('shows bound broadcast artwork on mobile and survives image failure', () => {
    width = 390
    const artwork = { vodId: '123456', kind: 'archive_thumbnail' as const, url: 'https://static-cdn.jtvnw.net/cf_vods/archive/thumb/test.jpg' }
    const view = render(<MomentVodPreview href={first} artwork={artwork} />)
    expect(screen.getByText('Broadcast thumbnail · not an exact moment frame')).toBeTruthy()
    expect(view.container.querySelector('iframe')).toBeNull()
    fireEvent.error(view.container.querySelector('img')!)
    expect(view.container.querySelector('img')).toBeNull()
    expect(screen.getByRole('link', { name: 'Watch on Twitch at 2:00' }).getAttribute('href')).toBe(first)
  })
  it.each(['https://evil.example/videos/123456?t=1s', 'https://www.twitch.tv/videos/abc?t=1s', 'https://www.twitch.tv/videos/123456'])('rejects malformed/untrusted playback URL %s', href => {
    const view = render(<MomentVodPreview href={href} />)
    expect(view.container.querySelector('iframe')).toBeNull()
  })
})
