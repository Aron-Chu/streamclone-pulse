import { describe, expect, it } from 'vitest'
import { supporterAccess, type SupporterAccessSnapshot } from '../src/shared/supporterAccess.ts'
const scope = { accountId: 'owner', environment: 'sandbox' as const }
const snapshot: SupporterAccessSnapshot = { ...scope, schemaVersion:1, revision:1, status:'active', serverTime:'2026-09-05T00:00:00Z', accessFrom:'2026-09-04T00:00:00Z', accessUntil:'2026-10-04T00:00:00Z', cacheUntil:'2026-09-06T00:00:00Z', features:{'supporter.finish.v1':true} }
const check = (raw:unknown=snapshot, elapsed=0, released=true) => supporterAccess(raw,scope,'supporter.finish.v1',elapsed,released)
describe('Supporter presentation gate',()=>{
  it('permits explicitly released active and grace snapshots',()=>{ expect(check()).toBe('allowed'); expect(check({...snapshot,status:'grace'})).toBe('allowed') })
  it('denies other accounts and environments',()=>{ expect(check({...snapshot,accountId:'other'})).toBe('wrong-account'); expect(check({...snapshot,environment:'live'})).toBe('wrong-account') })
  it('denies at the cache boundary and at paid-through',()=>{ expect(check(snapshot,86_400_000)).toBe('expired'); expect(check({...snapshot,accessUntil:snapshot.cacheUntil},86_400_000)).toBe('expired') })
  it('rejects malformed data, future intervals and extended caches',()=>{
    for (const raw of [null,{}, {...snapshot,revision:0},{...snapshot,serverTime:'bad'},{...snapshot,cacheUntil:'2026-09-07T00:00:00Z'},{...snapshot,accessFrom:'2026-09-07T00:00:00Z'},{...snapshot,accessUntil:'2026-09-05T12:00:00Z'}]) expect(check(raw)).not.toBe('allowed')
  })
  it('rejects clock discontinuity and unknown states',()=>{ expect(check(snapshot,-1)).toBe('unavailable'); expect(check(snapshot,NaN)).toBe('unavailable'); for(const status of ['expired','pending','review','trialing']) expect(check({...snapshot,status})).toBe('unavailable') })
  it('requires literal grants and independent release flags',()=>{ expect(check(snapshot,0,false)).toBe('disabled'); expect(check({...snapshot,features:{}})).toBe('disabled'); expect(check({...snapshot,features:{'supporter.finish.v1':'true'}})).toBe('disabled') })
})
