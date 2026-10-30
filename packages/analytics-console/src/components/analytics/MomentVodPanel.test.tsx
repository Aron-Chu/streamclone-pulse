import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatClock, MomentVodPanel, twitchPlayerSrc, vodClockCaption, vodClockNote } from './MomentVodPanel.tsx'

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
    expect(cap?.textContent).toBe("On the VOD's clock · , 10\u00a0s before the moment")
    expect(cap?.getAttribute('title')).toBe(
      'VOD time = stream time − 5 s (the VOD starts 5 s after the stream went live), then 10 s earlier so the moment plays in',
    )
  })
})

describe('helpers', () => {
  it('formats the clock unpadded and the player URL with the page host', () => {
    expect(formatClock(3039)).toBe('0:50:39')
    expect(formatClock(36000 + 61)).toBe('10:01:01')
    expect(twitchPlayerSrc(VOD, 59, 'portal.example')).toBe('https://player.twitch.tv/?video=v2899924626&time=59s&parent=portal.example&autoplay=true')
    expect(vodClockNote(0, 10)).toBe('VOD time = stream time + 0 s, then 10 s earlier so the moment plays in')
    expect(vodClockNote(120, 10)).toContain("(the VOD starts 120 s before the stream clock's 0:00:00)")
    expect(vodClockNote(-6, 0)).toBe('VOD time = stream time − 6 s (the VOD starts 6 s after the stream went live)')
    expect(vodClockCaption(-5, 10)).toBe('10\u00a0s before the moment')
    expect(vodClockCaption(-6, 0)).toBe("6\u00a0s behind the stream's")
    expect(vodClockCaption(120, 0)).toBe("120\u00a0s ahead of the stream's")
  })
})
