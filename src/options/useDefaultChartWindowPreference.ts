import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_DEFAULT_CHART_WINDOW,
  getDefaultChartWindow,
  setDefaultChartWindow,
  type DefaultChartWindow,
} from '../shared/storage.ts'

/** Options-only preference; the narrow Twitch workspace keeps range on the chart. */
export function useDefaultChartWindowPreference() {
  const [value, setValue] = useState<DefaultChartWindow>(DEFAULT_DEFAULT_CHART_WINDOW)
  const [status, setStatus] = useState('')
  const timerRef = useRef<number | null>(null)

  const refresh = useCallback(() => {
    void getDefaultChartWindow().then(setValue).catch(() => setStatus('Could not load settings'))
  }, [])

  useEffect(() => {
    refresh()
    const changed = globalThis.chrome?.storage?.onChanged
    if (!changed?.addListener) return
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes.defaultChartWindow) refresh()
    }
    changed.addListener(listener)
    return () => changed.removeListener(listener)
  }, [refresh])

  useEffect(() => () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current)
  }, [])

  async function set(next: DefaultChartWindow): Promise<void> {
    const previous = value
    setValue(next)
    try {
      await setDefaultChartWindow(next)
      setStatus('Saved')
    } catch {
      setValue(previous)
      setStatus('Could not save')
    }
    if (timerRef.current != null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setStatus(''), 1_500)
  }

  return { value, status, set }
}
