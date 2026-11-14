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
    expect(screen.getByRole('link', { name: 'Watch on Twitch at 0:02:00' })).toBeTruthy()
  })
  it('shows bound broadcast artwork on mobile and survives image failure', () => {
    width = 390
    const artwork = { vodId: '123456', kind: 'archive_thumbnail' as const, url: 'https://static-cdn.jtvnw.net/cf_vods/archive/thumb/test.jpg' }
    const view = render(<MomentVodPreview href={first} artwork={artwork} />)
    expect(screen.getByText('Broadcast thumbnail · not an exact moment frame')).toBeTruthy()
    expect(view.container.querySelector('iframe')).toBeNull()
    fireEvent.error(view.container.querySelector('img')!)
    expect(view.container.querySelector('img')).toBeNull()
    expect(screen.getByRole('link', { name: 'Watch on Twitch at 0:02:00' }).getAttribute('href')).toBe(first)
  })
  it('on a phone puts the given actions in the card, under "Watch on Twitch at …" and above the note in the DOM (D, rounds 2-3)', () => {
    width = 320
    const view = render(<MomentVodPreview href={first} actions={<div className="moments-primary-actions"><button type="button">Save</button></div>} />)
    const card = view.container.querySelector('.moment-vod-preview')!
    expect(card.classList.contains('moment-vod-preview--actions')).toBe(true)
    expect(card.querySelector(':scope > .moments-primary-actions button')?.textContent).toBe('Save')
    // reading order is the shown order: the link, Save, then the playback note
    const link = screen.getByRole('link', { name: 'Watch on Twitch at 0:02:00' })
    const save = screen.getByRole('button', { name: 'Save' })
    const note = screen.getByText('Playback depends on Twitch availability.')
    expect(link.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(save.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // wide enough for the player, nothing is reordered
    width = 640
    view.rerender(<MomentVodPreview href="https://www.twitch.tv/videos/654321?t=300s" actions={<div className="moments-primary-actions" />} />)
    expect(view.container.querySelector('.moment-vod-preview--actions')).toBeNull()
  })
  it('keeps focus on the card when a layout switch moves it to another parent (D1)', () => {
    // The phone layout renders the watch row in another parent, so the card remounts at the switch.
    const Moved = ({ phone }: { phone: boolean }) => <>
      <section>{phone ? null : <MomentVodPreview href={first} />}</section>
      <section>{phone ? <MomentVodPreview href={first} /> : null}</section>
    </>
    const view = render(<Moved phone={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Load Twitch preview/ }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close preview' }))
    width = 390
    view.rerender(<Moved phone />)
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Watch on Twitch at 0:02:00' }))
    // A card that held no focus hands none on.
    ;(document.activeElement as HTMLElement).blur()
    width = 640
    view.rerender(<Moved phone={false} />)
    expect(document.activeElement).toBe(document.body)
  })
  it.each(['https://evil.example/videos/123456?t=1s', 'https://www.twitch.tv/videos/abc?t=1s', 'https://www.twitch.tv/videos/123456'])('rejects malformed/untrusted playback URL %s', href => {
    const view = render(<MomentVodPreview href={href} />)
    expect(view.container.querySelector('iframe')).toBeNull()
  })
})
