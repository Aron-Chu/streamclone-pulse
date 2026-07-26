/**
 * RPR-3 extension diagnostics consent — versioned chrome.storage.local record.
 * Missing / malformed / wrong schema version ⇒ off.
 *
 * Hosted ingest remains inactive until ops activation; this module only owns
 * local consent state.
 */

export const DIAGNOSTICS_CONSENT_STORAGE = 'pulse-diagnostics-consent-v1'
export const DIAGNOSTICS_CONSENT_SCHEMA_VERSION = 1

/** Client kill switch: hosted diagnostics upload is not active yet. */
export const EXTENSION_DIAGNOSTICS_INGEST_ENABLED = false

export interface DiagnosticsConsentRecord {
  schemaVersion: number
  enabled: boolean
  updatedAt: number
}

export function parseDiagnosticsConsent(raw: unknown): DiagnosticsConsentRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  if (rec.schemaVersion !== DIAGNOSTICS_CONSENT_SCHEMA_VERSION) return null
  if (typeof rec.enabled !== 'boolean') return null
  if (typeof rec.updatedAt !== 'number' || !Number.isFinite(rec.updatedAt)) return null
  return {
    schemaVersion: DIAGNOSTICS_CONSENT_SCHEMA_VERSION,
    enabled: rec.enabled,
    updatedAt: Math.floor(rec.updatedAt),
  }
}

/** Missing or malformed storage ⇒ off. */
export async function isDiagnosticsConsentEnabled(
  storage: Pick<typeof chrome.storage.local, 'get'> = chrome.storage.local,
): Promise<boolean> {
  try {
    const bag = await storage.get(DIAGNOSTICS_CONSENT_STORAGE)
    const parsed = parseDiagnosticsConsent(bag[DIAGNOSTICS_CONSENT_STORAGE])
    return parsed?.enabled === true
  } catch {
    return false
  }
}

export async function setDiagnosticsConsentEnabled(
  enabled: boolean,
  storage: Pick<typeof chrome.storage.local, 'set' | 'remove'> = chrome.storage.local,
): Promise<DiagnosticsConsentRecord> {
  if (!enabled) {
    // Withdrawal immediately denies sends and clears pending in-memory work.
    const { clearPendingDiagnosticsWork } = await import('./extensionDiagnostics.ts')
    clearPendingDiagnosticsWork()
    await storage.remove(DIAGNOSTICS_CONSENT_STORAGE)
    return {
      schemaVersion: DIAGNOSTICS_CONSENT_SCHEMA_VERSION,
      enabled: false,
      updatedAt: Date.now(),
    }
  }
  const record: DiagnosticsConsentRecord = {
    schemaVersion: DIAGNOSTICS_CONSENT_SCHEMA_VERSION,
    enabled: true,
    updatedAt: Date.now(),
  }
  await storage.set({ [DIAGNOSTICS_CONSENT_STORAGE]: record })
  return record
}

export const DIAGNOSTICS_BUNDLE_ALLOWLIST = new Set([
  'content/twitch.js',
  'background/service-worker.js',
  'popup/popup.js',
  'options/options.js',
])

const BUNDLE_RE = /^[a-z0-9._/-]+$/i

export type DiagnosticsSurface = 'content' | 'background' | 'popup' | 'options'
export type DiagnosticsFeature =
  | 'overlay'
  | 'coverage'
  | 'backfill'
  | 'watchlist'
  | 'options'
  | 'service_worker'
  | 'playback'
  | 'unknown'
export type DiagnosticsEvent =
  | 'uncaught_error'
  | 'unhandled_rejection'
  | 'render_error'
  | 'api_error'
export type DiagnosticsErrorClass =
  | 'type_error'
  | 'network_error'
  | 'timeout'
  | 'abort'
  | 'unknown'
export type DiagnosticsTarget = 'development' | 'cws' | 'edge'

export interface DiagnosticsFrameInput {
  bundle?: unknown
  line?: unknown
  column?: unknown
  [key: string]: unknown
}

