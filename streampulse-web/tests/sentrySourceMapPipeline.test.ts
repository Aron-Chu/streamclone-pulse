import { BrowserClient, Scope, type Envelope, type ErrorEvent } from '@sentry/react'
import { describe, expect, it, vi } from 'vitest'
import { scrubPortalEvent } from '../src/lib/sentry'

describe('Sentry source-map event pipeline', () => {
  it('keeps SDK-enriched Debug IDs through beforeSend into the fake transport envelope', async () => {
    const filename = 'https://streampulse.stream/assets/index-PIPELINE.js'
    const debugId = '11111111-2222-4333-8444-555555555555'
    vi.stubGlobal('_sentryDebugIds', { 'source-map pipeline injection fixture': debugId })
    const envelopes: Envelope[] = []
    const beforeSend = vi.fn(scrubPortalEvent)
    const client = new BrowserClient({
      dsn: 'https://public@example.invalid/1',
      defaultIntegrations: false,
      integrations: [],
      stackParser: () => [{ filename, lineno: 1, colno: 20 }],
      beforeSend,
      transport: () => ({
        send: async envelope => { envelopes.push(envelope); return { statusCode: 200 } },
        flush: async () => true,
      }),
    })
    try {
      client.captureEvent({
        level: 'info',
        user: { email: 'private' }, request: { headers: { Cookie: 'private' } },
        exception: { values: [{ type: 'Error', value: 'private fixture message',
          mechanism: { type: 'generic', handled: true },
          stacktrace: { frames: [{ filename, lineno: 1, colno: 20, in_app: true }] },
        }] },
      }, {}, new Scope())
      expect(await client.flush(1000)).toBe(true)
      expect(beforeSend).toHaveBeenCalledOnce()
      expect(beforeSend.mock.calls[0]![0].debug_meta?.images).toEqual([
        { type: 'sourcemap', code_file: filename, debug_id: debugId },
      ])
      expect(envelopes).toHaveLength(1)
      const event = envelopes[0]![1].find(([header]) => header.type === 'event')?.[1] as ErrorEvent
      expect(event.debug_meta).toEqual({ images: [
        { type: 'sourcemap', code_file: 'assets/index-PIPELINE.js', debug_id: debugId },
      ] })
      expect(event.exception?.values?.[0]?.stacktrace?.frames?.[0]?.filename).toBe('assets/index-PIPELINE.js')
      expect(JSON.stringify(event)).not.toContain('private')
      expect(JSON.stringify(event)).not.toContain('https://')
    } finally {
      await client.close()
      vi.unstubAllGlobals()
    }
  })
})
