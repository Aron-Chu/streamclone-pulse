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
  it('mounts no player until the user asks for one, even at desktop width', () => {
    const view = render(<MomentVodPreview href={first} />)
    expect(view.container.querySelector('iframe')).toBeNull()
    expect(screen.getByRole('button', { name: /Load Twitch preview/ })).toBeTruthy()
    // The exact source stays usable without creating any player traffic.
    expect(screen.getByRole('link', { name: 'Open on Twitch' }).getAttribute('href')).toBe(first)
  })
  it('loads the exact verified source without autoplay once explicitly requested', () => {
    const view = render(<MomentVodPreview href={first} />)
    fireEvent.click(screen.getByRole('button', { name: /Load Twitch preview/ }))
    const source = new URL(view.container.querySelector('iframe')!.src)
    expect(source.origin).toBe('https://player.twitch.tv')
    expect(source.searchParams.get('video')).toBe('v123456')
    expect(source.searchParams.get('time')).toBe('120s')
    expect(source.searchParams.get('autoplay')).toBe('false')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close preview' }))
  })
  it('honors close and never carries playback over to a newly selected source', () => {
    const view = render(<MomentVodPreview href={first} />)
    fireEvent.click(screen.getByRole('button', { name: /Load Twitch preview/ }))
    expect(view.container.querySelectorAll('iframe')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }))
    expect(view.container.querySelector('iframe')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Load Twitch preview/ }))

    // Selecting a different moment must not inherit the opened state.
    fireEvent.click(screen.getByRole('button', { name: /Load Twitch preview/ }))
    expect(view.container.querySelectorAll('iframe')).toHaveLength(1)
    view.rerender(<MomentVodPreview href="https://www.twitch.tv/videos/654321?t=300s" />)
    expect(view.container.querySelector('iframe')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Load Twitch preview/ }))
    expect(view.container.querySelectorAll('iframe')).toHaveLength(1)
    expect(view.container.querySelector('iframe')!.src).toContain('video=v654321&time=300s')
  })
  it('does not claim the preview loads automatically', () => {
    render(<MomentVodPreview href={first} />)
    expect(screen.queryByText(/loads automatically/i)).toBeNull()
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
