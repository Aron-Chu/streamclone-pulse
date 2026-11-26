import { describe, expect, it } from 'vitest'
import type { DiscoveryMoment } from '../src/lib/discoveryMoments'
import { lookupDay } from '../src/lib/channelLookup'
import { momentAtKey } from '../src/lib/momentFeedback'
import { momentEntryKey } from '../src/lib/momentPageFlag'
import {
  MORE_ROWS_MAX, channelMoreRows, gameMoreRows, hubMoreMoments, momentGameAt, otherChannelStreams,
  type ChannelStream, type MoreCurrent,
} from '../src/lib/momentMoreRows'
import { normalizePublicHub, type PublicHub } from '../src/lib/publicHub'

// Every name and id here is made up.
const CURRENT: MoreCurrent = { streamId: '9000001', login: 'fakechan01', momentAt: '20261110T1840Z' }
const NOW = Date.parse('2026-11-24T12:00:00Z')
const CATEGORY_ID = '509658'
const BOX_ART = `https://static-cdn.jtvnw.net/ttv-boxart/${CATEGORY_ID}-285x380.jpg`

describe('momentGameAt', () => {
  const segments = [
    { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 1800, categoryId: '509658', boxArtUrl: null },
    { gameName: 'Fake Game', offsetSeconds: 1800, durationSeconds: 3600, categoryId: '1234', boxArtUrl: null },
  ]

  it('is the game segment at the minute, with its category id', () => {
    expect(momentGameAt(segments, 2400, 'Something Else')).toEqual({ name: 'Fake Game', categoryId: '1234' })
    expect(momentGameAt(segments, 60, 'Something Else')).toEqual({ name: 'Just Chatting', categoryId: '509658' })
  })

  it('falls back to the stream’s category, without an id, when no segment covers the minute', () => {
    expect(momentGameAt([], 2400, 'Fake Game')).toEqual({ name: 'Fake Game', categoryId: null })
    expect(momentGameAt([{ ...segments[1]!, gameName: '  ' }], 2400, 'Fake Game')).toEqual({ name: 'Fake Game', categoryId: null })
  })

  it('is null when nothing names a game', () => {
    expect(momentGameAt([], 2400, '')).toBeNull()
    expect(momentGameAt([], 2400, '   ')).toBeNull()
  })
})

describe('otherChannelStreams', () => {
  const item = (streamId: string, startedAt: string, extra: Record<string, unknown> = {}) => ({ streamId, startedAt, ...extra })

  it('lists the channel’s other streams newest first, never the Moment’s own, two at most', () => {
    const items = [
      item('9000002', '2026-11-12T18:00:00Z', { displayName: 'FakeChan01', category: 'Fake Game' }),
      item('9000001', '2026-11-10T18:00:00Z'),
      item('9000004', '2026-11-20T18:00:00Z'),
      item('9000003', '2026-11-15T18:00:00Z'),
    ]
    expect(otherChannelStreams(items, CURRENT.streamId).map(s => s.streamId)).toEqual(['9000004', '9000003'])
    expect(otherChannelStreams(items, CURRENT.streamId, 5).map(s => s.streamId)).toEqual(['9000004', '9000003', '9000002'])
    expect(otherChannelStreams(items, CURRENT.streamId, 5)[2]).toEqual({ streamId: '9000002', startedAt: '2026-11-12T18:00:00Z', displayName: 'FakeChan01', category: 'Fake Game' })
  })

  it('leaves out malformed and repeated items, and answers nothing for a list that is not one', () => {
    const items = [
      item('not-a-number', '2026-11-20T18:00:00Z'), item('9000005', 'yesterday'), null, 'x',
      item('9000006', '2026-11-19T18:00:00Z'), item('9000006', '2026-11-18T18:00:00Z'),
    ]
    expect(otherChannelStreams(items, CURRENT.streamId, 5).map(s => s.streamId)).toEqual(['9000006'])
    expect(otherChannelStreams(undefined, CURRENT.streamId)).toEqual([])
    expect(otherChannelStreams({ items: [] }, CURRENT.streamId)).toEqual([])
  })
})

