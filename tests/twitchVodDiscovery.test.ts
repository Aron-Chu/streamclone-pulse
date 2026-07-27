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
  it('rejects when expected stream id is absent', () => {
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
      vodId: null,
      streamId: '41992682489',
      source: null,
      gqlErrors: ['expected_stream_id_required'],
    })
  })

  it('reads stream.archiveVideo id for live broadcast with exact stream id', () => {
    expect(
      parseLiveArchiveVodFromGql(
        {
          data: {
            user: {
              stream: {
                id: '41992682489',
                archiveVideo: { id: '1966541363' },
              },
            },
          },
        },
        '41992682489',
      ),
    ).toEqual({
      vodId: '1966541363',
      streamId: '41992682489',
      source: 'stream.archiveVideo',
      gqlErrors: [],
    })
  })

  it('rejects mismatched stream id', () => {
    expect(
      parseLiveArchiveVodFromGql(
        {
          data: {
            user: {
              stream: {
                id: '41992682489',
                archiveVideo: { id: '1966541363' },
              },
            },
          },
        },
        '99999999999',
      ),
    ).toEqual({
      vodId: null,
      streamId: '41992682489',
      source: null,
      gqlErrors: ['stream_id_mismatch'],
    })
  })
})

describe('parseArchiveListVodFromGql', () => {
  it('rejects uncorrelated latest archive without a stream-id match', () => {
    expect(
      parseArchiveListVodFromGql(
        {
          data: {
            user: {
              videos: {
                edges: [{ node: { id: '2678901234' } }],
              },
            },
          },
        },
        '41992682489',
      ),
    ).toEqual({
      vodId: null,
      streamId: null,
      source: null,
      gqlErrors: [],
    })
  })

  it('accepts archive list entries that match the expected stream id', () => {
    expect(
      parseArchiveListVodFromGql(
        {
          data: {
            user: {
              videos: {
                edges: [
                  { node: { id: '1111111111', broadcastId: '9999999999' } },
                  { node: { id: '2678901234', broadcastId: '41992682489' } },
                ],
              },
            },
          },
        },
        '41992682489',
      ),
    ).toEqual({
      vodId: '2678901234',
      streamId: '41992682489',
      source: 'videos.archive',
      gqlErrors: [],
    })
  })

  it('rejects the previous broadcast VOD when stream ids differ', () => {
    expect(
      parseArchiveListVodFromGql(
        {
          data: {
            user: {
              videos: {
                edges: [{ node: { id: '2678901234', broadcastId: '1111111111' } }],
              },
            },
          },
        },
        '41992682489',
      ),
    ).toEqual({
      vodId: null,
      streamId: null,
      source: null,
      gqlErrors: [],
    })
  })
})

describe('scrapeStreamIdFromPageHtml', () => {
  it('reads broadcast id separately from vod id', () => {
    expect(scrapeStreamIdFromPageHtml('{"broadcastId":"315762508393"}')).toBe('315762508393')
  })
})
