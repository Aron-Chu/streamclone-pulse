import { describe, expect, it } from 'vitest'
import type { DiscoveryMoment } from '../src/lib/discoveryMoments'
import { MOMENTS_MIN_X, MOMENTS_START_SECONDS, momentLiftLine, momentsGameName, momentsGames, shownOnMomentsPage } from '../src/lib/momentsPage'

type Metric = NonNullable<NonNullable<DiscoveryMoment['comparison']>['chat']>
const ready = (multiplier: number) => ({ state: 'ready', multiplier }) as unknown as Metric
const comparison = (chat?: Metric, emotes?: Metric) => ({ chat, emotes }) as unknown as DiscoveryMoment['comparison']
const art = (id: string) => `https://static-cdn.jtvnw.net/ttv-boxart/${id}-144x192.jpg`

describe('Moments page Latest rows', () => {
  it('leaves out a stream’s first 5 minutes', () => {
    expect(MOMENTS_START_SECONDS).toBe(300)
    expect(shownOnMomentsPage({ offsetSeconds: 299, comparison: comparison(ready(4)) })).toBe(false)
    expect(shownOnMomentsPage({ offsetSeconds: 300, comparison: comparison(ready(4)) })).toBe(true)
  })

  it('leaves out a minute under 1.2× on both chat and emotes', () => {
    expect(MOMENTS_MIN_X).toBe(1.2)
    expect(shownOnMomentsPage({ offsetSeconds: 900, comparison: comparison(ready(0.93), ready(0.41)) })).toBe(false)
    expect(shownOnMomentsPage({ offsetSeconds: 900, comparison: comparison(ready(1.07), ready(1.19)) })).toBe(false)
    expect(shownOnMomentsPage({ offsetSeconds: 900, comparison: comparison(ready(0.5), ready(1.2)) })).toBe(true)
  })

  it('keeps a row with nothing to judge it by, and one new from a zero average', () => {
    expect(shownOnMomentsPage({ offsetSeconds: 900, comparison: undefined })).toBe(true)
    expect(shownOnMomentsPage({ offsetSeconds: 900, comparison: comparison({ state: 'new_activity' } as unknown as Metric) })).toBe(true)
  })
})

describe('the open moment’s × line', () => {
  it('reads the detector’s own signal first', () => {
    expect(momentLiftLine({ reactionSignal: 'emotes', comparison: comparison(ready(2), ready(3.74)) })).toEqual({ x: '3.7×', what: 'emotes' })
    expect(momentLiftLine({ reactionSignal: 'chat', comparison: comparison(ready(2), ready(3.74)) })).toEqual({ x: '2.0×', what: 'chat' })
  })

  it('falls back to the other signal that rose, and rounds ten and over', () => {
    expect(momentLiftLine({ reactionSignal: 'emotes', comparison: comparison(ready(12.4), ready(0.8)) })).toEqual({ x: '12×', what: 'chat' })
    expect(momentLiftLine({ reactionSignal: 'chat', comparison: comparison(ready(9.97), undefined) })).toEqual({ x: '10×', what: 'chat' })
    expect(momentLiftLine({ reactionSignal: 'chat', comparison: comparison(ready(9.9), undefined) })).toEqual({ x: '9.9×', what: 'chat' })
  })

  it('says nothing when neither rose', () => {
    expect(momentLiftLine({ reactionSignal: 'chat', comparison: comparison(ready(0.9), ready(0.4)) })).toBeNull()
    expect(momentLiftLine({ reactionSignal: 'chat', comparison: undefined })).toBeNull()
    // a rise that rounds to 1.0× is not "more"
    expect(momentLiftLine({ reactionSignal: 'chat', comparison: comparison(ready(1.04), ready(1.02)) })).toBeNull()
    expect(momentLiftLine({ reactionSignal: 'chat', comparison: comparison(ready(1.05), undefined) })).toEqual({ x: '1.1×', what: 'chat' })
  })
})

describe('the games row', () => {
  const rows = [
    { category: 'Just Chatting', categoryId: '509658', boxArtUrl: art('509658') },
    { category: 'Minecraft', categoryId: '27471', boxArtUrl: art('27471') },
    { category: 'Minecraft', categoryId: '27471', boxArtUrl: art('27471') },
    { category: 'Apex', categoryId: '511224', boxArtUrl: 'https://evil.test/ttv-boxart/511224-144x192.jpg' },
  ] as DiscoveryMoment[]

  it('lists games busiest first, then by name, with sharp exact covers only', () => {
    const games = momentsGames(rows)
    expect(games.map(game => [game.name, game.moments])).toEqual([['Minecraft', 2], ['Apex', 1], ['Just Chatting', 1]])
    expect(games[0].art).toBe('https://static-cdn.jtvnw.net/ttv-boxart/27471-285x380.jpg')
    expect(games.find(game => game.name === 'Apex')?.art).toBeNull()
  })

  it('names a game from the hub’s id link', () => {
    expect(momentsGameName('27471', rows)).toBe('Minecraft')
    expect(momentsGameName('1', rows)).toBeNull()
  })
})
