// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { observeMomentPlayback } from '../src/content/momentPlayback.ts'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren() })
it('observes advancing media before recording and stops after a source change', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
  const sendMessage = vi.fn(async (m: {action: string}) => m.action === 'status' ? { enabled: true, epoch: 42 } : { ok: true })
  vi.stubGlobal('chrome', { runtime: { sendMessage } })
  Object.defineProperty(document, 'hidden', { configurable:true, value:false })
  const video = document.createElement('video')
  document.body.append(video)
  let time=100, paused=true, source='blob:fixture'
  Object.defineProperties(video, { currentSrc:{ configurable:true,get:()=>source }, currentTime:{ configurable:true,get:()=>time },
    paused:{ configurable:true,get:()=>paused }, seeking:{ configurable:true,value:false }, readyState:{ configurable:true,value:4 } })
  const reference={id:'moment',channel:'fixturechan',vodId:'2806037629',offsetSeconds:100,title:'Moment',availability:'unresolved' as const}
  await observeMomentPlayback(video,reference,100,130)
  await vi.advanceTimersByTimeAsync(1500)
  expect(sendMessage.mock.calls.filter(([m])=>m.action==='record')).toHaveLength(0)
  paused=false
  for(let i=0;i<22;i++) { time+=.5; await vi.advanceTimersByTimeAsync(500) }
  expect(sendMessage).toHaveBeenLastCalledWith({type:'MOMENT_CAPTURE',action:'record',epoch:42,reference,watchedSeconds:10})
  const recorded=sendMessage.mock.calls.filter(([m])=>m.action==='record').length
  await observeMomentPlayback(video,reference,100,130)
  source='blob:replacement'
  await vi.advanceTimersByTimeAsync(15000)
  expect(sendMessage.mock.calls.filter(([m])=>m.action==='record')).toHaveLength(recorded)
})
it('does not sample media when capture is disabled', async () => {
  const sendMessage=vi.fn(async()=>({enabled:false,epoch:0}))
  vi.stubGlobal('chrome',{runtime:{sendMessage}})
  const video=document.createElement('video')
  Object.defineProperty(video,'currentSrc',{value:'blob:fixture'})
  await observeMomentPlayback(video,{id:'m',channel:'fixturechan',title:'Moment',vodId:'2806037629',offsetSeconds:0,availability:'unresolved'},0,60)
  expect(sendMessage).toHaveBeenCalledTimes(1)
})
