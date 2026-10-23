import { afterEach, expect, it, vi } from 'vitest'
import { createMyMomentsRepository } from '../src/options/MyMomentsPage.tsx'
afterEach(() => vi.unstubAllGlobals())
it('strips row enrichment from saves and labels complete exports without leaking scope', async () => {
  const snapshot={production:true,scope:'private-principal',bookmarksState:'ready',bookmarksAvailable:true,moments:[],localNotes:{orphan:'Keep my note'}}
  const sendMessage=vi.fn(async()=>({type:'MY_MOMENTS',snapshot}))
  vi.stubGlobal('chrome',{runtime:{sendMessage}})
  const repository=createMyMomentsRepository(), signal=new AbortController().signal
  await repository.load(signal)
  const row={id:'moment',channel:'fixturechan',title:'Moment',vodId:'12345678',offsetSeconds:100,availability:'unresolved' as const,note:'private enrichment',jumpedAt:123}
  await repository.execute({kind:'save',reference:row},signal)
  const request=sendMessage.mock.calls.at(-1) as unknown as [{command:{reference:Record<string,unknown>}}]
  expect(request[0].command.reference).not.toHaveProperty('note')
  expect(request[0].command.reference).not.toHaveProperty('jumpedAt')
  const exported=await repository.export(signal)
  expect(exported).not.toContain('private-principal')
  expect(exported).toContain('Keep my note')
  expect(exported).toContain('"exportScope": "complete"')
  expect(exported).toContain('"cloudBookmarks": "included"')
})
it('exports local records when the cloud bookmark service is unavailable', async () => {
  const snapshot={production:true,scope:'private-principal',bookmarksState:'not_linked',bookmarksAvailable:false,moments:[],localNotes:{local:'Keep this note'}}
  const sendMessage=vi.fn(async()=>({type:'MY_MOMENTS',snapshot}))
  vi.stubGlobal('chrome',{runtime:{sendMessage}})
  const repository=createMyMomentsRepository(), signal=new AbortController().signal
  const exported=await repository.export(signal)
  expect(exported).toContain('"exportScope": "device-local"')
  expect(exported).toContain('"cloudBookmarks": "not-included"')
  expect(exported).toContain('Keep this note')
})
it('does not report a successful mutation when the worker fails', async()=>{
  const sendMessage=vi.fn().mockResolvedValueOnce({type:'MY_MOMENTS',snapshot:{production:true,scope:'one'}}).mockResolvedValue({error:'storage failure'})
  vi.stubGlobal('chrome',{runtime:{sendMessage}})
  const repository=createMyMomentsRepository(), signal=new AbortController().signal
  await repository.load(signal)
  await expect(repository.execute({kind:'clear-history'},signal)).rejects.toThrow('Could not load or save')
})
it('hears the worker say My Moments changed, and nothing a Twitch tab sends', ()=>{
  const listeners=new Set<(message:unknown,sender:{tab?:unknown})=>void>()
  vi.stubGlobal('chrome',{runtime:{sendMessage:vi.fn(),onMessage:{addListener:(f:never)=>listeners.add(f),removeListener:(f:never)=>listeners.delete(f)}}})
  const onChange=vi.fn()
  const unsubscribe=createMyMomentsRepository().subscribe!(onChange)
  const send=(message:unknown,sender:{tab?:unknown}={})=>{ for(const listener of listeners) listener(message,sender) }
  send({type:'MY_MOMENTS_CHANGED'},{tab:{id:1}})
  send({type:'MY_MOMENTS'})
  send(null)
  expect(onChange).not.toHaveBeenCalled()
  send({type:'MY_MOMENTS_CHANGED'})
  expect(onChange).toHaveBeenCalledTimes(1)
  unsubscribe()
  expect(listeners.size).toBe(0)
})
