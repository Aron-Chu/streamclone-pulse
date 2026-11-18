import { PulseSettingsPanel } from '../ui/PulseSettingsPanel.tsx'

/**
 * Entry of `content/quick-settings.js`: the panel's Quick settings view. The
 * worker injects it into a Twitch tab (src/background/quickSettingsScript.ts)
 * when the panel is first hovered, focused or asked for its settings, so it
 * never counts against the content script's size budget. It registers the
 * view in the extension's isolated world and draws nothing by itself; the
 * overlay renders it in its own React tree (src/shared/quickSettingsContract.ts).
 */
globalThis.__pulseQuickSettings ??= PulseSettingsPanel