export interface SanitizedDiagnosticsFrame {
  bundle: string
  line: number
  column: number
}

export interface ExtensionDiagnosticPayload {
  schema_version: number
  release: string
  manifest_version: number
  target: DiagnosticsTarget
  surface: DiagnosticsSurface
  feature: DiagnosticsFeature
  event: DiagnosticsEvent
  error: DiagnosticsErrorClass
  status: 'reported'
  frames: SanitizedDiagnosticsFrame[]
}

const SURFACES = new Set<DiagnosticsSurface>(['content', 'background', 'popup', 'options'])
const FEATURES = new Set<DiagnosticsFeature>([
  'overlay',
  'coverage',
  'backfill',
  'watchlist',
  'options',
  'service_worker',
  'playback',
  'unknown',
])
const EVENTS = new Set<DiagnosticsEvent>([
  'uncaught_error',
  'unhandled_rejection',
  'render_error',
  'api_error',
])
const ERRORS = new Set<DiagnosticsErrorClass>([
  'type_error',
  'network_error',
  'timeout',
  'abort',
  'unknown',
])
const TARGETS = new Set<DiagnosticsTarget>(['development', 'cws', 'edge'])

function bundleAllowed(bundle: string): boolean {
  if (DIAGNOSTICS_BUNDLE_ALLOWLIST.has(bundle)) return true
  if (bundle.startsWith('chunks/')) {
    const rest = bundle.slice('chunks/'.length)
    return Boolean(rest) && !rest.includes('/') && BUNDLE_RE.test(rest)
  }
  return false
}

/** Sanitize frames: max 20, {bundle,line,column} only, allowlisted bundles. */
export function sanitizeDiagnosticsFrames(raw: unknown): SanitizedDiagnosticsFrame[] {
  if (!Array.isArray(raw)) return []
  const out: SanitizedDiagnosticsFrame[] = []
  for (const item of raw) {
    if (out.length >= 20) break
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const frame = item as DiagnosticsFrameInput
    if (typeof frame.bundle !== 'string') continue
    const bundle = frame.bundle.trim()
    if (!BUNDLE_RE.test(bundle) || !bundleAllowed(bundle)) continue
    if (typeof frame.line !== 'number' || !Number.isFinite(frame.line) || frame.line < 0) continue
    if (typeof frame.column !== 'number' || !Number.isFinite(frame.column) || frame.column < 0) continue
    out.push({
      bundle,
      line: Math.floor(frame.line),
      column: Math.floor(frame.column),
    })
  }
  return out
}

export function sanitizeExtensionDiagnosticReport(raw: unknown): ExtensionDiagnosticPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  if (rec.schema_version !== DIAGNOSTICS_CONSENT_SCHEMA_VERSION) return null
  if (typeof rec.release !== 'string' || !rec.release.trim()) return null
  if (rec.manifest_version !== 3) return null
  if (typeof rec.target !== 'string' || !TARGETS.has(rec.target as DiagnosticsTarget)) return null
  if (typeof rec.surface !== 'string' || !SURFACES.has(rec.surface as DiagnosticsSurface)) return null
  if (typeof rec.feature !== 'string' || !FEATURES.has(rec.feature as DiagnosticsFeature)) return null
  if (typeof rec.event !== 'string' || !EVENTS.has(rec.event as DiagnosticsEvent)) return null
  if (typeof rec.error !== 'string' || !ERRORS.has(rec.error as DiagnosticsErrorClass)) return null
  return {
    schema_version: DIAGNOSTICS_CONSENT_SCHEMA_VERSION,
    release: rec.release.trim(),
    manifest_version: 3,
    target: rec.target as DiagnosticsTarget,
    surface: rec.surface as DiagnosticsSurface,
    feature: rec.feature as DiagnosticsFeature,
    event: rec.event as DiagnosticsEvent,
    error: rec.error as DiagnosticsErrorClass,
    status: 'reported',
    frames: sanitizeDiagnosticsFrames(rec.frames),
  }
}
