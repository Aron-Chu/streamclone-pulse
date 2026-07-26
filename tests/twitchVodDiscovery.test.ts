import { describe, expect, it } from 'vitest'
import {
  scrapeStreamIdFromText,
  scrapeVodFromPageTexts,
  scrapeVodIdFromText,
} from '../src/shared/vodIdPatterns.ts'
import { scrapeStreamIdFromPageHtml, scrapeVodIdFromPageHtml } from '../src/content/twitchVodDiscovery.ts'
import {
  parseArchiveListVodFromGql,
  parseLiveArchiveVodFromGql,
} from '../src/shared/twitchVodGql.ts'

describe('scrapeVodIdFromText', () => {
  it('reads archiveVideoId from embedded page json', () => {
    expect(scrapeVodIdFromPageHtml('{"archiveVideoId":"2678901234"}')).toBe('2678901234')
  })

  it('does not treat broadcastId as a VOD id', () => {
    expect(scrapeVodIdFromText('{"broadcastId":"315762508393"}')).toBeNull()
    expect(scrapeStreamIdFromText('{"broadcastId":"315762508393"}')).toBe('315762508393')
  })
})

describe('scrapeVodFromPageTexts', () => {
  it('scans inline script tags', () => {
    expect(
      scrapeVodFromPageTexts('<html></html>', ['window.__STATE__={"archiveVideoId":"1234567890"}']),
    ).toEqual({
      vodId: '1234567890',
      streamId: null,
      source: 'page_script',
      scannedScripts: 1,
    })
  })
})

describe('parseLiveArchiveVodFromGql', () => {
  it('reads stream.archiveVideo id for live broadcast', () => {
    expect(
      parseLiveArchiveVodFromGql({
        data: {
          user: {
            stream: {
              id: '41992682489',
              archiveVideo: { id: '1966541363' },
            },
          },
        },
      }),
    ).toEqual({
      vodId: '1966541363',
      streamId: '41992682489',
      source: 'stream.archiveVideo',
      gqlErrors: [],
    })
  })
})

describe('parseArchiveListVodFromGql', () => {
  it('reads latest archive from videos list', () => {
    expect(
      parseArchiveListVodFromGql({
        data: {
          user: {
            videos: {
              edges: [{ node: { id: '2678901234' } }],
            },
          },
        },
      }),
    ).toEqual({
      vodId: '2678901234',
      streamId: null,
      source: 'videos.archive',
      gqlErrors: [],
    })
  })
})

describe('scrapeStreamIdFromPageHtml', () => {
  it('reads broadcast id separately from vod id', () => {
    expect(scrapeStreamIdFromPageHtml('{"broadcastId":"315762508393"}')).toBe('315762508393')
  })
})
