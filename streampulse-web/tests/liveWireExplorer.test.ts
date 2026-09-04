import { describe, expect, it } from 'vitest'
import { buildLiveWireExplorerView } from '../src/lib/liveWireExplorer'

const moments = [
  { login: 'alpha', streamId: 's1', category: 'Just Chatting', kind: 'chat_spike', at: 100, score: 72 },
  { login: 'beta', streamId: 's2', category: 'Minecraft', kind: 'emote_spike', at: 300, score: 68 },
  { login: 'gamma', streamId: 's3', category: 'Minecraft', kind: 'chat_spike', at: 200, score: 91 },
  { login: 'delta', streamId: 's4', category: '', kind: 'emote_spike', at: 400, score: 40 },
]

describe('buildLiveWireExplorerView', () => {
  it('sorts newest and strongest without calculating a replacement score', () => {
    expect(buildLiveWireExplorerView(moments, { sort: 'newest' }).moments.map((moment) => moment.login))
      .toEqual(['delta', 'beta', 'gamma', 'alpha'])
    expect(buildLiveWireExplorerView(moments, { sort: 'strongest' }).moments.map((moment) => moment.login))
      .toEqual(['gamma', 'alpha', 'beta', 'delta'])
  })

  it('ranks category groups from their strongest and freshest loaded moments', () => {
    const view = buildLiveWireExplorerView(moments, { sort: 'category' })
    expect(view.categories.map((category) => category.label)).toEqual([
      'Minecraft',
      'Just Chatting',
      'Uncategorized',
    ])
    expect(view.categories[0]).toMatchObject({ momentCount: 2, channelCount: 2, peakScore: 91, latestAt: 300 })
    expect(view.moments.map((moment) => moment.login)).toEqual(['beta', 'gamma', 'alpha', 'delta'])
  })

  it('filters signal and category while keeping facets based on the signal-matched snapshot', () => {
    const view = buildLiveWireExplorerView(moments, {
      signal: 'chat',
      category: 'minecraft',
    })
    expect(view.moments.map((moment) => moment.login)).toEqual(['gamma'])
    expect(view.categories.map((category) => category.label)).toEqual(['Minecraft', 'Just Chatting'])
    expect(view.channelCount).toBe(1)
  })
})
