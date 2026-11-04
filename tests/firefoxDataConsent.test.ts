import { describe, expect, it, vi } from 'vitest'
import {
  hasFirefoxTechnicalDataConsent,
  readFirefoxTechnicalDataConsent,
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

  it('distinguishes a permission read error while still denying collection', async () => {
    const permissions = { getAll: vi.fn(async () => { throw new Error('permission read failed') }) }
    expect(await readFirefoxTechnicalDataConsent({ target: 'firefox', permissions })).toBe('unavailable')
    expect(await hasFirefoxTechnicalDataConsent({ target: 'firefox', permissions })).toBe(false)
  })

  it('requests permission synchronously in the user action before any asynchronous lookup', async () => {
    const permissions = {
      getAll: vi.fn(async () => ({ data_collection: [] })),
      request: vi.fn(async () => true),
    }
    const result = requestFirefoxTechnicalDataConsent({ target: 'firefox', permissions })
    expect(permissions.request).toHaveBeenCalledWith({ data_collection: ['technicalAndInteraction'] })
    expect(permissions.getAll).not.toHaveBeenCalled()
    await expect(result).resolves.toBe(true)
  })

  it('recognizes and requests technicalAndInteraction only', async () => {
    const permissions = {
      getAll: vi.fn(async () => ({ data_collection: ['technicalAndInteraction'] })),
      request: vi.fn(async () => true),
    }
    expect(await requestFirefoxTechnicalDataConsent({ target: 'firefox', permissions })).toBe(true)
    expect(permissions.request).toHaveBeenCalledWith({
      data_collection: ['technicalAndInteraction'],
    })
    expect(await hasFirefoxTechnicalDataConsent({ target: 'firefox', permissions })).toBe(true)
  })

  it('fails closed when a Firefox permission request rejects', async () => {
    const permissions = {
      getAll: vi.fn(async () => ({ data_collection: [] })),
      request: vi.fn(async () => { throw new Error('request denied') }),
    }
    expect(await requestFirefoxTechnicalDataConsent({ target: 'firefox', permissions })).toBe(false)
  })
})
