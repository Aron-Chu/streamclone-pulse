import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  formatClock,
  MomentVodPanel,
  twitchPlayerSrc,
  VOD_PREVIEW_SETTLE_MS,
  vodAutoPreviewAllowed,
  vodClockNote,
} from './MomentVodPanel.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const VOD = '2899924626'

describe('MomentVodPanel', () => {
  it('loads nothing from Twitch until Play, then swaps the player in at the Play time and focuses it', () => {
    const { container } = render(
      <MomentVodPanel vodId={VOD} playAt={3039} playVerb="Play VOD from" frame={null} subject="moment" hostname={() => 'localhost'} />,
    )
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.innerHTML).not.toContain('player.twitch.tv')
    fireEvent.click(screen.getByRole('button', { name: 'Play VOD from 0:50:39' }))
    const frame = container.querySelector('iframe')
    expect(frame?.getAttribute('src')).toBe('https://player.twitch.tv/?video=v2899924626&time=50m39s&parent=localhost&autoplay=true')
    expect(frame?.getAttribute('title')).toBe('Twitch VOD from 0:50:39')
    expect(frame?.getAttribute('allow')).toBe('autoplay; fullscreen')
    expect(document.activeElement).toBe(container.querySelector('.mpl-box.on'))
  })

  it('puts the picture back for a new Play time', () => {
    const { container, rerender } = render(
      <MomentVodPanel vodId={VOD} playAt={3039} playVerb="Play VOD from" frame={null} subject="moment" hostname={() => 'localhost'} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Play VOD from/ }))
    expect(container.querySelector('iframe')).not.toBeNull()
    rerender(<MomentVodPanel vodId={VOD} playAt={3099} playVerb="Play from" frame={null} subject="minute" hostname={() => 'localhost'} />)
    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.getByRole('button', { name: 'Play from 0:51:39' })).toBeTruthy()
  })

  it('opens the VOD in a new tab when the page has no hostname', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { container } = render(
      <MomentVodPanel vodId={VOD} playAt={3039} playVerb="Play VOD from" frame={null} subject="moment" hostname={() => ''} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Play VOD from/ }))
    expect(open).toHaveBeenCalledWith('https://www.twitch.tv/videos/2899924626?t=50m39s', '_blank', 'noopener')
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('offers no Play without a valid VOD or time, and shows the message instead', () => {
    const { rerender } = render(
      <MomentVodPanel vodId={null} playAt={3039} playVerb="Play from" frame={null} subject="minute" message="No VOD for this stream yet." />,
    )
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('No VOD for this stream yet.')).toBeTruthy()
    rerender(<MomentVodPanel vodId="v12" playAt={3039} playVerb="Play from" frame={null} subject="minute" />)
    expect(screen.queryByRole('button')).toBeNull()
    rerender(<MomentVodPanel vodId={VOD} playAt={null} playVerb="Play from" frame={null} subject="minute" message="This minute isn't in the VOD yet." />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('captions the lead-in with the VOD clock note', () => {
    const { container } = render(
      <MomentVodPanel vodId={VOD} playAt={3039} playVerb="Play VOD from" frame={null} subject="moment" leadCaption={{ leadSeconds: 10, alignSeconds: -5 }} />,
    )
    const cap = container.querySelector('.mpl-cap span[title]')
    expect(cap?.textContent).toBe("On the VOD's clock · , 10 s before the moment")
    expect(cap?.getAttribute('title')).toBe(
      'VOD time = stream time − 5 s (the VOD starts 5 s after the stream went live), then 10 s earlier so the moment plays in',
    )
  })
})

