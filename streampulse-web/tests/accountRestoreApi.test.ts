import { afterEach, expect, it, vi } from 'vitest'
import { restoreRequest } from '../src/lib/accountApi'

afterEach(() => vi.unstubAllGlobals())
it('uses secret-only same-origin fixed POST routes, omitting ambient credentials and CSRF', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  document.cookie = '__Host-pulse_csrf=' + 'b'.repeat(64)
  await restoreRequest('/inspect', { secret: 'a'.repeat(64) })
  expect(fetch).toHaveBeenCalledWith('/v1/account/restores/inspect', expect.objectContaining({
    method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 'a'.repeat(64) }),
  }))
})
it('accepts empty approval and preserves exact restore status codes', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(new Response('{"error":"restore_conflict"}', { status: 409 }))
  vi.stubGlobal('fetch', fetch)
  await expect(restoreRequest('/approve', { secret: 'a'.repeat(64), confirmed: true })).resolves.toEqual({})
  await expect(restoreRequest('/approve', { secret: 'a'.repeat(64), confirmed: true })).rejects.toMatchObject({ status: 409, code: 'restore_conflict' })
})
it.each(['/inspect?next=evil', '/approve/extra', '/../auth/start', '/poll'])('rejects a nonallowlisted restore path %s', async path => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  await expect(restoreRequest(path as '/inspect', { secret: 'a'.repeat(64) })).rejects.toMatchObject({ status: 400 })
  expect(fetch).not.toHaveBeenCalled()
})
