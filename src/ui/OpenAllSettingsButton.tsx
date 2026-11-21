import { useState, type CSSProperties } from 'react'
import { backgroundErrorMessage, EXTENSION_RECONNECT_MESSAGE } from '../shared/backgroundResponse.ts'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { SettingsGearIcon } from './SettingsGearIcon.tsx'
import type { SettingsHostTarget } from '../shared/messages.ts'

/**
 * Opens a section of all settings in a new tab. The footer button below stays
 * in the Twitch content script; Quick settings (content/quick-settings.js)
 * carries its own copy of this hook.
 */
export function useSettingsHostOpener() {
  const [error, setError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  async function open(section: SettingsHostTarget): Promise<void> {
    setOpening(true)
    setError(null)
    try {
      const response = await sendBackgroundMessage({ type: 'OPEN_SETTINGS_HOST', section })
      const failure = backgroundErrorMessage(response, EXTENSION_RECONNECT_MESSAGE)
      if (failure || !response || !('type' in response) || response.type !== 'OPEN_SETTINGS_HOST') setError(failure ?? EXTENSION_RECONNECT_MESSAGE)
    } catch {
      setError(EXTENSION_RECONNECT_MESSAGE)
    } finally { setOpening(false) }
  }
  return { error, opening, open }
}

/**
 * Pinned where the Pulse view keeps its Settings bar, so the way out to the
 * full settings page sits in the same place on both views.
 */
export function OpenAllSettingsButton({ style }: { style?: CSSProperties }) {
  const { error, opening, open } = useSettingsHostOpener()
  return (
    <>
      {error ? <p className="pulse-settings-hint pulse-settings-footer-error" role="alert">{error}</p> : null}
      <button
        type="button"
        className="pulse-settings-bottom-bar"
        data-settings-host-cta="pulse"
        style={style}
        title="Open all settings in a new tab"
        disabled={opening}
        onClick={() => void open('pulse')}
      >
        <SettingsGearIcon size={16} />
        <span>{opening ? 'Opening settings…' : 'Open all settings'}</span>
        <span aria-hidden="true">↗</span>
      </button>
    </>
  )
}
