import { useCallback, useEffect, useRef, useState } from 'react'
import { getBackendUrl } from '../lib/apiClient'

export type PublicStatusTone = 'ready' | 'degraded' | 'offline' | 'checking'

export interface UsePublicStatusProbeOptions {
  /**
   * Optional rare poll cadence. Default `0` = mount-once only (channel shell tone).
   * Interval ticks skip while `document.visibilityState === 'hidden'`.
   */
  pollMs?: number
  enabled?: boolean
}

export interface PublicStatusProbeState {
  tone: PublicStatusTone
  loading: boolean
  error: string | null
  /** Raw `status` field from `/v1/public/status`, when available. */
  status: string | null
  degraded: boolean
}

interface PublicStatusPayload {
  status?: string
  degraded?: boolean
  updatedAt?: string
}

function toneFromPayload(payload: PublicStatusPayload): {
  tone: Exclude<PublicStatusTone, 'checking'>
  status: string | null
  degraded: boolean
} {
  const status = typeof payload.status === 'string' ? payload.status : null
  const degraded = payload.degraded === true || (status != null && status !== 'operational')
  return {
    tone: degraded ? 'degraded' : 'ready',
    status,
    degraded,
  }
}

/**
 * Lightweight API shell tone for channel analytics routes.
 * Hits `/v1/public/status` only — never `/v1/public/hub` (P4-L05 Phase 1).
 */
export function usePublicStatusProbe(
  options: UsePublicStatusProbeOptions = {},
): PublicStatusProbeState {
  const { pollMs = 0, enabled = true } = options
  const [tone, setTone] = useState<PublicStatusTone>('checking')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [degraded, setDegraded] = useState(false)

  const controllerRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef(false)
  const lastFetchAtRef = useRef(0)
  const mountedRef = useRef(true)
  const hasSuccessRef = useRef(false)

  const load = useCallback(async () => {
    if (inFlightRef.current) return

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    inFlightRef.current = true

    if (!hasSuccessRef.current) {
      setLoading(true)
      setTone('checking')
    }

    try {
      const base = getBackendUrl().replace(/\/+$/, '')
      const response = await fetch(`${base}/v1/public/status`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
      if (!mountedRef.current || controller.signal.aborted) return

      if (!response.ok) {
        setError(`/v1/public/status → HTTP ${response.status}`)
        setTone('offline')
        setStatus(null)
        setDegraded(false)
        return
      }

      const payload = (await response.json()) as PublicStatusPayload
      if (!mountedRef.current || controller.signal.aborted) return

      const next = toneFromPayload(payload)
      hasSuccessRef.current = true
      setError(null)
      setTone(next.tone)
      setStatus(next.status)
      setDegraded(next.degraded)
    } catch (err) {
      if (controller.signal.aborted || !mountedRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to load public status')
      setTone('offline')
      setStatus(null)
      setDegraded(false)
    } finally {
      if (controllerRef.current === controller) {
        inFlightRef.current = false
        lastFetchAtRef.current = Date.now()
      }
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    if (!enabled) {
      setLoading(false)
      return () => {
        mountedRef.current = false
        controllerRef.current?.abort()
      }
    }

    void load()

    let pollTimer: number | undefined
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void load()
    }
    if (pollMs > 0) {
      pollTimer = window.setInterval(tick, pollMs)
    }

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (pollMs <= 0) return
      const sinceLastFetch = Date.now() - lastFetchAtRef.current
      if (sinceLastFetch < Math.min(pollMs / 2, 15_000)) return
      void load()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      mountedRef.current = false
      controllerRef.current?.abort()
      if (pollTimer) window.clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, pollMs, load])

  return { tone, loading, error, status, degraded }
}
