/**
 * RPR-3 extension diagnostics emitters — sanitized enums + frames only.
 * Hosted ingest remains gated by EXTENSION_DIAGNOSTICS_INGEST_ENABLED (false).
 */

import {
  DIAGNOSTICS_BUNDLE_ALLOWLIST,
  EXTENSION_DIAGNOSTICS_INGEST_ENABLED,
  type DiagnosticsErrorClass,
  type DiagnosticsEvent,
  type DiagnosticsFeature,
  type DiagnosticsSurface,
  type DiagnosticsTarget,
  type ExtensionDiagnosticPayload,
  type SanitizedDiagnosticsFrame,
  isDiagnosticsConsentEnabled,
  sanitizeDiagnosticsFrames,
} from './diagnosticsConsent.ts'
import { compiledExtensionTarget } from './extensionTarget.ts'

export type DiagnosticsSenderLike = {
  id?: string
  url?: string
  origin?: string
  tab?: { id?: number } | undefined
}

const pendingControllers = new Set<AbortController>()

/** Abort in-flight one-shot diagnostics work (consent withdrawal / kill switch). */
export function clearPendingDiagnosticsWork(): void {
  for (const controller of pendingControllers) {
    try {
      controller.abort()
    } catch {
      // ignore
    }
  }
  pendingControllers.clear()
}

export function trackDiagnosticsWork(): AbortController {
  const controller = new AbortController()
  pendingControllers.add(controller)
  const drop = () => {
    pendingControllers.delete(controller)
  }
  controller.signal.addEventListener('abort', drop, { once: true })
  return controller
}

export function pendingDiagnosticsWorkCount(): number {
  return pendingControllers.size
}

/** Trusted build meta — never trust payload release/target/manifest. */
export function trustedDiagnosticsBuildMeta(opts?: {
  getManifest?: () => chrome.runtime.Manifest
  extensionTarget?: string
}): {
  release: string
  manifest_version: number
  target: DiagnosticsTarget
} {
  const manifest =
    opts?.getManifest?.() ??
    (typeof chrome !== 'undefined' && chrome.runtime?.getManifest
      ? chrome.runtime.getManifest()
      : { version: '0.0.0', manifest_version: 3 })
  const version = typeof manifest.version === 'string' && manifest.version.trim()
    ? manifest.version.trim()
    : '0.0.0'
  const mv = typeof manifest.manifest_version === 'number' ? manifest.manifest_version : 3
  const rawTarget =
    opts?.extensionTarget ??
    compiledExtensionTarget()
  const target: DiagnosticsTarget =
    rawTarget === 'cws' || rawTarget === 'edge' || rawTarget === 'firefox' || rawTarget === 'development'
      ? rawTarget
      : 'development'
  return {
    release: `streamclone-pulse@${version}`,
    manifest_version: mv === 3 ? 3 : 3,
    target,
  }
}

export function isTrustedDiagnosticsSender(
  sender: DiagnosticsSenderLike,
  opts?: { runtimeId?: string },
): boolean {
  const runtimeId =
    opts?.runtimeId ??
    (typeof chrome !== 'undefined' && chrome.runtime?.id ? chrome.runtime.id : '')
  if (!runtimeId || !sender.id || sender.id !== runtimeId) return false

  if (typeof sender.url === 'string') {
    try {
      const u = new URL(sender.url)
      if (u.protocol === 'chrome-extension:' && u.hostname === runtimeId) return true
      // Firefox uses a per-profile moz-extension UUID for the URL hostname,
      // while MessageSender.id remains the stable Gecko add-on ID checked above.
      if (u.protocol === 'moz-extension:') return true
    } catch {
      // Content sender validation below handles ordinary tab URLs.
    }
  }

  // Content scripts: extension id match + Twitch tab URL.
  if (sender.tab && typeof sender.url === 'string') {
    try {
      const u = new URL(sender.url)
      if (u.protocol !== 'https:') return false
      return u.hostname === 'www.twitch.tv' || u.hostname.endsWith('.twitch.tv')
    } catch {
      return false
    }
  }
  return false
}

/** Derive surface from MessageSender — do not trust payload.surface. */
export function deriveDiagnosticsSurface(sender: DiagnosticsSenderLike): DiagnosticsSurface | null {
  if (typeof sender.url === 'string') {
    const url = sender.url
    if (url.includes('/popup/')) return 'popup'
    if (url.includes('/options/')) return 'options'
    if (url.includes('/background/') || url.includes('service-worker')) return 'background'
  }
  if (sender.tab) return 'content'
  // Extension page without tab and without recognizable path → background.
  if (
    !sender.tab &&
    (sender.url?.startsWith('chrome-extension://') || sender.url?.startsWith('moz-extension://'))
  ) {
    return 'background'
  }
  if (!sender.tab && !sender.url) return 'background'
  return null
}

export function classifyDiagnosticsError(err: unknown): DiagnosticsErrorClass {
  if (err == null) return 'unknown'
  const name = err instanceof Error ? err.name : ''
  const msg = err instanceof Error ? err.message : String(err)
  if (name === 'AbortError' || /abort/i.test(name)) return 'abort'
  if (name === 'TimeoutError' || /timeout/i.test(name) || /timeout/i.test(msg)) return 'timeout'
  if (
    name === 'TypeError' ||
    name === 'ReferenceError' ||
    name === 'RangeError' ||
    name === 'SyntaxError'
  ) {
    return 'type_error'
  }
  if (
    name === 'NetworkError' ||
    /failed to fetch|networkerror|load failed|net::/i.test(`${name} ${msg}`)
  ) {
    return 'network_error'
  }
  return 'unknown'
}

