import type { ColorSchemePreference } from '../shared/storage.ts'

export type TwitchColorScheme = 'light' | 'dark'

const LIGHT_CLASS = 'tw-root--theme-light'
const DARK_CLASS = 'tw-root--theme-dark'

/** Read Twitch root theme classes. Unknown / conflict → dark (no light flash). */
export function detectTwitchColorScheme(
  root: Element | null = typeof document !== 'undefined' ? document.documentElement : null,
): TwitchColorScheme {
  if (!root) return 'dark'
  const light = root.classList.contains(LIGHT_CLASS)
  const dark = root.classList.contains(DARK_CLASS)
  if (light && !dark) return 'light'
  return 'dark'
}

export function resolvePulseColorScheme(
  preference: ColorSchemePreference,
  twitchScheme: TwitchColorScheme,
): TwitchColorScheme {
  if (preference === 'light' || preference === 'dark') return preference
  return twitchScheme
}

/**
 * Observe only the documentElement `class` attribute. Emits the initial scheme
 * once, then only when the resolved value changes. Returns cleanup.
 */
export function observeTwitchColorScheme(
  onChange: (scheme: TwitchColorScheme) => void,
  root: Element | null = typeof document !== 'undefined' ? document.documentElement : null,
): () => void {
  let last = detectTwitchColorScheme(root)
  onChange(last)

  if (!root || typeof MutationObserver === 'undefined') {
    return () => {}
  }

  const observer = new MutationObserver(() => {
    const next = detectTwitchColorScheme(root)
    if (next === last) return
    last = next
    onChange(next)
  })
  observer.observe(root, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}
