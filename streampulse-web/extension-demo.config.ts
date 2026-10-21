/**
 * What the site needs to bundle the extension's real panel for the /extension
 * demo (src/demo/). Shared by vite.config.ts and vitest.config.ts.
 *
 * The panel's modules read build-time constants that the extension's own
 * vite.config.ts defines. The site builds the panel as the store build visitors
 * install, with no Supporter backend and no Twitch sign-in: the demo has no
 * backend at all (src/demo/demoResponder.ts answers for the worker).
 */
import { resolve } from 'node:path'
import { resolveExtensionTarget } from '../scripts/extension-target.mjs'
import { loadExtensionReleasePreview } from '../scripts/release-preview.ts'

const STORE_TARGETS = new Set(['cws', 'edge', 'firefox'])

export function extensionDemoDefines(pulseRoot: string): Record<string, string> {
  // The Chrome Web Store build, unless a site build names another store target.
  const target = resolveExtensionTarget(process.env.SITE_DEMO_EXTENSION_TARGET ?? 'cws')
  return {
    __EXTENSION_STORE_BUILD__: JSON.stringify(STORE_TARGETS.has(target)),
    __EXTENSION_TARGET__: JSON.stringify(target),
    __EXTENSION_TARGET_MARKER__: JSON.stringify(`streampulse-extension-runtime-target:${target}`),
    __EXTENSION_BUILD_ID__: JSON.stringify('site-demo'),
    // The same release preview the extension shows, from the same notes file.
    __EXTENSION_RELEASE_PREVIEW__: JSON.stringify(
      loadExtensionReleasePreview(resolve(pulseRoot, 'src/shared/release-notes.json')),
    ),
    __SUPPORTER_BACKEND_ORIGIN__: JSON.stringify(''),
    __TWITCH_SIGNIN_STAGE__: JSON.stringify('off'),
    __EXTENSION_DEV_RELOAD__: JSON.stringify(false),
  }
}

/** The extension folders the demo imports from; `@pulse-ext/ui` is older and kept as it was. */
export function extensionDemoAliases(pulseRoot: string): Record<string, string> {
  return {
    '@pulse-ext/content': resolve(pulseRoot, 'src/content'),
    '@pulse-ext/shared': resolve(pulseRoot, 'src/shared'),
    '@pulse-ext/vod': resolve(pulseRoot, 'src/vod'),
  }
}
