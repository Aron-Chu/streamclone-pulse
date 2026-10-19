import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MomentPreviewTile,
  PREVIEW_PLAYER_LOADS_COPY,
  PREVIEW_RECORDING_COPY,
  previewNoteLines,
  safePreviewArtUrl,
} from './MomentPreviewTile.tsx'
import type { VodFrame } from '../../utils/vodFrames.ts'

const SHEET = 'https://d2vi6trrdongqn.cloudfront.net/x/storyboards/1-high-0.jpg'
const FRAME: VodFrame = { sheetUrl: SHEET, sheetWidth: 1600, sheetHeight: 900, cropX: 320, cropY: 180, cropW: 160, cropH: 90, fromSec: 3000 }
const ART = 'https://static-cdn.jtvnw.net/ttv-boxart/32982_IGDB-144x192.jpg'

afterEach(() => cleanup())

describe('MomentPreviewTile', () => {
  it('crops the storyboard tile and says how far it sits from the minute', () => {
    const { container } = render(
      <MomentPreviewTile frame={FRAME} subject="minute" subjectVodStart={3054} playLabel="Play from 0:50:54" onPlay={() => {}} />,
    )
    const box = container.querySelector('.mpl-box')
    expect(box?.className).toBe('mpl-box fr')
    const pic = container.querySelector<HTMLElement>('.mpl-fr')
    expect(pic?.style.backgroundImage).toContain(SHEET)
    expect(pic?.style.backgroundPosition).toBe('22.2222% 22.2222%')
    expect(container.querySelector('.mpl-bg')).toBeNull()
    expect(container.querySelector('.mpl-note')?.textContent)
      .toBe(`${PREVIEW_PLAYER_LOADS_COPY}Preview frame from about 54 s before this minute.`)
  })

  it('falls back to blurred game art and the reason, never a stand-in frame', () => {
    const { container } = render(
      <MomentPreviewTile frame={null} subject="minute" artUrl={ART} recording playLabel="Play from 0:50:54" onPlay={() => {}} />,
    )
    expect(container.querySelector('.mpl-box')?.className).toBe('mpl-box nofr')
    expect(container.querySelector('.mpl-fr')).toBeNull()
    expect(container.querySelector('img.mpl-bg')?.getAttribute('src')).toBe(ART)
    expect(container.querySelector('.mpl-note')?.textContent).toBe(PREVIEW_RECORDING_COPY)
  })

  it('says there is no frame for an ended VOD and names the unit', () => {
    const { container, rerender } = render(<MomentPreviewTile frame={null} subject="minute" />)
    expect(container.querySelector('.mpl-note')?.textContent).toBe('No preview frame for this minute.')
    rerender(<MomentPreviewTile frame={null} subject="bar" />)
    expect(container.querySelector('.mpl-note')?.textContent).toBe('No preview frame for this bar.')
  })

  it('refuses box art from other hosts', () => {
    expect(safePreviewArtUrl('https://example.com/a.jpg')).toBeNull()
    expect(safePreviewArtUrl('https://static-cdn.jtvnw.net/a b.jpg')).toBeNull()
    expect(safePreviewArtUrl(ART)).toBe(ART)
    const { container } = render(<MomentPreviewTile frame={null} subject="minute" artUrl="https://example.com/a.jpg" />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('shows Play only with a handler, else the message', () => {
    const onPlay = vi.fn()
    const { rerender } = render(<MomentPreviewTile frame={null} subject="moment" playLabel="Play VOD from 0:50:39" onPlay={onPlay} />)
    fireEvent.click(screen.getByRole('button', { name: 'Play VOD from 0:50:39' }))
    expect(onPlay).toHaveBeenCalledTimes(1)
    rerender(<MomentPreviewTile frame={null} subject="moment" message="No VOD for this stream yet." />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('No VOD for this stream yet.').className).toBe('mpl-msg')
  })

  it('holds the reason back while the frame is loading', () => {
    const { container } = render(<MomentPreviewTile frame={null} loading subject="minute" artUrl={ART} />)
    expect(container.querySelector('.mpl-note')).toBeNull()
    expect(container.querySelector('[data-preview-tile]')?.getAttribute('data-preview-tile')).toBe('loading')
  })

  it('replaces the picture with the player', () => {
    const { container } = render(
      <MomentPreviewTile frame={FRAME} subject="minute" player={<iframe title="Twitch VOD from 0:50:39" />} />,
    )
    expect(container.querySelector('.mpl-box')?.className).toBe('mpl-box on')
    expect(container.querySelector('.mpl-fr')).toBeNull()
    expect(container.querySelector('iframe')).not.toBeNull()
  })
})

describe('previewNoteLines', () => {
  it("gives the moment player both lines when there is no frame", () => {
    expect(previewNoteLines({ frame: null, subject: 'moment', recording: true, canPlay: true })).toEqual([
      { text: PREVIEW_RECORDING_COPY, quiet: false },
      { text: PREVIEW_PLAYER_LOADS_COPY, quiet: true },
    ])
    expect(previewNoteLines({ frame: null, subject: 'moment', recording: false, canPlay: false })).toEqual([
      { text: 'No preview frame for this minute.', quiet: false },
    ])
  })

  it('drops the timing line when the tile start is unknown', () => {
    expect(previewNoteLines({ frame: { ...FRAME, fromSec: null }, subject: 'bar', subjectVodStart: 10, canPlay: true }))
      .toEqual([{ text: PREVIEW_PLAYER_LOADS_COPY, quiet: false }])
  })
})
