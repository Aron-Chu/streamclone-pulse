import { describe, expect, it } from 'vitest'
import {
  scrapeStreamIdFromText,
  scrapeVodFromPageTexts,
  scrapeVodIdFromText,
} from '../src/shared/vodIdPatterns.ts'
import {
  navigationCandidateFromPageTexts,
  resolveLiveJumpDestination,
  resolveNativeLiveVodLink,
  resolveTwitchPageVodLink,
  scrapeStreamIdFromPageHtml,
  scrapeVodIdFromPageHtml,
} from '../src/content/twitchVodDiscovery.ts'
import {
  exactLiveArchiveVodId,
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

describe('exactLiveArchiveVodId', () => {
  it('trusts only an exact stream.archiveVideo identity match', () => {
    const exact = {
      vodId: '1966541363',
      streamId: '41992682489',
      source: 'stream.archiveVideo' as const,
      gqlErrors: [],
    }
    expect(exactLiveArchiveVodId(exact, '41992682489')).toBe('1966541363')
    expect(exactLiveArchiveVodId({ ...exact, source: 'videos.archive' }, '41992682489')).toBeNull()
    expect(exactLiveArchiveVodId(exact, 'different-stream')).toBeNull()
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

describe('Twitch current-broadcast VOD navigation', () => {
  it('accepts an explicit Twitch watch-from-beginning control', () => {
    expect(resolveNativeLiveVodLink([
      {
        href: '/videos/2839713915',
        ariaLabel: 'Watch from beginning',
      },
    ])).toEqual({
      vodId: '2839713915',
      source: 'native_twitch_control',
      href: 'https://www.twitch.tv/videos/2839713915',
    })
  })

  it('accepts a bare player VOD chip and rejects the same href as a channel card', () => {
    expect(resolveNativeLiveVodLink([
      {
        href: '/videos/2839713915',
        text: 'VOD',
        withinPlayer: true,
      },
    ])).toEqual({
      vodId: '2839713915',
      source: 'native_twitch_control',
      href: 'https://www.twitch.tv/videos/2839713915',
    })
    expect(resolveNativeLiveVodLink([
      {
        href: '/videos/2839713915',
        text: 'VOD',
        dataTarget: 'player-controls-vod-button',
      },
    ])).toEqual({
      vodId: '2839713915',
      source: 'native_twitch_control',
      href: 'https://www.twitch.tv/videos/2839713915',
    })
    expect(resolveNativeLiveVodLink([
      {
        href: '/videos/2839713915',
        text: 'VOD',
      },
    ])).toBeNull()
  })

  it('rejects unrelated channel video cards and unsafe destinations', () => {
    expect(resolveNativeLiveVodLink([
      { href: '/videos/2839713915', text: 'Yesterday’s highlight' },
      { href: 'https://example.com/videos/2839713915', text: 'Watch from beginning' },
      { href: 'javascript:alert(1)', text: 'Watch VOD' },
    ])).toBeNull()
  })

  it('uses a same-origin Twitch video card only as a navigation candidate', () => {
    expect(resolveTwitchPageVodLink([
      { href: '/videos/2839713915', text: 'Current stream archive' },
    ])).toEqual({
      vodId: '2839713915',
      source: 'twitch_page_vod_candidate',
      href: 'https://www.twitch.tv/videos/2839713915',
    })
    expect(resolveTwitchPageVodLink([
      { href: 'https://example.com/videos/2839713915', text: 'Fake archive' },
    ])).toBeNull()
  })

  it('accepts semantic current-archive metadata for navigation only', () => {
    expect(navigationCandidateFromPageTexts(
      '{"broadcastId":"317426400740","archiveVideoId":"2839713915"}',
      [],
      '317426400740',
    )).toEqual({ vodId: '2839713915', source: 'page_archive_metadata' })
  })

  it('rejects page archive metadata when Twitch exposes a conflicting stream id', () => {
    expect(navigationCandidateFromPageTexts(
      '{"broadcastId":"999999999999","archiveVideoId":"2839713915"}',
      [],
      '317426400740',
    )).toBeNull()
  })

  it('prefers locally validated GQL over a page candidate for jump destination', () => {
    expect(resolveLiveJumpDestination({
      streamId: '317426400740',
      locallyValidatedVodId: '1111111111',
      locallyValidatedStreamId: '317426400740',
      pageCandidate: { vodId: '2839713915', source: 'native_twitch_control' },
    })).toEqual({ vodId: '1111111111', source: 'locally_validated_gql' })

    expect(resolveLiveJumpDestination({
      streamId: '317426400740',
      pageCandidate: { vodId: '2839713915', source: 'native_twitch_control' },
    })).toEqual({ vodId: '2839713915', source: 'native_twitch_control' })
  })

  it('uses Past Streams current-live video id when GQL/DOM are unavailable', () => {
    expect(resolveLiveJumpDestination({
      streamId: '317426400740',
      pastStreamsVodId: '2839713915',
    })).toEqual({ vodId: '2839713915', source: 'past_streams_current_live' })
  })
})
