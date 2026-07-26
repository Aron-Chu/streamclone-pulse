/** Portal support form validation + submission helpers (RPR-4). Pure helpers — no secrets. */

export const SUPPORT_CATEGORIES = [
  'bug',
  'data_coverage',
  'suggestion',
  'product_complaint',
] as const

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number]

export const SUPPORT_PRIVACY_REDIRECT_CATEGORIES = ['privacy', 'legal', 'privacy_legal', 'gdpr'] as const
export const SUPPORT_SECURITY_REJECTED_CATEGORIES = ['security', 'vulnerability', 'vuln'] as const

export const SUPPORT_SUBJECT_MAX = 120
export const SUPPORT_DESCRIPTION_MAX = 4000

export type SupportFormValues = {
  category: string
  subject: string
  description: string
  consent: boolean
  email?: string
  contactConsent?: boolean
  twitchLogin?: string
  turnstileToken?: string
}

export type SupportValidationResult =
  | { ok: true }
  | { ok: false; error: string }

export function normalizeTwitchLogin(raw: string): string {
  return raw.trim().toLowerCase()
}

export function validateSupportForm(values: SupportFormValues): SupportValidationResult {
  const category = values.category.trim().toLowerCase()
  if ((SUPPORT_PRIVACY_REDIRECT_CATEGORIES as readonly string[]).includes(category)) {
    return { ok: false, error: 'privacy_redirect' }
  }
  if ((SUPPORT_SECURITY_REJECTED_CATEGORIES as readonly string[]).includes(category)) {
    return { ok: false, error: 'security_not_accepted' }
  }
  if (!(SUPPORT_CATEGORIES as readonly string[]).includes(category)) {
    return { ok: false, error: 'invalid_category' }
  }
  if (!values.consent) {
    return { ok: false, error: 'consent_required' }
  }
  const subject = values.subject.trim()
  if (!subject || subject.length > SUPPORT_SUBJECT_MAX) {
    return { ok: false, error: 'invalid_subject' }
  }
  const description = values.description.trim()
  if (!description || description.length > SUPPORT_DESCRIPTION_MAX) {
    return { ok: false, error: 'invalid_description' }
  }
  const email = values.email?.trim() ?? ''
  if (email) {
    if (!values.contactConsent) {
      return { ok: false, error: 'contact_consent_required' }
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, error: 'invalid_email' }
    }
  }
  const login = values.twitchLogin ? normalizeTwitchLogin(values.twitchLogin) : ''
  if (login && !/^[a-z0-9][a-z0-9_]{2,24}$/.test(login)) {
    return { ok: false, error: 'invalid_twitch_login' }
  }
  const token = values.turnstileToken?.trim() ?? ''
  if (!token) {
    return { ok: false, error: 'turnstile_required' }
  }
  return { ok: true }
}

export function supportFormAvailability(siteKey: string | undefined | null): 'ready' | 'unavailable' {
  return siteKey && siteKey.trim() ? 'ready' : 'unavailable'
}

/** Stable Idempotency-Key for one logical submission (retries reuse the same key). */
export function createSupportIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `sp-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function supportBackendRoot(envUrl: string | undefined | null): string {
  const fromEnv = envUrl?.trim().replace(/\/+$/, '')
  return fromEnv || 'https://api.streampulse.stream'
}

export const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
export const TURNSTILE_FRAME_ORIGINS = ['https://challenges.cloudflare.com'] as const

export function ensureTurnstileScript(siteKey: string): Promise<void> {
  if (!siteKey.trim()) {
    return Promise.reject(new Error('missing_site_key'))
  }
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('no_document'))
  }
  const w = window as Window & { turnstile?: { render: unknown } }
  if (w.turnstile) {
    return Promise.resolve()
  }
  const existing = document.querySelector<HTMLScriptElement>('script[data-streampulse-turnstile]')
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('turnstile_script_failed')), { once: true })
    })
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `${TURNSTILE_SCRIPT_SRC}?render=explicit`
    script.async = true
    script.defer = true
    script.dataset.streampulseTurnstile = '1'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('turnstile_script_failed'))
    document.head.appendChild(script)
  })
}
