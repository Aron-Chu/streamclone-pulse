import { describe, expect, it } from 'vitest'
import { parseVodPictures, vodTile } from '../src/shared/vodPictures.ts'

const index = 'https://d1m7jfoe9zdc1j.cloudfront.net/abc_123/storyboards/2905053845-info.json'
const sheets = (quality: string, images: string[]) => ({ quality, images, cols: 5, rows: 5, count: 60, interval: 10, width: 220, height: 124 })

describe("Twitch's pictures of a VOD", () => {
  it('takes the high sheets, read against the storyboard index, with the cover and title', () => {
    const pictures = parseVodPictures(
      { title: '  GAMING TIME ', previewThumbnailURL: 'https://static-cdn.jtvnw.net/cf_vods/abc/thumb/thumb0-640x360.jpg', seekPreviewsURL: index },
      [sheets('low', ['low-0.jpg']), sheets('high', ['high-0.jpg', 'high-1.jpg', 'high-2.jpg'])],
    )
    expect(pictures).toEqual({
      title: 'GAMING TIME',
      cover: 'https://static-cdn.jtvnw.net/cf_vods/abc/thumb/thumb0-640x360.jpg',
      sheets: [
        'https://d1m7jfoe9zdc1j.cloudfront.net/abc_123/storyboards/high-0.jpg',
        'https://d1m7jfoe9zdc1j.cloudfront.net/abc_123/storyboards/high-1.jpg',
        'https://d1m7jfoe9zdc1j.cloudfront.net/abc_123/storyboards/high-2.jpg',
      ],
      cols: 5,
      rows: 5,
      count: 60,
      interval: 10,
    })
  })

  it('leaves out what is not from Twitch, a cover still processing, and sheets that do not add up', () => {
    const elsewhere = parseVodPictures(
      { previewThumbnailURL: 'https://example.com/cover.jpg', seekPreviewsURL: index },
      [sheets('high', ['high-0.jpg', 'https://example.com/high-1.jpg'])],
    )
    expect(elsewhere).toBeNull()
    const processing = parseVodPictures(
      { previewThumbnailURL: 'https://vod-secure.twitch.tv/_404/404_processing_640x360.png', seekPreviewsURL: index },
      [{ ...sheets('high', ['high-0.jpg']), interval: 0 }],
    )
    expect(processing).toBeNull()
    const coverOnly = parseVodPictures({ previewThumbnailURL: 'https://static-cdn.jtvnw.net/cf_vods/abc/thumb/thumb0-640x360.jpg', seekPreviewsURL: null }, null)
    expect(coverOnly).toMatchObject({ sheets: [], count: 0, cover: 'https://static-cdn.jtvnw.net/cf_vods/abc/thumb/thumb0-640x360.jpg' })
    expect(parseVodPictures(null, null)).toBeNull()
  })

  it('says when Twitch is still recording the VOD, which has no cover or sheets until the stream ends', () => {
    const live = parseVodPictures(
      { title: 'still live', status: 'RECORDING', previewThumbnailURL: 'https://vod-secure.twitch.tv/_404/404_processing_640x360.png', seekPreviewsURL: index },
      null,
    )
    expect(live).toEqual({ title: 'still live', sheets: [], cols: 0, rows: 0, count: 0, interval: 0, recording: true })
    const ended = parseVodPictures({ status: 'RECORDED', seekPreviewsURL: index }, [sheets('high', ['high-0.jpg'])])
    expect(ended).not.toHaveProperty('recording')
  })

  it('finds the tile nearest a VOD second, and none outside the VOD', () => {
    const pictures = parseVodPictures({ seekPreviewsURL: index }, [sheets('high', ['high-0.jpg', 'high-1.jpg', 'high-2.jpg'])])!
    expect(vodTile(pictures, 0)).toEqual({ sheet: pictures.sheets[0], col: 0, row: 0 })
    // Tile 27 is the third of the second sheet.
    expect(vodTile(pictures, 268)).toEqual({ sheet: pictures.sheets[1], col: 2, row: 0 })
    expect(vodTile(pictures, 244)).toEqual({ sheet: pictures.sheets[0], col: 4, row: 4 })
    expect(vodTile(pictures, -5)).toBeNull()
    expect(vodTile(pictures, 600)).toBeNull()
  })
})
