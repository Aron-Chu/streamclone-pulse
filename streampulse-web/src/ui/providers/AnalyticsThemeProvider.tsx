import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  COMMAND_CENTER_LABELS,
  type CommandCenterLabels,
} from '../themes/commandCenterLabels'

interface AnalyticsHubContextValue {
  labels: CommandCenterLabels
  motionEnabled: boolean
}

const AnalyticsHubContext = createContext<AnalyticsHubContextValue | null>(null)

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return reduced
}

export interface AnalyticsThemeProviderProps {
  children: ReactNode
}

/** Provides hub copy labels and motion preference for analytics surfaces. */
export function AnalyticsThemeProvider({ children }: AnalyticsThemeProviderProps) {
  const motionEnabled = !usePrefersReducedMotion()

  const value = useMemo(
    () => ({ labels: COMMAND_CENTER_LABELS, motionEnabled }),
    [motionEnabled],
  )

  return (
    <AnalyticsHubContext.Provider value={value}>
      {children}
    </AnalyticsHubContext.Provider>
  )
}

export function useAnalyticsThemeOptional(): AnalyticsHubContextValue | null {
  return useContext(AnalyticsHubContext)
}

export function useCommandCenterLabels(): CommandCenterLabels {
  const ctx = useAnalyticsThemeOptional()
  return ctx?.labels ?? COMMAND_CENTER_LABELS
}

/** @deprecated Use useAnalyticsThemeOptional — theme switching removed. */
export function useAnalyticsTheme(): AnalyticsHubContextValue {
  const ctx = useContext(AnalyticsHubContext)
  if (!ctx) {
    return { labels: COMMAND_CENTER_LABELS, motionEnabled: true }
  }
  return ctx
}
