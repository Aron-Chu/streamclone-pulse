import { describe, expect, it } from 'vitest'
import type { DiscoveryMoment } from '../src/lib/discoveryMoments'
import { momentStreamCards, momentStreams } from '../src/lib/momentStreamCards'

type Item = Pick<DiscoveryMoment, 'key' | 'login' | 'streamId' | 'at' | 'chatPerMin' | 'comparison'>
const item = (key: string, login: string, streamId: string, extra: Partial<Item> = {}): Item => ({ key, login, streamId, ...extra })
/** A comparison where one metric rose by `multiplier` (Infinity: new from a zero average). */
const rose = (metric: 'chat' | 'emotes', multiplier: number) => ({
  [metric]: multiplier === Infinity ? { state: 'new_activity' } : { state: 'ready', multiplier },
}) as unknown as DiscoveryMoment['comparison']

describe('moment stream cards', () => {
  it('groups moments by channel and broadcast, keeping the order the list first names each stream in', () => {
    const streams = momentStreams([
      item('a1', 'alpha', 's1'),
      item('b1', 'beta', 's9'),
      item('a2', 'alpha', 's1'),
      item('a3', 'alpha', 's2'),
    ])
    expect(streams.map(stream => stream.key)).toEqual(['alpha|s1', 'beta|s9', 'alpha|s2'])
    expect(streams[0]!.others.map(moment => moment.key)).toEqual(['a2'])
    expect(streams[1]!.others).toEqual([])
  })

  it('leads each stream with its strongest moment: the best rise, then the busier chat, then the newer minute', () => {
    const [byLift] = momentStreams([
      item('weak', 'alpha', 's1', { comparison: rose('chat', 2) }),
      item('strong', 'alpha', 's1', { comparison: rose('emotes', 9) }),
      item('mid', 'alpha', 's1', { comparison: rose('chat', 4) }),
    ])
    expect(byLift!.lead.key).toBe('strong')
    // The others keep the list's order.
    expect(byLift!.others.map(moment => moment.key)).toEqual(['weak', 'mid'])

    const [byChat] = momentStreams([item('quiet', 'alpha', 's1', { chatPerMin: 90 }), item('busy', 'alpha', 's1', { chatPerMin: 400 })])
    expect(byChat!.lead.key).toBe('busy')

    const [byTime] = momentStreams([item('older', 'alpha', 's1', { at: 1_000 }), item('newer', 'alpha', 's1', { at: 2_000 })])
    expect(byTime!.lead.key).toBe('newer')
  })

  it('treats two rises from a zero average as equally strong, so chat decides', () => {
    const [stream] = momentStreams([
      item('first', 'alpha', 's1', { comparison: rose('emotes', Infinity), chatPerMin: 50 }),
      item('second', 'alpha', 's1', { comparison: rose('emotes', Infinity), chatPerMin: 300 }),
    ])
    expect(stream!.lead.key).toBe('second')
  })

  it('shows the lead alone until the stream is opened, and always keeps an open moment its card', () => {
    const [stream] = momentStreams([item('lead', 'alpha', 's1', { chatPerMin: 500 }), item('x', 'alpha', 's1'), item('y', 'alpha', 's1')])
    const keys = (cards: { key: string }[]) => cards.map(card => card.key)
    expect(keys(momentStreamCards(stream!, false, null))).toEqual(['lead'])
    expect(keys(momentStreamCards(stream!, true, null))).toEqual(['lead', 'x', 'y'])
    expect(keys(momentStreamCards(stream!, false, 'y'))).toEqual(['lead', 'y'])
    expect(keys(momentStreamCards(stream!, false, 'lead'))).toEqual(['lead'])
    expect(keys(momentStreamCards(stream!, false, 'elsewhere'))).toEqual(['lead'])
  })
})
