import { useAnalyticsThemeOptional } from '../providers/AnalyticsThemeProvider'

/** The analytics theme's motion switch: on unless the theme turns motion off. */
export function useAnalyticsMotionEnabled(): boolean {
  return useAnalyticsThemeOptional()?.motionEnabled ?? true
}

/** fadeThemeCenter's settle (opacity 0.85 to 1, 150 ms, linear) on the browser's own animations. */
export function settleThemeFade(el: HTMLElement | null, motionEnabled: boolean): void {
  if (!el || !motionEnabled || typeof el.animate !== 'function') return
  el.animate([{ opacity: 0.85 }, { opacity: 1 }], { duration: 150, easing: 'linear' })
}
