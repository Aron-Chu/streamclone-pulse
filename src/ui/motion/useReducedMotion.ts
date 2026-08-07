import { useEffect, useState } from 'react'
import {
  DEFAULT_REDUCE_MOTION_PREFERENCE,
  REDUCE_MOTION_PREFERENCE_KEY,
  getReduceMotionPreference,
  resolveReducedMotionEnabled,
  resolveReduceMotionPreference,
  type ReduceMotionPreference,
} from '../../shared/storage.ts'

function systemPrefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
}

/**
 * Effective reduced-motion for chart/UI motion.
 * Honors the stored preference (system / on / off); `system` follows the OS.
 * Feeds the same `motionOff` path in PulseOverviewChart — do not add a parallel flag.
 */
export function useReducedMotion(): boolean {
  const [preference, setPreference] = useState<ReduceMotionPreference>(DEFAULT_REDUCE_MOTION_PREFERENCE)
  const [systemReduced, setSystemReduced] = useState(systemPrefersReducedMotion)

  useEffect(() => {
    let cancelled = false
    void getReduceMotionPreference().then(pref => {
      if (!cancelled) setPreference(pref)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return
    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area !== 'sync') return
      const change = changes[REDUCE_MOTION_PREFERENCE_KEY]
      if (!change) return
      setPreference(resolveReduceMotionPreference(change.newValue))
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setSystemReduced(mq.matches)
    onChange()
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    }
    mq.addListener(onChange)
    return () => mq.removeListener(onChange)
  }, [])

  return resolveReducedMotionEnabled(preference, systemReduced)
}
