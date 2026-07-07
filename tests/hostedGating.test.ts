import { describe, expect, it } from 'vitest'
import { isHostedBackendUrl } from '../src/shared/storage.ts'

describe('hosted backend gating', () => {
  it('detects hosted API URL', () => {
    expect(isHostedBackendUrl('https://api.streampulse.stream')).toBe(true)
    expect(isHostedBackendUrl('http://localhost:8090')).toBe(false)
    expect(isHostedBackendUrl('http://127.0.0.1:8090')).toBe(false)
  })
})
