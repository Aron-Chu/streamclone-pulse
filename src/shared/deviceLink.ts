/**
 * The invited-tester device link: a one-time code, approved on
 * streampulse.stream, that connects this extension to a StreamPulse account
 * (`/v1/account/device-links`).
 *
 * Chrome, Edge and development builds keep it. Firefox builds leave it out
 * (owner decision D20 for 0.2.2): the Firefox manifest declares only
 * `browsingActivity` data collection, and a linked account would send more
 * than that. The switch is fixed at build time from `__EXTENSION_TARGET__`, so
 * the Firefox bundles hold none of the link's screens or requests, not just a
 * hidden button. `scripts/validate-extension-package.mjs` checks the packaged
 * files of every store target.
 */
export const DEVICE_LINK_ENABLED: boolean =
  (typeof __EXTENSION_TARGET__ === 'undefined' ? 'development' : __EXTENSION_TARGET__) !== 'firefox'
