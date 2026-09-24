import { describe, expect, it } from 'vitest'
import type { ErrorEvent } from '@sentry/react'
import { scrubDiagnosticText, scrubPortalEvent } from '../src/lib/sentry'

describe('Sentry privacy boundary', () => {
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
})
