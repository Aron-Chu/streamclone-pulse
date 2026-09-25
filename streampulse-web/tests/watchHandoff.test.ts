import { describe, expect, it } from 'vitest'
import { watchMomentHref } from '../src/lib/watchHandoff'
import type { CheckedMomentSource } from '../src/lib/discoveryMoments'

const moment = { login:'xqc', streamId:'321192454233' }
const source: CheckedMomentSource = { vodHref:'https://www.twitch.tv/videos/2864434763?t=5107s', vodOffsetSeconds:5107.5, liveHref:null,reason:'Checked' }
const local = 'http://127.0.0.1:5173'

describe('exact-source watch handoff', () => {
  it('carries aligned archive time and immutable stream, without a publish action', () => {
    const url = new URL(watchMomentHref(moment,source,'http://localhost:8090',local)!)
    expect(url.pathname).toBe('/c/xqc')
    expect(Object.fromEntries(url.searchParams)).toEqual({vod:'2864434763',offset:'5107',sid:'321192454233',from:'analytics'})
    expect(url.username).toBe('');expect(url.password).toBe('');expect(url.hash).toBe('')
  })
  it.each([360,5183,17058])('keeps the selected offset %s instead of the session lead', offset => {
    const seconds = Math.floor(offset-75.5)
    expect(watchMomentHref(moment,{...source,vodOffsetSeconds:offset-75.5,vodHref:`https://www.twitch.tv/videos/2864434763?t=${seconds}s`},'https://watch.example',local)).toContain(`offset=${seconds}&sid=321192454233`)
  })
  it('requires configuration and freshly checked source data', () => {
    expect(watchMomentHref(moment,source,'',local)).toBeNull()
    expect(watchMomentHref(moment,null,'http://localhost:8090',local)).toBeNull()
    for(const changed of [{vodHref:null},{vodOffsetSeconds:undefined},{vodOffsetSeconds:-1},{vodOffsetSeconds:NaN},{vodOffsetSeconds:Infinity}]) expect(watchMomentHref(moment,{...source,...changed},'http://localhost:8090',local)).toBeNull()
  })
  it.each(['http://localhost:8090','https://localhost:8090','http://127.0.0.1:8090','https://[::1]:8090'])('blocks loopback destination %s from a public page', target => {
    expect(watchMomentHref(moment,source,target,'https://streampulse.stream')).toBeNull()
  })
  it.each(['http://watch.example','http://localhost:8095','https://user:pass@watch.example','https://watch.example/path','https://watch.example?next=evil','https://watch.example#route','javascript:alert(1)'])('rejects unsafe or wrong-service origin %s', target => {
    expect(watchMomentHref(moment,source,target,local)).toBeNull()
  })
  it.each(['https://evil.example/videos/2864434763?t=5107s','https://www.twitch.tv/videos/2864434763?t=120s','https://www.twitch.tv/videos/2864434763?t=5107s&x=1','https://user@www.twitch.tv/videos/2864434763?t=5107s'])('rejects mismatched replay %s', vodHref => {
    expect(watchMomentHref(moment,{...source,vodHref},'http://localhost:8090',local)).toBeNull()
  })
  it('does not guess unsupported watch identity', () => {
    expect(watchMomentHref({...moment,streamId:'alias'},source,'http://localhost:8090',local)).toBeNull()
    expect(watchMomentHref({...moment,login:'xqc/other'},source,'http://localhost:8090',local)).toBeNull()
  })
})
