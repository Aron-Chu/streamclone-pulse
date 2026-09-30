import type { PublicCaptureClient } from './productAnalyticsCapture'

/** Optional public-site product analytics. No network or import before consent. */
export type AnalyticsPreference = 'allowed' | 'declined' | 'unset'
export type PublicPageCategory = 'home' | 'docs' | 'status' | 'privacy' | 'terms' | 'refunds' | 'supporter' | 'support'
export type PublicCta = 'install_extension' | 'open_analytics'
export const ANALYTICS_PREFERENCE_KEY = 'sp.websiteAnalytics.v1'

const categories: Record<string, PublicPageCategory> = {
  '/': 'home', '/docs': 'docs', '/status': 'status', '/privacy': 'privacy',
  '/terms': 'terms', '/refunds': 'refunds', '/supporter': 'supporter', '/support': 'support',
}
const listeners = new Set<() => void>()
let preference: AnalyticsPreference | undefined
let client: PublicCaptureClient | undefined
let loading: Promise<void> | undefined
let generation = 0
let page: PublicPageCategory | null = null
let lastPage: PublicPageCategory | null = null
let listening = false

export function analyticsConfigured(): boolean {
  return /^phc_[A-Za-z0-9]+$/.test(import.meta.env.VITE_POSTHOG_PROJECT_TOKEN?.trim() ?? '') &&
    typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' &&
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
}

export function analyticsBlockedByBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string }
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1' || nav.doNotTrack === 'yes' ||
    nav.msDoNotTrack === '1' || (typeof window !== 'undefined' && (window as Window & { doNotTrack?: string }).doNotTrack === '1')
}

function storedPreference(): AnalyticsPreference {
  try {
    const value = localStorage.getItem(ANALYTICS_PREFERENCE_KEY)
    return value === 'allowed' || value === 'declined' ? value : 'unset'
  } catch { return 'unset' }
}

export function getAnalyticsPreference(): AnalyticsPreference {
  if (typeof window === 'undefined') return 'unset'
  return preference ?? storedPreference()
}

export function publicPageCategory(pathname: string): PublicPageCategory | null {
  return Object.prototype.hasOwnProperty.call(categories, pathname) ? categories[pathname]! : null
}

function eligible(category: PublicPageCategory | null): boolean {
  return typeof window !== 'undefined' && analyticsConfigured() && !analyticsBlockedByBrowser() &&
    getAnalyticsPreference() === 'allowed' && category !== null &&
    publicPageCategory(window.location.pathname) === category
}

function stop(): void {
  generation += 1
  loading = undefined
  lastPage = null
  client?.stop()
  client = undefined
}

function capturePage(): void {
  if (!client || !eligible(page) || page === lastPage) return
  lastPage = page
  client.capturePage(page!)
}

function reconcile(): void {
  page = typeof window === 'undefined' ? null : publicPageCategory(window.location.pathname)
  if (!eligible(page)) { stop(); return }
  if (client) { capturePage(); return }
  if (loading) return
  const turn = generation
  loading = import('./productAnalyticsCapture').then(({ createPublicCaptureClient }) => {
    if (turn !== generation || !eligible(page)) return
    client = createPublicCaptureClient(import.meta.env.VITE_POSTHOG_PROJECT_TOKEN!.trim(), eligible)
    capturePage()
  }).catch(() => {
    // Optional analytics must never interfere with the page or expose provider errors.
    stop()
  }).finally(() => { if (turn === generation) loading = undefined })
}

function listen(): void {
  if (listening || typeof window === 'undefined') return
  listening = true
  window.addEventListener('storage', event => {
    if (event.key !== ANALYTICS_PREFERENCE_KEY && event.key !== null) return
    preference = storedPreference()
    reconcile()
    listeners.forEach(listener => listener())
  })
}

export function subscribeAnalyticsPreference(listener: () => void): () => void {
  listen()
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function setAnalyticsPreference(value: Exclude<AnalyticsPreference, 'unset'>): void {
  preference = value === 'allowed' && !analyticsBlockedByBrowser() ? 'allowed' : 'declined'
  try { localStorage.setItem(ANALYTICS_PREFERENCE_KEY, preference) } catch { /* Choice remains effective in this tab. */ }
  listen()
  reconcile()
  listeners.forEach(listener => listener())
}

/** React observes every pathname, including excluded account and analytics routes. */
export function setProductAnalyticsRoute(): void {
  listen()
  reconcile()
}

export function capturePublicCta(cta: PublicCta): void {
  if (!client || !eligible(page) || (cta !== 'install_extension' && cta !== 'open_analytics')) return
  client.captureCta(page!, cta)
}