import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MomentPreview, MomentPreviewState } from '@streampulse/analytics-console/moment-previews'
import { MomentWatchHead } from '../src/ui/components/moments/watch/MomentWatchHead'

const TWITCH = 'https://www.twitch.tv/videos/123456789?t=2430s'
const stream = { login: 'fakechan01', displayName: 'FakeChan01', profileImageUrl: '', category: 'fake-pog' }
const artwork = { vodId: '123456789', kind: 'archive_thumbnail' as const, url: 'https://static-cdn.jtvnw.net/cf_vods/fake/thumb.jpg' }
const windowClip = {
  id: 'FakeClipSlug-1', url: 'https://www.twitch.tv/fakechan01/clip/FakeClipSlug-1', thumbnailUrl: 'https://clips-media-assets2.twitch.tv/fake.jpg',
  title: 'fake-pog play', durationSeconds: 24, from: '2026-11-14T10:39:30Z', to: '2026-11-14T10:40:30Z',
}
const frame: MomentPreview = { kind: 'frame', label: 'Stream frame', frame: {
  sheetUrl: 'https://d2vi6trrdongqn.cloudfront.net/fake/storyboards/1-high-0.jpg', sheetWidth: 1100, sheetHeight: 620, cropX: 0, cropY: 0, cropW: 220, cropH: 124, fromSec: null,
} }
const nearby: MomentPreview = { kind: 'clip', label: 'Nearby clip', imageUrl: 'https://clips-media-assets2.twitch.tv/nearby.jpg', clip: {
  id: 'FakeClipSlug-2', url: 'https://www.twitch.tv/fakechan01/clip/FakeClipSlug-2', title: 'nearby', thumbnailUrl: 'https://clips-media-assets2.twitch.tv/nearby.jpg',
  videoId: '123456789', vodOffsetSeconds: 2400, durationSeconds: 30, viewCount: 3, distanceSeconds: 12.4,
} }
const game: MomentPreview = { kind: 'game', label: 'Game art', imageUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/509658-285x380.jpg', gameName: 'Fake Game' }
const none: MomentPreview = { kind: 'none', label: 'No picture of this moment yet' }
const state = (preview: MomentPreview, loading = false): MomentPreviewState => ({ preview, loading, onImageError: vi.fn() })

function head(over: Partial<Parameters<typeof MomentWatchHead>[0]> = {}) {
  return render(
    <MemoryRouter>
      <MomentWatchHead stream={stream} clip={null} clipsChecked={false} offsetSeconds={2430} atSeconds={2430}
        twitchHref={TWITCH} artwork={null} picture={null} {...over} />
    </MemoryRouter>,
  )
}
const box = (container: HTMLElement) => container.querySelector('.mw-picture > :first-child')!
const label = (container: HTMLElement) => container.querySelector('.mw-picture > .mw-picture-label')
/** What a label shows (hidden from a screen reader) and what it reads out (the long words alone). */
const labelParts = (container: HTMLElement) => {
  const node = label(container)
  const shown = node?.querySelector(':scope > [aria-hidden="true"]')
  return { shown: shown?.textContent ?? null, read: node?.querySelector(':scope > .sr-only')?.textContent ?? null }
}
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('MomentWatchHead picture box', () => {
  it('is a same-size placeholder while the Moment is on its way, with the title and channel already there', () => {
    const { container } = head({ pending: true, twitchHref: null })
    expect(box(container).className).toBe('nc-player nc-skel-player')
    expect(screen.getByRole('heading', { level: 1, name: 'Moment at 0:40:30' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'FakeChan01' })).toBeTruthy()
    expect(label(container)).toBeNull()
    expect(screen.queryByRole('link', { name: /Watch on Twitch/ })).toBeNull()
    // The pill's room is held, unseen and unread, so the pill lands without moving anything.
    const hold = container.querySelector('.mw-pill-hold')!
    expect(hold.getAttribute('aria-hidden')).toBe('true')
    expect(hold.tagName).toBe('SPAN')
  })

  it('claims nothing before the page is idle: the neutral placeholder, no label, no "no picture" and no "no clip" line', () => {
    const { container } = head()
    // Still the link to Twitch, but no dashed "missing" box while the picture is undecided.
    expect(box(container).className).toBe('nc-player nc-skel-player')
    expect(box(container).getAttribute('href')).toBe(TWITCH)
    expect(container.querySelector('.nc-thumb-missing')).toBeNull()
    expect(container.querySelector('.mw-picture img, .mw-picture .moment-picture-frame')).toBeNull()
    expect(label(container)).toBeNull()
    expect(screen.queryByText('No picture of this moment yet')).toBeNull()
    expect(screen.queryByText('No clip of this one yet.')).toBeNull()
    // The pill says where the link goes; the box stays out of the tab order.
    expect(screen.getAllByText('Watch on Twitch from 0:40:30')).toHaveLength(1)
    expect(box(container).getAttribute('tabindex')).toBe('-1')
    expect(box(container).getAttribute('aria-hidden')).toBe('true')
    cleanup()
    // So while its reads are out.
    const reading = head({ picture: state(none, true) })
    expect(box(reading.container).className).toBe('nc-player nc-skel-player')
  })

  it('says nothing about a picture while its reads are out', () => {
    head({ picture: state(none, true) })
    expect(screen.queryByText('No picture of this moment yet')).toBeNull()
  })

  it('says there is no picture once the reads found none, and "no clip" only when the clips were listed', () => {
    head({ picture: state(none) })
    expect(screen.getByText('No picture of this moment yet')).toBeTruthy()
    expect(screen.queryByText('No clip of this one yet.')).toBeNull()
    cleanup()
    head({ picture: state(none), clipsChecked: true })
    expect(screen.getByText('No clip of this one yet.')).toBeTruthy()
    expect(screen.queryByText('No picture of this moment yet')).toBeNull()
  })

  it('keeps the approved stream thumbnail, labelled as the stream’s thumbnail, before and after idle', () => {
    for (const picture of [null, state({ kind: 'broadcast', label: 'VOD thumbnail', imageUrl: artwork.url })]) {
      const { container } = head({ artwork, picture })
      expect(box(container).hasAttribute('data-unavailable')).toBe(true)
      expect(box(container).querySelector('img')?.getAttribute('src')).toBe(artwork.url)
      expect(labelParts(container)).toEqual({ shown: 'VOD thumbnail', read: 'The stream’s thumbnail, not this moment' })
      expect(label(container)?.getAttribute('title')).toBe('The stream’s thumbnail, not this moment')
      // Beside the hidden box link, so a screen reader reads it.
      expect(label(container)?.getAttribute('aria-hidden')).toBeNull()
      expect(screen.queryByText('No picture of this moment yet')).toBeNull()
      cleanup()
    }
  })

  it.each([
    ['a stream frame', frame, 'Stream frame', 'Stream frame from this moment'],
    ['a nearby clip', nearby, 'Nearby clip', 'Nearby clip from the same stream, 12 s from the moment'],
    ['game art', game, 'Game art', 'Game art for Fake Game, not this moment'],
  ])('shows %s whole, labelled, with no words over it', (_name, preview, short, long) => {
    const { container } = head({ artwork, picture: state(preview) })
    const thumb = box(container)
    expect(thumb.tagName).toBe('A')
    expect(thumb.getAttribute('href')).toBe(TWITCH)
    expect(thumb.getAttribute('data-kind')).toBe(preview.kind)
    expect(thumb.hasAttribute('data-unavailable')).toBe(false)
    expect(thumb.querySelector('.nc-thumb-gone')).toBeNull()
    if (preview.kind === 'frame') expect(thumb.querySelector('.moment-picture-frame')).not.toBeNull()
    else expect(thumb.querySelector('img')?.getAttribute('src')).toBe((preview as { imageUrl: string }).imageUrl)
    expect(labelParts(container)).toEqual({ shown: short, read: long })
    expect(label(container)?.getAttribute('title')).toBe(long)
    expect(screen.queryByText('No clip of this one yet.')).toBeNull()
  })

  it.each([
    ['game art', game],
    ['a nearby clip', nearby],
  ])('holds %s while a better picture may still come: the placeholder, or the stream thumbnail', (_name, preview) => {
    const reading = head({ picture: state(preview, true) })
    expect(box(reading.container).className).toBe('nc-player nc-skel-player')
    expect(reading.container.querySelector('.mw-picture img')).toBeNull()
    expect(label(reading.container)).toBeNull()
    cleanup()
    const withArtwork = head({ artwork, picture: state(preview, true) })
    expect(box(withArtwork.container).querySelector('img')?.getAttribute('src')).toBe(artwork.url)
    expect(labelParts(withArtwork.container).shown).toBe('VOD thumbnail')
    cleanup()
    // Decided: it shows.
    const done = head({ picture: state(preview) })
    expect(box(done.container).getAttribute('data-kind')).toBe(preview.kind)
  })

  it('shows a stream frame at once, while the other reads are still out', () => {
    const { container } = head({ artwork, picture: state(frame, true) })
    expect(box(container).getAttribute('data-kind')).toBe('frame')
    expect(labelParts(container).shown).toBe('Stream frame')
  })

  it('shows its own picture without a link when no Twitch link is confirmed', () => {
    const { container } = head({ twitchHref: null, picture: state(game) })
    expect(box(container).tagName).toBe('DIV')
    expect(label(container)?.textContent).toContain('Game art')
    expect(screen.queryByText(/Watch on Twitch/)).toBeNull()
  })

  it('shows the window’s clip over any picture, with its own link and no label', () => {
    const { container } = head({ clip: windowClip, clipsChecked: true, artwork, picture: state(frame) })
    expect(screen.getByRole('link', { name: 'fake-pog play (opens on Twitch)' }).getAttribute('href')).toBe(windowClip.url)
    expect(screen.getByRole('heading', { level: 1, name: 'fake-pog play' })).toBeTruthy()
    expect(label(container)).toBeNull()
    expect(container.querySelector('.moment-picture-frame')).toBeNull()
  })
})
