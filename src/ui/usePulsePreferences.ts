import { useCallback, useEffect, useRef, useState } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import {
  DEFAULT_AUTO_UPDATE_ENABLED,
  DEFAULT_CHAT_CLOSED_PULSE_DOCK_ENABLED,
  DEFAULT_DENSITY_PREFERENCE,
  DEFAULT_OVERLAY_PLACEMENT,
  DEFAULT_THEME_PREFERENCE,
  DENSITY_PREFERENCE_KEY,
  getAutoUpdateEnabled,
  getChatClosedPulseDockEnabled,
  getDensityPreference,
  getOverlayPlacement,
  getThemePreference,
  setChatClosedPulseDockEnabled,
  setDensityPreference,
  setOverlayPlacement,
  setThemePreference,
  type DensityPreference,
  type OverlayPlacement,
  type ThemePreference,
} from '../shared/storage.ts'
import { applyAccentTheme } from './overlayTheme.ts'

const PREFERENCE_KEYS = new Set([
  'autoUpdateEnabled',
  'chatClosedPulseDockEnabled',
  'overlayPlacement',
  'themePreference',
  DENSITY_PREFERENCE_KEY,
])

export function usePulsePreferences() {
  type Preferences = {
    autoUpdate: boolean
    accent: ThemePreference
    placement: OverlayPlacement
    dock: boolean
    density: DensityPreference
  }
  const [preferences, setPreferences] = useState<Preferences>({
    autoUpdate: DEFAULT_AUTO_UPDATE_ENABLED,
    accent: DEFAULT_THEME_PREFERENCE,
    placement: DEFAULT_OVERLAY_PLACEMENT,
    dock: DEFAULT_CHAT_CLOSED_PULSE_DOCK_ENABLED,
    density: DEFAULT_DENSITY_PREFERENCE,
  })
  const [status, setStatus] = useState('')
  const statusTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (statusTimerRef.current != null) window.clearTimeout(statusTimerRef.current)
  }, [])

  const showStatus = useCallback((message: string): void => {
    if (statusTimerRef.current != null) window.clearTimeout(statusTimerRef.current)
    setStatus(message)
    statusTimerRef.current = window.setTimeout(() => {
      statusTimerRef.current = null
      setStatus('')
    }, 1_500)
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const [nextAutoUpdate, nextAccent, nextPlacement, nextDock, nextDensity] = await Promise.all([
        getAutoUpdateEnabled(),
        getThemePreference(),
        getOverlayPlacement(),
        getChatClosedPulseDockEnabled(),
        getDensityPreference(),
      ])
      applyAccentTheme(nextAccent)
      setPreferences({
        autoUpdate: nextAutoUpdate,
        accent: nextAccent,
        placement: nextPlacement,
        dock: nextDock,
        density: nextDensity,
      })
    } catch {
      showStatus('Could not load settings')
    }
  }, [showStatus])

  useEffect(() => {
    void refresh()
    const storageChanged = globalThis.chrome?.storage?.onChanged
    if (!storageChanged?.addListener) return
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (Object.keys(changes).some(key => PREFERENCE_KEYS.has(key))) void refresh()
    }
    storageChanged.addListener(listener)
    return () => storageChanged.removeListener(listener)
  }, [refresh])

  async function persist<K extends keyof Preferences>(
    key: K,
    next: Preferences[K],
    task: Promise<unknown>,
    apply?: (value: Preferences[K]) => void,
  ): Promise<void> {
    const previous = preferences[key]
    setPreferences(current => ({ ...current, [key]: next }))
    apply?.(next)
    try {
      await task
      showStatus('Saved')
    } catch {
      setPreferences(current => ({ ...current, [key]: previous }))
      apply?.(previous)
      showStatus('Could not save')
    }
  }

  return {
    ...preferences,
    status,
    setAutoUpdate(enabled: boolean) {
      return persist('autoUpdate', enabled, (async () => {
        const response = await sendBackgroundMessage({ type: 'SET_AUTO_UPDATE', enabled })
        if (!('ok' in response) || response.ok !== true) throw new Error('auto_update_save_failed')
      })())
    },
    setAccent(next: ThemePreference) {
      return persist('accent', next, setThemePreference(next), applyAccentTheme)
    },
    setPlacement(next: OverlayPlacement) {
      return persist('placement', next, setOverlayPlacement(next))
    },
    setDock(enabled: boolean) {
      return persist('dock', enabled, setChatClosedPulseDockEnabled(enabled))
    },
    setDensity(next: DensityPreference) {
      return persist('density', next, setDensityPreference(next))
    },
    async resetAppearanceAndLayout(): Promise<void> {
      const prev = { ...preferences }
      setPreferences(current => ({
        ...current,
        accent: DEFAULT_THEME_PREFERENCE,
        placement: DEFAULT_OVERLAY_PLACEMENT,
        dock: DEFAULT_CHAT_CLOSED_PULSE_DOCK_ENABLED,
        density: DEFAULT_DENSITY_PREFERENCE,
      }))
      applyAccentTheme(DEFAULT_THEME_PREFERENCE)
      try {
        await Promise.all([
          setThemePreference(DEFAULT_THEME_PREFERENCE),
          setOverlayPlacement(DEFAULT_OVERLAY_PLACEMENT),
          setChatClosedPulseDockEnabled(DEFAULT_CHAT_CLOSED_PULSE_DOCK_ENABLED),
          setDensityPreference(DEFAULT_DENSITY_PREFERENCE),
        ])
        showStatus('Saved')
      } catch {
        setPreferences(prev)
        applyAccentTheme(prev.accent)
        showStatus('Could not save')
      }
    },
  }
}
