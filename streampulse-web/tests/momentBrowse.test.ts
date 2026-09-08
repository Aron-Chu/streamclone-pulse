import { describe, expect, it } from 'vitest'
import { browseLoadedItems, browseRangeError, loadedMomentNeighbors, readMomentBrowse } from '../src/lib/momentBrowse'
import { groupDiscoveryBroadcasts } from '../src/lib/discoveryPresentation'

const now = Date.parse('2026-09-04T20:00:00Z')
const rows = [
  { key: 'a', text: 'Lacy chat spike', category: 'Minecraft', at: now - 60000 },
  { key: 'b', text: 'Other emote spike', category: 'VALORANT', at: now - 3600000 },
  { key: 'c', text: 'Lacy previous stream', category: 'Minecraft', at: Date.parse('2026-09-03T23:59:59.999Z') },
  { key: 'd', text: 'Undated detection' },
]
const browse = (query: string) => browseLoadedItems(rows, readMomentBrowse(new URLSearchParams(query)), row => row, now).map(row => row.key)
describe('loaded moment browsing', () => {
  it('groups exact normalized login and opaque stream ID in first-appearance order without altering detections', () => {
    const items = [
      { key: 'a', login: 'Creator', streamId: '001', offsetSeconds: 0, at: now, category: 'A' },
      { key: 'b', login: 'other', streamId: '001', offsetSeconds: 0, at: now },
      { key: 'c', login: 'creator', streamId: '001', offsetSeconds: 90000, at: now - 1, category: 'B' },
      { key: 'd', login: 'creator', streamId: '1', offsetSeconds: 60, at: now - 2 },
    ]
    const groups = groupDiscoveryBroadcasts(items)
    expect(groups.map(group => group.items.map(item => item.key))).toEqual([['a', 'c'], ['b'], ['d']])
    expect(groups[0]).toMatchObject({ login: 'creator', streamId: '001' })
    expect(groups[0].items[0]).toBe(items[0])
    expect(groups[0].items[1]).toBe(items[2])
    expect(items.map(item => item.key)).toEqual(['a', 'b', 'c', 'd'])
  })
  it.each(['newest', 'oldest', 'category', 'chatPerMin', 'emotesPerMin', 'chatIncrease', 'emoteIncrease'])('retains the existing %s sort within and between loaded broadcast groups', order => {
    const items = Array.from({ length: 6 }, (_, index) => ({ key: String(index), login: 'creator', streamId: String(index % 2),
      text: '', at: Date.parse(index < 3 ? '2026-09-01T23:59:59Z' : '2026-09-02T00:00:00Z'),
      category: index % 2 ? 'A' : 'B', ...(['newest', 'oldest', 'category'].includes(order) ? {} : { [order]: index < 4 ? 10 : undefined }) }))
    const sorted = browseLoadedItems(items, readMomentBrowse(new URLSearchParams(`sort=${order}`)), item => item, now)
    const groups = groupDiscoveryBroadcasts(sorted)
    expect(groups.map(group => group.streamId)).toEqual([...new Set(sorted.map(item => item.streamId))])
    for (const group of groups) expect(group.items).toEqual(sorted.filter(item => item.streamId === group.streamId))
  })
  it('sorts measured rates and increases with zero before missing and stable chronological ties', () => {
    for (const order of ['chatPerMin', 'emotesPerMin', 'chatIncrease', 'emoteIncrease']) {
      const items = [
        { key: 'missing', text: '', at: now + 1 },
        { key: 'zero', text: '', at: now, [order]: 0 },
        { key: 'older', text: '', at: now - 1, [order]: 50 },
        { key: 'newer', text: '', at: now, [order]: 50 },
        { key: 'invalid', text: '', [order]: NaN },
      ]
      expect(browseLoadedItems(items, readMomentBrowse(new URLSearchParams(`sort=${order}`)), row => row, now).map(row => row.key))
        .toEqual(['newer', 'older', 'zero', 'missing', 'invalid'])
      expect(items[0].key).toBe('missing')
    }
  })
  it('reviews only exact neighbors in filtered display order without wrapping or guessing missing identities', () => {
    const sorted = browseLoadedItems(rows, readMomentBrowse(new URLSearchParams('category=Minecraft&sort=oldest')), row => row, now)
    expect(loadedMomentNeighbors(sorted, 'c')).toEqual({position:1,total:2,previous:undefined,next:rows[0]})
    expect(loadedMomentNeighbors(sorted, 'a')).toEqual({position:2,total:2,previous:rows[2],next:undefined})
    for (const key of ['b', 'missing', undefined]) expect(loadedMomentNeighbors(sorted,key)).toEqual({position:null,total:2,previous:undefined,next:undefined})
    expect(loadedMomentNeighbors([], 'a').position).toBeNull()
    expect(loadedMomentNeighbors([rows[0], rows[0]], 'a').next).toBeUndefined()
  })
  it('limits occurrence time without manufacturing history or dropping undated rows from all', () => {
    expect(browse('')).toEqual(['a','b','c','d'])
    expect(browse('occurred=30m')).toEqual(['a'])
    expect(browse('occurred=24h')).toEqual(['a','b','c'])
  })
  it('combines category, text and chronological/category ordering without mutating input', () => {
    expect(browse('category=Minecraft&q=lacy&sort=oldest')).toEqual(['c','a'])
    expect(browse('sort=category')).toEqual(['a','c','b','d'])
    expect(rows.map(row => row.key)).toEqual(['a','b','c','d'])
  })
  it('includes the entire UTC end date and excludes unknown dates', () => {
    expect(browse('occurred=custom&from=2026-09-03&to=2026-09-03')).toEqual(['c'])
    expect(browse('occurred=custom&from=2026-09-04&to=2026-09-04')).toEqual(['a','b'])
  })
  it('rejects incomplete, impossible, and reversed custom dates', () => {
    for (const query of ['occurred=custom','occurred=custom&from=2026-02-30&to=2026-03-01','occurred=custom&from=2026-09-04&to=2026-09-03']) {
      expect(browseRangeError(readMomentBrowse(new URLSearchParams(query)))).toBeTruthy()
      expect(browse(query)).toEqual([])
    }
  })
  it('normalizes unsupported controls, bounds search, and excludes future timestamps from relative ranges', () => {
    const config = readMomentBrowse(new URLSearchParams('occurred=full&sort=score&q='+'x'.repeat(300)))
    expect(config.period).toBe('all'); expect(config.order).toBe('newest'); expect(config.query.length).toBe(200)
    expect(browseLoadedItems([{ key:'future', text:'Future', at:now+1 }], {...config, query:'', period:'30m'}, row=>row, now)).toEqual([])
  })
})