describe('channelMoreRows', () => {
  const s2: ChannelStream = { streamId: '9000002', startedAt: '2026-11-20T12:00:00Z', displayName: 'FakeChan01', category: 'Fake Game' }
  const s3: ChannelStream = { streamId: '9000003', startedAt: '2026-11-15T12:00:00Z' }
  const recap = (streamId: string, offsets: number[], login = 'fakechan01') => ({ login, streamId, topMoments: offsets.map(offsetSeconds => ({ offsetSeconds })) })

  it('takes each stream’s best Moment in turn, newest stream first, three at most', () => {
    const recaps = new Map([['9000002', recap('9000002', [1200, 3000, 4000])], ['9000003', recap('9000003', [600, 900])]])
    const rows = channelMoreRows(CURRENT, [s2, s3], recaps, NOW)
    expect(rows).toHaveLength(MORE_ROWS_MAX)
    expect(rows.map(r => [r.streamId, r.offsetSeconds])).toEqual([['9000002', 1200], ['9000003', 600], ['9000002', 3000]])
  })

  it('names each row’s minute from its stream’s start, and the stream’s day under the title', () => {
    const rows = channelMoreRows(CURRENT, [s2], new Map([['9000002', recap('9000002', [1200])]]), NOW)
    // 12:00:00 + 20:00 is the minute 12:20.
    expect(rows[0]).toMatchObject({
      streamId: '9000002', momentAt: '20261120T1220Z', at: Date.parse('2026-11-20T12:20:00Z'), login: 'fakechan01',
      displayName: 'FakeChan01', category: 'Fake Game', note: lookupDay(s2.startedAt, NOW),
    })
    expect(momentEntryKey(rows[0]!.at)).toBe(rows[0]!.momentAt)
  })

  it('leaves out a stream’s first five minutes and a minute already listed', () => {
    const rows = channelMoreRows(CURRENT, [s2], new Map([['9000002', recap('9000002', [0, 120, 299, 1200, 1210, 1800])]]), NOW)
    // A point rounds up to its minute: 12:20:00 is 12:20, 12:20:10 is 12:21.
    expect(rows.map(r => r.momentAt)).toEqual(['20261120T1220Z', '20261120T1221Z', '20261120T1230Z'])
    // 12:20:01 and 12:20:59 both round up to 12:21: listed once.
    const same = channelMoreRows(CURRENT, [s2], new Map([['9000002', recap('9000002', [1201, 1259, 1800])]]), NOW)
    expect(same.map(r => r.momentAt)).toEqual(['20261120T1221Z', '20261120T1230Z'])
  })

  it('never lists the Moment’s own stream, and ignores a recap that names another channel or stream', () => {
    const own: ChannelStream = { streamId: CURRENT.streamId, startedAt: '2026-11-10T18:00:00Z' }
    const recaps = new Map([
      [CURRENT.streamId, recap(CURRENT.streamId, [1200])],
      ['9000002', recap('9000002', [1200], 'otherchan')],
      ['9000003', recap('9000002', [1200])],
    ])
    expect(channelMoreRows(CURRENT, [own, s2, s3], recaps, NOW)).toEqual([])
  })

  it('is empty without streams, without recaps, or with failed ones', () => {
    expect(channelMoreRows(CURRENT, [], new Map(), NOW)).toEqual([])
    expect(channelMoreRows(CURRENT, [s2, s3], new Map(), NOW)).toEqual([])
    expect(channelMoreRows(CURRENT, [s2, s3], new Map([['9000002', null], ['9000003', { login: 'fakechan01', streamId: '9000003' }]]), NOW)).toEqual([])
  })
})

