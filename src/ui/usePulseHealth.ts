import { useCallback, useEffect, useRef, useState } from 'react'
import { sendBackgroundMessage } from '../content/bridge.ts'
import type { BackgroundResponse } from '../shared/messages.ts'
import { backgroundErrorMessage, EXTENSION_RECONNECT_MESSAGE } from '../shared/backgroundResponse.ts'

export type PulseHealthSnapshot = Extract<BackgroundResponse, { type: 'HEALTH' }>

export function usePulseHealth() {
  const [health, setHealth] = useState<PulseHealthSnapshot | null>(null)
  const [checking, setChecking] = useState(true)
  const mountedRef = useRef(true)
  const requestRef = useRef(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; requestRef.current++ }
  }, [])

  const refresh = useCallback(async (force = false): Promise<void> => {
    const request = ++requestRef.current
    setChecking(true)
    setError(null)
    try {
      const response = await sendBackgroundMessage({ type: 'HEALTH', force })
      if (!mountedRef.current || request !== requestRef.current) return
      const snapshot = response && 'type' in response && response.type === 'HEALTH' ? response : null
      setHealth(snapshot)
      if (!snapshot) setError(backgroundErrorMessage(response, EXTENSION_RECONNECT_MESSAGE) ?? EXTENSION_RECONNECT_MESSAGE)
    } catch {
      if (mountedRef.current && request === requestRef.current) {
        setHealth(null)
        setError(EXTENSION_RECONNECT_MESSAGE)
      }
    } finally {
      if (mountedRef.current && request === requestRef.current) setChecking(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  return { health, checking, refresh, error }
}
