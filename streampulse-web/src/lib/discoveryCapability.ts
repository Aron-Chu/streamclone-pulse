/**
 * Stored history depends on a separately deployed projection and public API.
 * Gate data reads, not discovery of the availability page. A running portal
 * or Docker Desktop does not prove a populated history projection exists.
 */
export function discoveryCatalogueEnabled(configured = import.meta.env.VITE_DISCOVERY_CATALOGUE_ENABLED): boolean {
  if (typeof window !== 'undefined' && (window as unknown as { __DISCOVERY_CATALOGUE_ENABLED__?: boolean }).__DISCOVERY_CATALOGUE_ENABLED__ !== undefined) {
    return Boolean((window as unknown as { __DISCOVERY_CATALOGUE_ENABLED__?: boolean }).__DISCOVERY_CATALOGUE_ENABLED__)
  }
  return configured === '1' || configured === 'true'
}
