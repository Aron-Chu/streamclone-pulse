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

/** Byte bounds, matching the backend's `len()` checks on the trimmed UTF-8 text. */
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
  // The backend bounds these in UTF-8 bytes, not UTF-16 code units: an emoji is
  // four bytes there and two units here, so `.length` would let through text the
  // server rejects.
  const subject = values.subject.trim()
  if (!subject || utf8ByteLength(subject) > SUPPORT_SUBJECT_MAX) {
    return { ok: false, error: 'invalid_subject' }
  }
  const description = values.description.trim()
  if (!description || utf8ByteLength(description) > SUPPORT_DESCRIPTION_MAX) {
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

/** The build's public Turnstile site key; empty when the build has none. */
export function feedbackSiteKey(): string {
  return (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim() ?? ''
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
      existing.addEventListener('error', () => {
        existing.remove()
        reject(new Error('turnstile_script_failed'))
      }, { once: true })
    })
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `${TURNSTILE_SCRIPT_SRC}?render=explicit`
    script.async = true
    script.defer = true
    script.dataset.streampulseTurnstile = '1'
    script.onload = () => resolve()
    // A failed tag is removed, so a later attempt (the reader's Try again)
    // adds a fresh one instead of waiting on a tag that already failed.
    script.onerror = () => {
      script.remove()
      reject(new Error('turnstile_script_failed'))
    }
    document.head.appendChild(script)
  })
}

/**
 * Whether a Turnstile client error code (passed to the widget's error-callback)
 * can pass on a fresh challenge. Cloudflare's client-side error table marks
 * these "Retry: Yes": challenge and interaction timeouts (1106xx), the iframe
 * failing to load (200500), and the generic challenge failures (300xxx, 600xxx).
 * Everything else is a configuration or browser problem (site key, domain,
 * clock) that no retry fixes, as is a missing or unknown code.
 */
export function turnstileErrorRetryable(code: unknown): boolean {
  return /^(1106\d\d|200500|300\d{3}|600\d{3})$/.test(turnstileCode(code))
}

function turnstileCode(code: unknown): string {
  return typeof code === 'number' ? String(code) : typeof code === 'string' ? code.trim() : ''
}

/**
 * Whether a Turnstile client error code is our own site configuration (bad
 * parameters 102xxx-106xxx, unknown site key or domain 1101xx/1102xx/1104xx,
 * invalid site key 4000xx), which only an operator can fix. Any other code no
 * retry fixes is this browser blocking or breaking the check.
 */
export function turnstileErrorIsSiteConfig(code: unknown): boolean {
  return /^(10[2-6]\d{3}|110[124]\d\d|4000\d\d)$/.test(turnstileCode(code))
}

/**
 * The short reference a reader can quote: the first 8 characters of the case
 * ID (the first block of its UUID), upper-cased so it reads clearly.
 */
export function supportShortReference(caseId: string): string {
  return caseId.trim().slice(0, 8).toUpperCase()
}

const utf8 = new TextEncoder()

/** Length in UTF-8 bytes — the unit the backend's limits are written in. */
export function utf8ByteLength(value: string): number {
  return utf8.encode(value).length
}

/** The longest prefix of `value` that fits in `maxBytes`, never splitting a character. */
export function truncateUtf8(value: string, maxBytes: number): string {
  if (utf8ByteLength(value) <= maxBytes) return value
  let out = ''
  let used = 0
  for (const char of value) {
    const size = utf8ByteLength(char)
    if (used + size > maxBytes) break
    out += char
    used += size
  }
  return out
}

const SUBJECT_ELLIPSIS = '…'

/**
 * The case subject for a one-box message: its first words on one line, at most
 * SUPPORT_SUBJECT_MAX UTF-8 bytes. A cut lands between words when one is near,
 * otherwise inside the word, and is marked with an ellipsis that is counted in
 * the limit.
 */
export function deriveSupportSubject(message: string, maxBytes = SUPPORT_SUBJECT_MAX): string {
  const line = message.replace(/\s+/g, ' ').trim()
  if (utf8ByteLength(line) <= maxBytes) return line
  const room = maxBytes - utf8ByteLength(SUBJECT_ELLIPSIS)
  const prefix = truncateUtf8(line, room)
  const lastSpace = prefix.lastIndexOf(' ')
  // Prefer a word boundary unless it would throw away most of the room.
  const cut = lastSpace >= prefix.length / 2 ? prefix.slice(0, lastSpace) : prefix
  return `${cut.trimEnd()}${SUBJECT_ELLIPSIS}`
}

/** The two choices on the public feedback card and the case category each one files. */
export const FEEDBACK_KINDS = [
  { value: 'bug', label: "Something's wrong" },
  { value: 'suggestion', label: 'I have an idea' },
] as const satisfies readonly { value: SupportCategory; label: string }[]

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]['value']

export type FeedbackDraft = {
  kind: FeedbackKind
  message: string
  email: string
  consent: boolean
  contactConsent: boolean
}

