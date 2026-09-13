import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accountProxyCandidate } from './candidates/account-proxy.mjs'
import { assertEdgeFreeze } from './check-edge-freeze.mjs'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('candidate does not proxy broad API, webhook, native-device or admin routes', async () => {
 for (const path of ['/v1/public/hub', '/v1/admin/health', '/v1/billing/stripe/webhook', '/v1/account/device-links/poll', '/v1/account/me/extra', '/v1/account/%6de']) {
  const result = await accountProxyCandidate(new Request('https://streampulse.stream'+path), () => { throw new Error('unexpected proxy') })
  assert.equal(result.status,404)
 }
})
test('unapproved Pages worker blocks promotion under the edge freeze', t => {
 const root=mkdtempSync(join(tmpdir(),'pulse-edge-freeze-'))
 t.after(()=>rmSync(root,{recursive:true,force:true}))
 assert.doesNotThrow(()=>assertEdgeFreeze(root))
 mkdirSync(join(root,'public'))
 writeFileSync(join(root,'public','_worker.js'),'export default {}')
 assert.throws(() => assertEdgeFreeze(root), /EDGE_FREEZE_APPROVAL_REQUIRED/)
})
test('candidate preserves only account cookies/CSRF, returns no-store and never follows redirects', async () => {
 const cookies = ['__Host-pulse_account=a; Path=/; Secure; HttpOnly', '__Host-pulse_csrf=b; Path=/; Secure']
 const request = new Request('https://streampulse.stream/v1/account/auth/logout', {method:'POST', headers:{Origin:'https://streampulse.stream', 'Content-Type':'application/json', Cookie:'unrelated=secret; __Host-pulse_account=a; __Host-pulse_csrf=b', 'X-Pulse-CSRF':'b', Authorization:'Bearer private', 'X-Forwarded-For':'untrusted'}, body:'{}'})
 const result = await accountProxyCandidate(request, async remote => {
  assert.equal(remote.url,'https://api.streampulse.stream/v1/account/auth/logout')
  assert.equal(remote.redirect,'manual')
  assert.equal(remote.headers.get('authorization'),null)
  assert.equal(remote.headers.get('x-forwarded-for'),null)
  assert.equal(remote.headers.get('cookie'),'__Host-pulse_account=a; __Host-pulse_csrf=b')
  assert.equal(remote.headers.get('x-pulse-csrf'),'b')
  const headers = new Headers(); cookies.forEach(cookie => headers.append('Set-Cookie',cookie))
  return new Response(null,{status:204,headers})
 })
 assert.equal(result.headers.get('cache-control'),'private, no-store')
 assert.deepEqual(result.headers.getSetCookie(),cookies)
 assert.equal((await accountProxyCandidate(new Request('https://streampulse.stream/v1/account/me'), async () => new Response(null,{status:302,headers:{Location:'https://evil.invalid'}}))).status,502)
})
test('candidate rejects foreign origins, unknown queries, and oversized mutations', async () => {
 const noFetch=()=>{throw new Error('unexpected proxy')}
 assert.equal((await accountProxyCandidate(new Request('https://streampulse.stream/v1/billing/checkout',{method:'POST',headers:{Origin:'https://evil.invalid'}}),noFetch)).status,403)
 assert.equal((await accountProxyCandidate(new Request('https://streampulse.stream/v1/account/me?token=secret'),noFetch)).status,400)
 assert.equal((await accountProxyCandidate(new Request('https://streampulse.stream/v1/account/auth/start',{method:'POST',headers:{Origin:'https://streampulse.stream','Content-Type':'application/json'},body:'x'.repeat(4097)}),noFetch)).status,413)
})
