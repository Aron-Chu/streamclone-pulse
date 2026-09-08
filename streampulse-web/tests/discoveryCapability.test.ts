import { afterEach, describe, expect, it } from 'vitest'
import { discoveryCatalogueEnabled } from '../src/lib/discoveryCapability'

afterEach(() => {
  delete (window as unknown as { __DISCOVERY_CATALOGUE_ENABLED__?: boolean }).__DISCOVERY_CATALOGUE_ENABLED__
})

describe('discoveryCatalogueEnabled', () => {
  it('stays disabled without an explicit deployment capability', () => {
    expect(discoveryCatalogueEnabled(undefined)).toBe(false)
    expect(discoveryCatalogueEnabled('false')).toBe(false)
  })

  it('accepts only configured or explicit test capability flags', () => {
    expect(discoveryCatalogueEnabled('true')).toBe(true)
    ;(window as unknown as { __DISCOVERY_CATALOGUE_ENABLED__?: boolean }).__DISCOVERY_CATALOGUE_ENABLED__ = false
    expect(discoveryCatalogueEnabled('true')).toBe(false)
    ;(window as unknown as { __DISCOVERY_CATALOGUE_ENABLED__?: boolean }).__DISCOVERY_CATALOGUE_ENABLED__ = true
    expect(discoveryCatalogueEnabled('false')).toBe(true)
  })
})
