/**
 * Contract between the Twitch content script and `content/quick-settings.js`,
 * the lazily injected script that carries the panel's Quick settings view
 * (src/ui/PulseSettingsPanel.tsx), so that view never counts against the
 * content script's size budget.
 *
 * Quick settings renders inside the overlay's own React tree, so it must use
 * the content script's React, not a copy. The same goes for every module that
 * keeps state between the panel's views: the bridge (it reports an orphaned
 * extension context), the Supporter appearance cache (Quick settings starts
 * from the finish the header already verified) and the Pulse banner. The
 * content script hands these over in one object before it asks the worker for
 * the script (src/ui/quickSettings.ts); vite.quickSettings.config.ts turns
 * the script's imports of them into reads of that object, so the build fails
 * if Quick settings imports anything else from them. Everything else Quick
 * settings uses holds no state and is bundled into the script itself.
 */

import type { PulseSettingsPanel } from '../ui/PulseSettingsPanel.tsx'

/** Packages the script takes whole from the host: package → host key. */
export const QUICK_SETTINGS_SHARED_PACKAGES = {
  react: 'react',
  'react/jsx-runtime': 'jsx',
} as const

/**
 * Modules the script takes from the host, by repo-relative path: each export
 * it may import → the host key that carries it.
 */
export const QUICK_SETTINGS_SHARED_MODULES = {
  'src/content/bridge.ts': { sendBackgroundMessage: 'send' },
  'src/ui/useSupporterAppearance.ts': { useSupporterAppearanceDetails: 'appearance' },
  'src/ui/PulseBanner.tsx': {
    usePulseBanner: 'banner',
    PulseBannerBackdrop: 'backdrop',
    PulseBannerLoadError: 'bannerError',
  },
} as const

export interface QuickSettingsHost {
  react: typeof import('react')
  jsx: typeof import('react/jsx-runtime')
  send: typeof import('../content/bridge.ts').sendBackgroundMessage
  appearance: typeof import('../ui/useSupporterAppearance.ts').useSupporterAppearanceDetails
  banner: typeof import('../ui/PulseBanner.tsx').usePulseBanner
  backdrop: typeof import('../ui/PulseBanner.tsx').PulseBannerBackdrop
  bannerError: typeof import('../ui/PulseBanner.tsx').PulseBannerLoadError
}

export type QuickSettingsPanel = typeof PulseSettingsPanel

declare global {
  /** Set by the content script before it asks for the script; read once when the script runs. */
  var __pulseQuickSettingsHost: QuickSettingsHost | undefined
  /** Registered by content/quick-settings.js in the extension's isolated world. */
  var __pulseQuickSettings: QuickSettingsPanel | undefined
}