/** JSON body for POST /v1/portal/support/cases, minus the per-attempt challenge token. */
export type SupportCaseBody = {
  category: SupportCategory
  subject: string
  description: string
  consent: true
  email?: string
  contact_consent?: true
}

export function buildSupportCaseBody(draft: FeedbackDraft): SupportCaseBody {
  const description = draft.message.trim()
  const email = draft.email.trim()
  return {
    category: draft.kind,
    subject: deriveSupportSubject(description),
    description,
    consent: true,
    // The reply address and its consent travel together or not at all.
    ...(email ? { email, contact_consent: true as const } : {}),
  }
}

export type FeedbackDraftError =
  | 'message_required'
  | 'message_too_long'
  | 'consent_required'
  | 'contact_consent_required'
  | 'invalid_email'

/** Field problems the card can point at before anything is sent. */
export function validateFeedbackDraft(draft: FeedbackDraft): FeedbackDraftError | null {
  const message = draft.message.trim()
  if (!message) return 'message_required'
  if (utf8ByteLength(message) > SUPPORT_DESCRIPTION_MAX) return 'message_too_long'
  const email = draft.email.trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'invalid_email'
  if (email && !draft.contactConsent) return 'contact_consent_required'
  if (!draft.consent) return 'consent_required'
  return null
}

/**
 * One Idempotency-Key per logical submission. Retrying the same body reuses the
 * key, so a reply lost in transit cannot file a second case; any edit to the
 * body, or a completed send, starts a new key, because the server answers a
 * reused key with the earlier case and would silently drop the edit. The
 * challenge token is per attempt and is deliberately not part of the identity.
 */
export function createSupportIdempotency(create: () => string = createSupportIdempotencyKey) {
  let identity: string | null = null
  let key = ''
  return {
    keyFor(body: SupportCaseBody): string {
      const next = JSON.stringify(body)
      if (next !== identity) {
        identity = next
        key = create()
      }
      return key
    },
    /** Call after a case is accepted: the next send is a new submission. */
    reset() {
      identity = null
      key = ''
    },
  }
}

export type SupportSendOutcome =
  | { kind: 'sent'; caseId: string }
  /**
   * `busy` is the site-wide hourly ceiling (`429 intake_busy`): the form is
   * taking no new messages until the hour ends, whatever this reader did.
   */
  | { kind: 'rate_limited'; retryAfterMs: number | null; busy?: true }
  | { kind: 'unavailable' }
  | { kind: 'check_failed' }
  | { kind: 'rejected'; field: 'message' | 'email' | null }
  | { kind: 'failed' }

/**
 * Backend codes that mean the hosted form is switched off or not configured — not
 * worth retrying. `missing_delivery_adapter` is a backend with intake on but no
 * ready email adapter: it refuses every case until an operator fixes it, so the
 * reader gets the unavailable panel, not a "Try again" that can never succeed.
 */
const UNAVAILABLE_CODES = new Set(['disabled', 'missing_turnstile_secret', 'missing_limiter', 'missing_store', 'missing_delivery_adapter'])

/** What a 2xx reply means: only a case ID the server returned counts as sent. */
export function supportSuccessOutcome(body: unknown): SupportSendOutcome {
  const caseId = body && typeof body === 'object' ? (body as { case_id?: unknown }).case_id : undefined
  return typeof caseId === 'string' && caseId.trim() ? { kind: 'sent', caseId: caseId.trim() } : { kind: 'failed' }
}

/** What a failed send means for the card. `error` is an ApiError-shaped value or anything thrown. */
export function supportFailureOutcome(error: unknown): SupportSendOutcome {
  const record = error && typeof error === 'object' ? (error as { status?: unknown; code?: unknown; retryAfterMs?: unknown }) : {}
  const status = typeof record.status === 'number' ? record.status : 0
  const code = typeof record.code === 'string' ? record.code : ''
  if (status === 429) {
    const wait = typeof record.retryAfterMs === 'number' && Number.isFinite(record.retryAfterMs) && record.retryAfterMs > 0
      ? record.retryAfterMs
      : null
    return code === 'intake_busy' ? { kind: 'rate_limited', retryAfterMs: wait, busy: true } : { kind: 'rate_limited', retryAfterMs: wait }
  }
  if (status === 503 && UNAVAILABLE_CODES.has(code)) return { kind: 'unavailable' }
  if (status === 400 && (code === 'turnstile_failed' || code === 'invalid_turnstile_token')) return { kind: 'check_failed' }
  if (status === 400 && (code === 'invalid_description' || code === 'invalid_subject')) return { kind: 'rejected', field: 'message' }
  if (status === 400 && (code === 'invalid_email' || code === 'contact_consent_required')) return { kind: 'rejected', field: 'email' }
  if (status === 413) return { kind: 'rejected', field: 'message' }
  if (status >= 400 && status < 500) return { kind: 'rejected', field: null }
  // Network loss, timeouts, 5xx store errors: the case may be retried as-is.
  return { kind: 'failed' }
}
