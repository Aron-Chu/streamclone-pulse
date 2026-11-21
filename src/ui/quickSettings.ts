import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { useSupporterAppearanceDetails } from './useSupporterAppearance.ts'
import { PulseBannerBackdrop, PulseBannerLoadError, usePulseBanner } from './PulseBanner.tsx'
import type { QuickSettingsHost, QuickSettingsPanel } from '../shared/quickSettingsContract.ts'

/** What content/quick-settings.js takes from this content script (src/shared/quickSettingsContract.ts). */
export function quickSettingsHost(): QuickSettingsHost {
  return {
    react,
    jsx,
    send: sendBackgroundMessage,
    appearance: useSupporterAppearanceDetails,
    banner: usePulseBanner,
    backdrop: PulseBannerBackdrop,
    bannerError: PulseBannerLoadError,
  }
}

/** The one ask in flight; once it settles, the registered view (or a new ask) answers. */
let loading: Promise<QuickSettingsPanel | null> | undefined

/**
 * The Quick settings view, from content/quick-settings.js: at once when the
 * worker has already injected it, else after one ask. Null when it cannot load
 * (no extension runtime or a failed injection); a later call asks again.
 */
export function loadQuickSettings(): Promise<QuickSettingsPanel | null> {
  if (globalThis.__pulseQuickSettings) return Promise.resolve(globalThis.__pulseQuickSettings)
  globalThis.__pulseQuickSettingsHost ??= quickSettingsHost()
  loading ??= sendBackgroundMessage({ type: 'QUICK_SETTINGS_SCRIPT' })
    .then(() => globalThis.__pulseQuickSettings ?? null, () => null)
    .finally(() => { loading = undefined })
  return loading
}
