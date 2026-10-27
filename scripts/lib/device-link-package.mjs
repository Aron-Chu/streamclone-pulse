/**
 * Packaging check for the invited-tester device link (src/shared/deviceLink.ts).
 *
 * Firefox builds compile the link out (owner decision D20 for 0.2.2), because
 * the Firefox manifest declares no website content or activity collection,
 * which a linked account's synced bookmarks and history would need.
 * Chrome, Edge and development builds keep it. The check reads the packaged
 * JavaScript, so it proves what ships, not what the source intends.
 */

/** Strings only the device link uses: what each build must keep. */
export const DEVICE_LINK_REQUIRED = [
  // The worker's link request; the approval poll is the same path plus /poll.
  '/v1/account/device-links',
  // The streampulse.stream page the code is approved on.
  '/account/link-device',
]

/** Strings a build without the device link must not contain at all. */
export const DEVICE_LINK_FORBIDDEN = [
  ...DEVICE_LINK_REQUIRED,
  // The tester-only settings action and its disclosure, plus the older
  // button label, which no build should bring back.
  'Connect this extension',
  'Connect tester account',
  'Invited tester? Connect a tester account',
]

export function deviceLinkShips(target) {
  return target !== 'firefox'
}

/**
 * @param {string} target development | cws | edge | firefox
 * @param {Record<string, string>} bundles packaged path -> JavaScript text
 * @returns {{ errors: string[], summary: string }}
 */
export function checkDeviceLinkBundles(target, bundles) {
  const errors = []
  const files = Object.entries(bundles)
  if (deviceLinkShips(target)) {
    for (const marker of DEVICE_LINK_REQUIRED) {
      if (!files.some(([, text]) => text.includes(marker))) {
        errors.push(`${target} build lost the device link: no bundle contains ${JSON.stringify(marker)}`)
      }
    }
    return { errors, summary: `REQUIRED: ${target} build keeps the device link` }
  }
  for (const [path, text] of files) {
    for (const marker of DEVICE_LINK_FORBIDDEN) {
      if (text.includes(marker)) {
        errors.push(`${target} build must not contain the device link: ${JSON.stringify(marker)} in ${path}`)
      }
    }
  }
  return { errors, summary: `REQUIRED: ${target} build has no device link` }
}