const STACK_FRAME_RE =
  /(?:(?:chrome|moz)-extension:\/\/[^/]+\/)?((?:content|background|popup|options)\/[A-Za-z0-9._/-]+\.js|chunks\/[A-Za-z0-9._-]+\.js):(\d+):(\d+)/

/** Extract allowlisted {bundle,line,column} only — never transmit raw stack text. */
export function framesFromErrorStack(stack: unknown): SanitizedDiagnosticsFrame[] {
  if (typeof stack !== 'string' || !stack) return []
  const raw: Array<{ bundle: string; line: number; column: number }> = []
  for (const line of stack.split('\n')) {
    const m = line.match(STACK_FRAME_RE)
    if (!m) continue
    raw.push({
      bundle: m[1],
      line: Number(m[2]),
      column: Number(m[3]),
    })
  }
  return sanitizeDiagnosticsFrames(raw)
}

export function isAllowlistedDiagnosticsBundle(bundle: string): boolean {
  if (DIAGNOSTICS_BUNDLE_ALLOWLIST.has(bundle)) return true
  if (bundle.startsWith('chunks/')) {
    const rest = bundle.slice('chunks/'.length)
    return Boolean(rest) && !rest.includes('/') && /^[a-z0-9._-]+$/i.test(rest)
  }
  return false
}

export interface EmitDiagnosticsInput {
  feature: DiagnosticsFeature
  event: DiagnosticsEvent
  error?: DiagnosticsErrorClass
  err?: unknown
  frames?: unknown
  /** Optional sendMessage impl (tests). */
  send?: (message: Record<string, unknown>) => Promise<unknown>
}

/**
 * One-shot fire-and-forget report via service worker.
 * Never includes error.message / raw stack. No retries / durable queue.
 */
export async function emitExtensionDiagnostic(input: EmitDiagnosticsInput): Promise<void> {
  if (!EXTENSION_DIAGNOSTICS_INGEST_ENABLED) return
  try {
    if (!(await isDiagnosticsConsentEnabled())) return
  } catch {
    return
  }

  const error = input.error ?? classifyDiagnosticsError(input.err)
  const frames =
    input.frames != null
      ? sanitizeDiagnosticsFrames(input.frames)
      : framesFromErrorStack(input.err instanceof Error ? input.err.stack : undefined)

  const message = {
    type: 'REPORT_EXTENSION_DIAGNOSTIC' as const,
    feature: input.feature,
    event: input.event,
    error,
    frames,
  }

  const send =
    input.send ??
    (async (msg: Record<string, unknown>) => {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return
      return chrome.runtime.sendMessage(msg)
    })

  try {
    await send(message)
  } catch {
    // Lossy by design.
  }
}

export function buildTrustedDiagnosticPayload(args: {
  feature: DiagnosticsFeature
  event: DiagnosticsEvent
  error: DiagnosticsErrorClass
  frames: SanitizedDiagnosticsFrame[]
  surface: DiagnosticsSurface
  build?: ReturnType<typeof trustedDiagnosticsBuildMeta>
}): ExtensionDiagnosticPayload {
  const build = args.build ?? trustedDiagnosticsBuildMeta()
  return {
    schema_version: 1,
    release: build.release,
    manifest_version: build.manifest_version,
    target: build.target,
    surface: args.surface,
    feature: args.feature,
    event: args.event,
    error: args.error,
    status: 'reported',
    frames: args.frames.slice(0, 20),
  }
}

/** Narrow content-script boundary emitters (uncaught + rejection). */
export function installContentDiagnosticsEmitters(opts?: {
  feature?: DiagnosticsFeature
  emit?: typeof emitExtensionDiagnostic
}): () => void {
  const feature = opts?.feature ?? 'overlay'
  const emit = opts?.emit ?? emitExtensionDiagnostic
  const onError = (event: ErrorEvent) => {
    void emit({
      feature,
      event: 'uncaught_error',
      err: event.error instanceof Error ? event.error : new Error('uncaught'),
      // Prefer stack frames from Error when present; never send event.message.
      frames: framesFromErrorStack(
        event.error instanceof Error ? event.error.stack : undefined,
      ),
    })
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    void emit({
      feature,
      event: 'unhandled_rejection',
      err: event.reason,
    })
  }
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}

/** Service-worker boundary emitters. */
export function installBackgroundDiagnosticsEmitters(opts?: {
  emit?: typeof emitExtensionDiagnostic
}): () => void {
  const emit = opts?.emit ?? emitExtensionDiagnostic
  const onError = (event: ErrorEvent) => {
    void emit({
      feature: 'service_worker',
      event: 'uncaught_error',
      err: event.error instanceof Error ? event.error : undefined,
      error: classifyDiagnosticsError(event.error),
      frames: framesFromErrorStack(event.error instanceof Error ? event.error.stack : undefined),
    })
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    void emit({
      feature: 'service_worker',
      event: 'unhandled_rejection',
      err: event.reason,
    })
  }
  const target: EventTarget | undefined =
    typeof self !== 'undefined' ? (self as unknown as EventTarget) : undefined
  if (!target?.addEventListener) return () => {}
  target.addEventListener('error', onError as EventListener)
  target.addEventListener('unhandledrejection', onRejection as EventListener)
  return () => {
    target.removeEventListener('error', onError as EventListener)
    target.removeEventListener('unhandledrejection', onRejection as EventListener)
  }
}
