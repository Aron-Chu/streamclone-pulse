/**
 * Loopback hostnames a development build may talk to: the local BFF, the
 * portal dev server and local emote images. Store builds compile the list to
 * empty, so none of these values ships in a store bundle; the package gate
 * (scripts/validate-extension-package.mjs) fails a store build that still
 * carries one, written plainly or encoded.
 */
export const DEV_LOOPBACK_HOSTNAMES: readonly string[] =
  typeof __EXTENSION_STORE_BUILD__ !== 'undefined' && __EXTENSION_STORE_BUILD__
    ? []
    : ['localhost', '127.0.0.1', '::1']

/** True for a development loopback hostname (URL.hostname form, IPv6 brackets allowed). */
export function isDevLoopbackHostname(hostname: string): boolean {
  return DEV_LOOPBACK_HOSTNAMES.includes(hostname.replace(/^\[|\]$/g, '').toLowerCase())
}
