import { describe, expect, it, vi } from 'vitest'
import {
  hasFirefoxTechnicalDataConsent,
  requestFirefoxTechnicalDataConsent,
} from '../src/shared/firefoxDataConsent'

describe('Firefox built-in technical data consent', () => {
  it('is a no-op for non-Firefox packages', async () => {
    expect(await hasFirefoxTechnicalDataConsent({ target: 'edge', permissions: null })).toBe(true)
    expect(await requestFirefoxTechnicalDataConsent({ target: 'cws', permissions: null })).toBe(true)
  })

  it('fails closed when Firefox permission is absent', async () => {
    const permissions = {
      getAll: vi.fn(async () => ({ data_collection: [] })),
      request: vi.fn(async () => false),
    }
    expect(await hasFirefoxTechnicalDataConsent({ target: 'firefox', permissions })).toBe(false)
    expect(await requestFirefoxTechnicalDataConsent({ target: 'firefox', permissions })).toBe(false)
  })

  it('recognizes and requests technicalAndInteraction only', async () => {
    const permissions = {
      getAll: vi
        .fn()
        .mockResolvedValueOnce({ data_collection: [] })
        .mockResolvedValueOnce({ data_collection: ['technicalAndInteraction'] }),
      request: vi.fn(async () => true),
    }
    expect(await requestFirefoxTechnicalDataConsent({ target: 'firefox', permissions })).toBe(true)
    expect(permissions.request).toHaveBeenCalledWith({
      data_collection: ['technicalAndInteraction'],
    })
    expect(await hasFirefoxTechnicalDataConsent({ target: 'firefox', permissions })).toBe(true)
  })
})
