import { describe, expect, it } from 'vitest'
import {
  buildCopyConfig,
  detectMixedContent,
  serializeCopyConfig,
} from '../src/lib/health'

describe('health helpers', () => {
  it('builds copy-config JSON matching extension schema', () => {
    const payload = buildCopyConfig({
      backendUrl: 'https://api.streampulse.stream',
      betaKey: 'PULSE-TEST-KEY-0001',
    })
    expect(payload).toEqual({
      backendUrl: 'https://api.streampulse.stream',
      betaKey: 'PULSE-TEST-KEY-0001',
      pollIntervalMs: 30_000,
    })
    expect(JSON.parse(serializeCopyConfig(payload))).toEqual(payload)
  })

  it('detects mixed-content backend URLs', () => {
    expect(detectMixedContent('http://api.example.com')).toBe(true)
    expect(detectMixedContent('http://localhost:8081')).toBe(false)
    expect(detectMixedContent('https://api.streampulse.stream')).toBe(false)
  })
})