describe('MomentVodPanel preview (11-21)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  const panel = (props: Partial<Parameters<typeof MomentVodPanel>[0]> = {}) => (
    <MomentVodPanel vodId={VOD} playAt={3039} playVerb="Play from" frame={null} subject="minute" hostname={() => 'localhost'} preview {...props} />
  )

  it('holds a 16:9 box, then loads the player paused once the pick holds still, without moving focus', () => {
    vi.useFakeTimers()
    const before = document.activeElement
    const { container } = render(panel())
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('[data-preview-tile="waiting"]')).not.toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(VOD_PREVIEW_SETTLE_MS - 1)
    })
    expect(container.querySelector('iframe')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    const frame = container.querySelector('iframe')
    expect(frame?.getAttribute('src')).toBe('https://player.twitch.tv/?video=v2899924626&time=50m39s&parent=localhost&autoplay=false')
    expect(frame?.getAttribute('data-vod-player')).toBe('preview')
    expect(container.querySelector('[data-preview-tile="preview"]')).not.toBeNull()
    expect(document.activeElement).toBe(before)
  })

  it('loads nothing while the pick keeps moving', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(panel())
    act(() => {
      vi.advanceTimersByTime(200)
    })
    rerender(panel({ playAt: 3099 }))
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(container.querySelector('iframe')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(VOD_PREVIEW_SETTLE_MS - 200)
    })
    expect(container.querySelector('iframe')?.getAttribute('src')).toContain('time=51m39s')
  })

  it('a moment Play still starts the player playing, on the paused preview too', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(panel())
    act(() => {
      vi.advanceTimersByTime(VOD_PREVIEW_SETTLE_MS)
    })
    expect(container.querySelector('iframe')?.getAttribute('src')).toContain('autoplay=false')
    rerender(panel({ autoPlayToken: 1 }))
    const frame = container.querySelector('iframe')
    expect(frame?.getAttribute('src')).toBe('https://player.twitch.tv/?video=v2899924626&time=50m39s&parent=localhost&autoplay=true')
    expect(frame?.getAttribute('data-vod-player')).toBe('playing')
  })

  it('keeps Play without a hostname, and when preview is off', () => {
    vi.useFakeTimers()
    const { container, rerender } = render(panel({ hostname: () => '' }))
    act(() => {
      vi.advanceTimersByTime(VOD_PREVIEW_SETTLE_MS * 4)
    })
    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.getByRole('button', { name: 'Play from 0:50:39' })).toBeTruthy()
    rerender(panel({ preview: false }))
    act(() => {
      vi.advanceTimersByTime(VOD_PREVIEW_SETTLE_MS * 4)
    })
    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.getByRole('button', { name: 'Play from 0:50:39' })).toBeTruthy()
  })
})

describe('vodAutoPreviewAllowed', () => {
  const fakeWindow = (opts: { desktop: boolean; reducedData?: boolean; saveData?: boolean }) =>
    ({
      matchMedia: (query: string) => ({ matches: query.includes('prefers-reduced-data') ? Boolean(opts.reducedData) : opts.desktop }),
      navigator: { connection: { saveData: Boolean(opts.saveData) } },
    }) as unknown as Window

  it('allows a desktop pointer, and never a phone, a tablet or data saver', () => {
    expect(vodAutoPreviewAllowed(fakeWindow({ desktop: true }))).toBe(true)
    expect(vodAutoPreviewAllowed(fakeWindow({ desktop: false }))).toBe(false)
    expect(vodAutoPreviewAllowed(fakeWindow({ desktop: true, saveData: true }))).toBe(false)
    expect(vodAutoPreviewAllowed(fakeWindow({ desktop: true, reducedData: true }))).toBe(false)
    expect(vodAutoPreviewAllowed({} as Window)).toBe(false)
  })
})

describe('helpers', () => {
  it('formats the clock unpadded and the player URL with the page host', () => {
    expect(formatClock(3039)).toBe('0:50:39')
    expect(formatClock(36000 + 61)).toBe('10:01:01')
    expect(twitchPlayerSrc(VOD, 59, 'portal.example')).toBe('https://player.twitch.tv/?video=v2899924626&time=59s&parent=portal.example&autoplay=true')
    expect(twitchPlayerSrc(VOD, 59, 'portal.example', false)).toBe('https://player.twitch.tv/?video=v2899924626&time=59s&parent=portal.example&autoplay=false')
    expect(vodClockNote(0, 10)).toBe('VOD time = stream time + 0 s, then 10 s earlier so the moment plays in')
    expect(vodClockNote(120, 10)).toContain("(the VOD starts 120 s before the stream clock's 0:00:00)")
  })
})