describe('gameMoreRows', () => {
  const GAME = { name: 'Fake Game', categoryId: CATEGORY_ID }
  const at = (minute: string) => Date.parse(`2026-11-24T${minute}:00Z`)
  const moment = (login: string, streamId: string, minute: string, extra: Partial<DiscoveryMoment> = {}): DiscoveryMoment => ({
    key: JSON.stringify([login, streamId, 1200]), login, streamId, offsetSeconds: 1200, at: at(minute), label: 'Chat spike',
    displayName: login.replace('fake', 'Fake'), category: 'Fake Game', categoryId: CATEGORY_ID, provenance: 'hub', ...extra,
  })

  it('lists other channels’ Moments in the game, newest first, one per channel, three at most', () => {
    const moments = [
      moment('fakechan02', '9100002', '11:50'),
      moment('fakechan02', '9100002', '11:40'),
      moment('fakechan03', '9100003', '11:30'),
      moment('fakechan04', '9100004', '11:20'),
      moment('fakechan05', '9100005', '11:10'),
    ]
    const rows = gameMoreRows(CURRENT, GAME, moments)
    expect(rows.map(r => r.login)).toEqual(['fakechan02', 'fakechan03', 'fakechan04'])
    expect(rows[0]).toMatchObject({ streamId: '9100002', momentAt: '20261124T1150Z', at: at('11:50'), note: 'Fakechan02', offsetSeconds: 1200 })
  })

  it('never lists the Moment’s own channel or stream', () => {
    const moments = [moment('fakechan01', '9000009', '11:50'), moment('fakechan09', CURRENT.streamId, '11:45'), moment('fakechan02', '9100002', '11:40')]
    expect(gameMoreRows(CURRENT, GAME, moments).map(r => r.login)).toEqual(['fakechan02'])
  })

  it('matches the game by category id, else by name', () => {
    const moments = [
      moment('fakechan02', '9100002', '11:50', { categoryId: '1111' }),
      moment('fakechan03', '9100003', '11:40', { categoryId: undefined, category: 'fake game' }),
      moment('fakechan04', '9100004', '11:30', { categoryId: undefined, category: 'Other Game' }),
      moment('fakechan05', '9100005', '11:20', { categoryId: '1111', categoryMetadataRejected: true, category: 'Fake Game' }),
    ]
    expect(gameMoreRows(CURRENT, GAME, moments).map(r => r.login)).toEqual(['fakechan03', 'fakechan05'])
    expect(gameMoreRows(CURRENT, { name: 'Fake Game', categoryId: null }, moments).map(r => r.login)).toEqual(['fakechan02', 'fakechan03', 'fakechan05'])
  })

  it('shows only what the Moments list shows: no first five minutes, nothing that rose under 1.2×', () => {
    const weak = { chat: { state: 'ready', multiplier: 1.1 }, emotes: { state: 'ready', multiplier: 0.9 } } as unknown as DiscoveryMoment['comparison']
    const strong = { chat: { state: 'ready', multiplier: 3.2 }, emotes: { state: 'ready', multiplier: 1 } } as unknown as DiscoveryMoment['comparison']
    const moments = [
      moment('fakechan02', '9100002', '11:50', { offsetSeconds: 120 }),
      moment('fakechan03', '9100003', '11:40', { comparison: weak }),
      moment('fakechan04', '9100004', '11:30', { comparison: strong }),
    ]
    expect(gameMoreRows(CURRENT, GAME, moments).map(r => r.login)).toEqual(['fakechan04'])
  })

  it('leaves out a Moment without a time or a usable stream id', () => {
    const moments = [moment('fakechan02', '9100002', '11:50', { at: undefined }), moment('fakechan03', 'abc', '11:40'), moment('fakechan04', '9100004', '11:30')]
    expect(gameMoreRows(CURRENT, GAME, moments).map(r => r.login)).toEqual(['fakechan04'])
  })

  it('names the minute from the hub’s time, and keeps only Twitch’s own cover for the game', () => {
    const [row] = gameMoreRows(CURRENT, GAME, [moment('fakechan02', '9100002', '11:50', { at: at('11:50') - 400, boxArtUrl: BOX_ART })])
    // A time just before the minute (a stream that started on a fractional second) rounds up to its whole second: 11:50.
    expect(momentAtKey(at('11:50') - 400)).toBe('20261124T1149Z')
    expect(row!.momentAt).toBe('20261124T1150Z')
    expect(row!.gameArt).toEqual({ url: BOX_ART, gameName: 'Fake Game' })
    const [other] = gameMoreRows(CURRENT, GAME, [moment('fakechan02', '9100002', '11:50', { boxArtUrl: 'https://example.com/art-285x380.jpg' })])
    expect(other!.gameArt).toBeUndefined()
  })

  it('is empty when nothing matches', () => {
    expect(gameMoreRows(CURRENT, GAME, [])).toEqual([])
    expect(gameMoreRows(CURRENT, { name: 'Nothing Here', categoryId: '42' }, [moment('fakechan02', '9100002', '11:50')])).toEqual([])
  })
})

describe('hubMoreMoments', () => {
  it('builds the Moments list’s rows from the hub snapshot, newest first, with the thumbnail the hub sends', () => {
    const artwork = { vodId: '9000000002', kind: 'archive_thumbnail', url: 'https://static-cdn.jtvnw.net/cf_vods/fakevods/9000000002/thumb/thumb0-640x360.jpg' }
    const live = (login: string, streamId: string, at: number, extra: Record<string, unknown> = {}) => ({
      login, streamId, offsetSeconds: 1200, at, label: 'Chat spike', kind: 'chat_spike', score: 1, category: 'Fake Game', categoryId: CATEGORY_ID, ...extra,
    })
    const hub = {
      ...normalizePublicHub(null),
      livePulseMoments: [
        live('fakechan02', '9100002', NOW - 600_000, { vodId: '9000000002', archiveArtwork: artwork }),
        live('fakechan03', '9100003', NOW - 60_000),
        live('BAD LOGIN', '9100004', NOW),
      ],
    } as unknown as PublicHub
    const moments = hubMoreMoments(hub)
    expect(moments.map(m => m.login)).toEqual(['fakechan03', 'fakechan02'])
    expect(moments[1]!.archiveArtwork?.url).toBe(artwork.url)
    expect(moments[0]!.archiveArtwork).toBeUndefined()
  })

  it('is empty for an empty hub', () => {
    expect(hubMoreMoments(normalizePublicHub(null))).toEqual([])
  })
})
