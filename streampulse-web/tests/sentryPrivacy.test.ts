import { describe, expect, it } from 'vitest'
import type { ErrorEvent } from '@sentry/react'
import { scrubDiagnosticText, scrubPortalEvent } from '../src/lib/sentry'

describe('Sentry privacy boundary', () => {
  it('drops diagnostics on account restore and Checkout-return routes even after SPA navigation', () => {
    for (const path of ['/account/restore', '/supporter/thanks?attempt=private', '/account/sign-in']) {
      window.history.replaceState({}, '', path)
      expect(scrubPortalEvent({ type: undefined, message: 'Failed to fetch' })).toBeNull()
    }
    window.history.replaceState({}, '', '/')
  })
  it('names the page for events that arrive without a route tag', () => {
    for (const [path, route] of [['/feedback?ref=private', '/feedback'], ['/terms', '/terms'], ['/no-such-page', '/:unknown']]) {
      window.history.replaceState({}, '', path)
      const clean = scrubPortalEvent({ type: undefined, message: 'Failed to fetch' })!
      expect(clean.tags?.route, path).toBe(route)
      expect(clean.transaction, path).toBe(route)
    }
    window.history.replaceState({}, '', '/account/settings')
    expect(scrubPortalEvent({ type: undefined, message: 'Failed to fetch' })).toBeNull()
    window.history.replaceState({}, '', '/')
  })
  it('removes signed media URLs and credential assignments from diagnostic text', () => {
    const clean = scrubDiagnosticText('Failed https://media.example/secret-id.mp4?signature=private token=private Bearer private')
    expect(clean).not.toContain('private')
    expect(clean).not.toContain('secret-id')
    expect(clean).toBe('Diagnostic text omitted')
  })
  it('scrubs exception values, stack variables and URL queries, log entries and route tags', () => {
    // Deliberately includes unknown/future SDK fields: the boundary accepts a
    // runtime event, not merely the fields covered by today's TypeScript type.
    const event = {
      type: undefined,
      logger: 'private', modules: { private: 'private' }, debug_meta: { images: [{ type: 'private', code_file: 'private' }] },
      message: 'Request failed https://example/media?token=private',
      user: { email: 'private' }, request: { url: 'private' }, extra: { secret: 'private' },
      logentry: { message: 'private', params: ['private'] }, fingerprint: ['private'],
      breadcrumbs: [{ message: 'private' }], contexts: { custom: { secret: 'private' } },
      tags: { route: '/analytics/person/123?token=private', error_type: 'https://example/private', other: 'private' },
      exception: { values: [{ type: 'TypeError', value: 'signature=private',
        module: 'private', thread_id: 'private',
        raw_stacktrace: { frames: [{ vars: { token: 'private' }, context_line: 'private' }] },
        stacktrace: { frames: [{ filename: 'https://streampulse.stream/assets/main.js?token=private', lineno: 5, vars: { token: 'private' }, context_line: 'private' }] },
      }] },
    } as unknown as ErrorEvent
    const clean = scrubPortalEvent(event)!
    expect(JSON.stringify(clean)).not.toContain('private')
    expect(clean.exception?.values?.[0].stacktrace?.frames?.[0]).toMatchObject({ filename: 'assets/main.js', lineno: 5 })
    expect(clean.tags?.route).toBe('/analytics/:login/:streamId')
  })
  it('removes relative media queries and grant fields from every diagnostic text slot', () => {
    const value = 'Load /v1/source-previews/spv_x/media.mp4?grant=private.one ./media.mp4#private.two grant=private.three {"grant":"private.four"} access_token=private.five api_key=private.six code=private.seven'
    expect(scrubDiagnosticText(value)).not.toContain('private')
    const clean = scrubPortalEvent({ type: undefined, message: value, exception: { values: [{ value, stacktrace: { frames: [{ function: value }] } }] } })
    expect(JSON.stringify(clean)).not.toContain('private')
    expect(JSON.stringify(clean)).not.toContain('spv_x')
  })
  it('omits arbitrary provider text, credential aliases, headers and opaque secrets', () => {
    for (const value of ['client_secret=PRIVATE', '{"client_secret":"PRIVATE"}',
      'x-api-key=PRIVATE', 'refresh-token=PRIVATE', 'Authorization: Basic PRIVATE',
      'Cookie: session=PRIVATE; sid=PRIVATE', 'Set-Cookie: session=PRIVATE',
      'OAuth provider returned PRIVATE', 'PRIVATE']) {
      expect(scrubDiagnosticText(value)).toBe('Diagnostic text omitted')
      const clean = scrubPortalEvent({ type: undefined, message: value,
        exception: { values: [{ type: 'Error', value, stacktrace: { frames: [{ function: value,
          filename: 'https://streampulse.stream/assets/main.js', lineno: 12, colno: 3 }] } }] } })!
      expect(JSON.stringify(clean)).not.toContain('PRIVATE')
      expect(clean.exception?.values?.[0].stacktrace?.frames?.[0]).toEqual({ filename: 'assets/main.js', lineno: 12, colno: 3 })
    }
    expect(scrubDiagnosticText('Failed to fetch')).toBe('Failed to fetch')
    expect(scrubDiagnosticText('Failed to fetch PRIVATE')).toBe('Diagnostic text omitted')
  })
  it('preserves only source-map UUIDs paired with a surviving normalized asset frame', () => {
    const clean = scrubPortalEvent({
      exception: { values: [{ stacktrace: { frames: [{
        filename: 'https://streampulse.stream/assets/index-ABC123.js?token=private#private', lineno: 1, colno: 23,
      }] } }] },
      debug_meta: { private: 'private', images: [
        { type: 'sourcemap', code_file: 'https://streampulse.stream/assets/index-ABC123.js?token=private#private',
          debug_id: 'ABCDEF01-2345-4678-8ABC-DEF012345678', debug_file: 'private', extra: 'private' },
        { type: 'sourcemap', code_file: 'assets/index-ABC123.js', debug_id: 'abcdef01-2345-4678-8abc-def012345678' },
        { type: 'wasm', code_file: 'assets/index-ABC123.js', debug_id: 'abcdef01-2345-4678-8abc-def012345678' },
        { type: 'sourcemap', code_file: 'assets/not-in-stack.js', debug_id: 'abcdef01-2345-4678-8abc-def012345678' },
      ] },
    } as unknown as ErrorEvent)!
    expect(clean.debug_meta).toEqual({ images: [{
      type: 'sourcemap', code_file: 'assets/index-ABC123.js', debug_id: 'abcdef01-2345-4678-8abc-def012345678',
    }] })
    expect(clean.debug_meta?.images?.[0]?.code_file).toBe(clean.exception?.values?.[0]?.stacktrace?.frames?.[0]?.filename)
    expect(JSON.stringify(clean)).not.toContain('private')
    expect(JSON.stringify(clean)).not.toContain('https://')
  })
  it('rejects opaque IDs, invalid UUIDs, unmatched images and oversized asset references', () => {
    const frame = { filename: 'assets/main.js' }
    for (const debugId of ['private', 'abcdef01234546788abcdef012345678',
      'abcdef01-2345-4678-8abc-def012345678private', 'zzzzzzzz-2345-4678-8abc-def012345678']) {
      const clean = scrubPortalEvent({ type: undefined, exception: { values: [{ stacktrace: { frames: [frame] } }] },
        debug_meta: { images: [{ type: 'sourcemap', code_file: frame.filename, debug_id: debugId }] },
      })!
      expect(clean.debug_meta).toBeUndefined()
    }
    for (const filename of ['assets/' + 'a'.repeat(129) + '.js', 'assets/main.js?private=' + 'a'.repeat(2048),
      '/account/private', 'assets/../private.js']) {
      const clean = scrubPortalEvent({ type: undefined, exception: { values: [{ stacktrace: { frames: [{ filename }] } }] },
        debug_meta: { images: [{ type: 'sourcemap', code_file: filename, debug_id: 'abcdef01-2345-4678-8abc-def012345678' }] },
      })!
      expect(clean.debug_meta).toBeUndefined()
      expect(clean.exception?.values?.[0]?.stacktrace?.frames?.[0]?.filename).toBeUndefined()
    }
    expect(scrubPortalEvent({ type: undefined, debug_meta: { images: [] } })!.debug_meta).toBeUndefined()
  })
  it('bounds source-map metadata and drops images for stack frames removed by the frame limit', () => {
    const filenames = Array.from({ length: 51 }, (_, index) => `assets/chunk-${index}.js`)
    const clean = scrubPortalEvent({ type: undefined, exception: { values: [{ stacktrace: { frames: filenames.map(filename => ({ filename })) } }] },
      debug_meta: { images: filenames.map(code_file => ({ type: 'sourcemap', code_file, debug_id: 'abcdef01-2345-4678-8abc-def012345678' })) },
    })!
    expect(clean.debug_meta?.images).toHaveLength(49)
    expect(clean.debug_meta?.images?.some(image => image.code_file === 'assets/chunk-0.js')).toBe(false)
    expect(clean.debug_meta?.images?.some(image => image.code_file === 'assets/chunk-50.js')).toBe(false)
    const retainedFrames = clean.exception!.values![0]!.stacktrace!.frames!.map(frame => frame.filename)
    expect(clean.debug_meta?.images?.every(image => retainedFrames.includes(image.code_file))).toBe(true)
  })
})
