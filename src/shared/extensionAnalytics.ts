/**
 * RPR-5 product analytics emit (service worker).
 * Kill switch defaults OFF — no network until activation flips the constant.
 * No PostHog SDK in MV3; backend aggregates only.
 */

import { isAnalyticsConsentGranted } from './analyticsConsent.ts'
import { getBackendUrl } from './storage.ts'

/** Client kill switch — must stay false until hosted activation. */
export const EXTENSION_ANALYTICS_INGEST_ENABLED = false

export const ANALYTICS_EVENT_PULSE_LOAD_COMPLETED = 'pulse_load_completed' as const
export const ANALYTICS_EVENT_EXTENSION_ERROR_SHOWN = 'extension_error_shown' as const
/** Schema-reserved — never emit from the extension client. */
export const ANALYTICS_EVENT_SUPPORT_REPORT_SUBMITTED = 'support_report_submitted' as const

export type AnalyticsEmitEventName =
  | typeof ANALYTICS_EVENT_PULSE_LOAD_COMPLETED
  | typeof ANALYTICS_EVENT_EXTENSION_ERROR_SHOWN

export function shouldEmitAnalytics(opts: {
  consentOn: boolean
  ingestEnabled?: boolean
}): boolean {
  const ingestEnabled = opts.ingestEnabled ?? EXTENSION_ANALYTICS_INGEST_ENABLED
  return ingestEnabled === true && opts.consentOn === true
}

export type AnalyticsTransport = (body: { events: Array<{ name: AnalyticsEmitEventName }> }) => Promise<void>

let transportOverride: AnalyticsTransport | null = null

/** In-memory latches for the current activation (no durable identifier). */
let pulseLoadEmittedForActivation = false
let extensionErrorShownEmitted = false

/** Reset when a new user-visible activation begins. */
export function resetAnalyticsActivationLatches(): void {
  pulseLoadEmittedForActivation = false
  extensionErrorShownEmitted = false
}

/** Test-only. */
export function resetAnalyticsEmitLatchesForTest(): void {
  resetAnalyticsActivationLatches()
}

/** Test-only transport injection. */
export function setAnalyticsTransportForTest(transport: AnalyticsTransport | null): void {
  transportOverride = transport
}

async function defaultTransport(body: { events: Array<{ name: AnalyticsEmitEventName }> }): Promise<void> {
  const root = await getBackendUrl()
  await fetch(`${root}/v1/extension/analytics/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * Emit allowlisted aggregate events when consent is on and the kill switch allows.
 * Failures are swallowed — analytics must never break product paths.
 */
export async function emitAnalyticsEvents(
  events: AnalyticsEmitEventName[],
  opts?: { ingestEnabled?: boolean },
): Promise<void> {
  try {
    if (!events.length) return
    const consentOn = await isAnalyticsConsentGranted()
    if (!shouldEmitAnalytics({ consentOn, ingestEnabled: opts?.ingestEnabled })) {
      return
    }
    const transport = transportOverride ?? defaultTransport
    await transport({ events: events.map(name => ({ name })) })
  } catch {
    // swallow
  }
}

/**
 * Emit pulse_load_completed once per in-memory activation after user-visible
 * activation completes. Does not invent install/session identifiers.
 */
export async function emitPulseLoadCompletedOnce(
  opts?: { ingestEnabled?: boolean },
): Promise<void> {
  if (pulseLoadEmittedForActivation) return
  pulseLoadEmittedForActivation = true
  await emitAnalyticsEvents([ANALYTICS_EVENT_PULSE_LOAD_COMPLETED], opts)
}

/**
 * Emit extension_error_shown once while a user-visible error UI is shown.
 */
export async function emitExtensionErrorShownOnce(
  opts?: { ingestEnabled?: boolean },
): Promise<void> {
  if (extensionErrorShownEmitted) return
  extensionErrorShownEmitted = true
  await emitAnalyticsEvents([ANALYTICS_EVENT_EXTENSION_ERROR_SHOWN], opts)
}

/**
 * Content/UI helper: ask the service worker to emit (content scripts must not fetch).
 * Dedupes in-process without introducing an identifier.
 */
export function requestPulseLoadCompletedAnalytics(): void {
  if (pulseLoadEmittedForActivation) return
  pulseLoadEmittedForActivation = true
  try {
    void chrome.runtime
      .sendMessage({ type: 'EMIT_EXTENSION_ANALYTICS', name: ANALYTICS_EVENT_PULSE_LOAD_COMPLETED })
      .catch(() => {})
  } catch {
    // ignore
  }
}

export function requestExtensionErrorShownAnalytics(): void {
  if (extensionErrorShownEmitted) return
  extensionErrorShownEmitted = true
  try {
    void chrome.runtime
      .sendMessage({ type: 'EMIT_EXTENSION_ANALYTICS', name: ANALYTICS_EVENT_EXTENSION_ERROR_SHOWN })
      .catch(() => {})
  } catch {
    // ignore
  }
}
