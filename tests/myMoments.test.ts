import { describe, expect, it } from 'vitest'
import { parseBackgroundRequest } from '../src/shared/parseBackgroundRequest.ts'
import { isSenderAuthorizedForMessage } from '../src/background/pulseBroadcastTargets.ts'
import { emptyPersonalData, prunePersonalData, recordWatched } from '../src/background/myMomentsStore.ts'
import { watchedProgress } from '../src/content/momentPlayback.ts'

const reference = { id:'moment',channel:'streamer',title:'Moment',vodId:'12345678',offsetSeconds:100,availability:'unresolved' as const }
describe('My Moments trust and capture', () => {
  it('validates narrow commands and rejects short evidence, fields and source injection', () => {
    expect(parseBackgroundRequest({type:'MY_MOMENTS',action:'load'})).toBeTruthy()
    expect(parseBackgroundRequest({type:'MY_MOMENTS',action:'load',scope:'leak'})).toBeNull()
    const event = {type:'MOMENT_CAPTURE',action:'record',epoch:1,reference,watchedSeconds:10}
    expect(parseBackgroundRequest(event)).toBeTruthy()
    expect(parseBackgroundRequest({...event,watchedSeconds:9})).toBeNull()
    expect(parseBackgroundRequest({...event,reference:{...reference,vodId:'javascript:alert(1)'}})).toBeNull()
    expect(parseBackgroundRequest({...event,reference:{...reference,secret:'extra'}})).toBeNull()
  })
  it('keeps cross-channel private data out of Twitch senders', () => {
    const sender = {id:'ext',url:'https://www.twitch.tv/streamer',frameId:0,tab:{id:1,url:'https://www.twitch.tv/streamer'}}
    expect(isSenderAuthorizedForMessage('MY_MOMENTS',undefined,sender,'ext')).toBe(false)
    expect(isSenderAuthorizedForMessage('MOMENT_CAPTURE',undefined,sender,'ext')).toBe(true)
  })
  it('requires ten seconds of genuine advancement and stops on source/window changes', () => {
    const progress = watchedProgress(100,130,'video')
    for(let i=0;i<10;i++)expect(progress({time:100+i,clock:i*1000,source:'video',active:true})).toBe('pending')
    expect(progress({time:110,clock:10000,source:'video',active:true})).toBe('watched')
    expect(watchedProgress(100,130,'video')({time:110,clock:1,source:'other',active:true})).toBe('stop')
    expect(watchedProgress(100,130,'video')({time:131,clock:1,source:'video',active:true})).toBe('stop')
  })
  it('excludes paused, buffering, hidden, seek jumps and suspended timer gaps', () => {
    const progress = watchedProgress(0,120,'video')
    expect(progress({time:0,clock:0,source:'video',active:true})).toBe('pending')
    expect(progress({time:60,clock:1000,source:'video',active:true})).toBe('pending')
    for(let i=2;i<15;i++)expect(progress({time:60+i,clock:i*1000,source:'video',active:false})).toBe('pending')
    expect(progress({time:90,clock:40000,source:'video',active:true})).toBe('pending')
  })
  it('defaults off, rejects stale consent, deduplicates and expires only history', () => {
    const initial = {...emptyPersonalData(),notes:{bookmark:'keep me'}}
    const m = {...reference,note:''}
    expect(recordWatched(initial,m,0,1000).history).toHaveLength(0)
    const on = {...initial,preferences:{captureHistory:true,retentionDays:7 as const},epoch:2}
    expect(recordWatched(on,m,1,1000).history).toHaveLength(0)
    const one = recordWatched(recordWatched(on,m,2,1000),m,2,2000)
    expect(one.history).toHaveLength(1)
    expect(prunePersonalData(one,8*86400000)).toMatchObject({history:[],notes:{bookmark:'keep me'}})
  })
})
