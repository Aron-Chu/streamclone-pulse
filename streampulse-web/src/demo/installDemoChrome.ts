/**
 * Installs the demo's `chrome` before any extension module runs.
 *
 * DemoPanel imports this file first, so the fake is the global by the time the
 * panel's modules (storage.ts, bridge.ts, ...) evaluate. The page hooks (the
 * settings note, the community links) bind later, when the demo mounts.
 */
import { parseExtensionVodPulseResponse } from '@pulse-ext/vod/normalizeVodPulseFetch.ts'
import releaseNotes from '../../../src/shared/release-notes.json'
import { createDemoResponder, type DemoVodPulse } from './demoResponder'
import tape from './demoTape.json'
import { createFakeChrome, installFakeChrome } from './fakeChrome'

export interface DemoPageHooks {
  onOpenSettings?: (section?: string) => void
  onCommunityLink?: (link: 'discord' | 'feedback') => void
}

let hooks: DemoPageHooks = {}

/** The page's handlers for what the extension would open outside the panel. Returns an unbind. */
export function bindDemoPageHooks(next: DemoPageHooks): () => void {
  hooks = next
  return () => {
    if (hooks === next) hooks = {}
  }
}

/** The tape as the worker hands it to the panel (the same parser the HTTP path ends in). */
export const demoVodPulse = parseExtensionVodPulseResponse(tape as unknown as Record<string, unknown>)

/** The version of the panel code on this page (the extension's own release notes). */
export const demoExtensionVersion = String(releaseNotes.currentVersion)

export const demoResponder = createDemoResponder({
  vodPulse: demoVodPulse as unknown as DemoVodPulse,
  version: demoExtensionVersion,
  // The Catch me up script is bundled with the demo (DemoPanel imports it).
  loadScript: async () => Boolean((globalThis as { __pulseCatchMeUp?: unknown }).__pulseCatchMeUp),
  onOpenSettings: section => hooks.onOpenSettings?.(section),
  onCommunityLink: link => hooks.onCommunityLink?.(link),
})

export const demoChrome = installFakeChrome(
  createFakeChrome({
    responder: demoResponder.answer,
    version: demoExtensionVersion,
  }),
)
