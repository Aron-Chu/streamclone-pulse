/** Versioned product-analytics consent (RPR-5). Separate from diagnostics. */

export const ANALYTICS_CONSENT_STORAGE = 'pulse-analytics-consent-v1'
export const ANALYTICS_CONSENT_SCHEMA_VERSION = 1 as const

export type AnalyticsConsentRecord = {
  schemaVersion: typeof ANALYTICS_CONSENT_SCHEMA_VERSION
  granted: boolean
  updatedAt: number
}

/** Fail-closed in-memory denial (storage write failures / forced withdrawal). */
let memoryDenial = false

/** Test-only reset. */
export function resetAnalyticsConsentMemoryForTest(): void {
  memoryDenial = false
}

export function denyAnalyticsConsentInMemory(): void {
  memoryDenial = true
}

export function clearAnalyticsConsentMemoryDenial(): void {
  memoryDenial = false
}

export function parseAnalyticsConsent(raw: unknown): AnalyticsConsentRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  if (rec.schemaVersion !== ANALYTICS_CONSENT_SCHEMA_VERSION) return null
  if (typeof rec.granted !== 'boolean') return null
  if (typeof rec.updatedAt !== 'number' || !Number.isFinite(rec.updatedAt)) return null
  return {
    schemaVersion: ANALYTICS_CONSENT_SCHEMA_VERSION,
    granted: rec.granted,
    updatedAt: Math.floor(rec.updatedAt),
  }
}

/** Missing, malformed, older schema, or in-memory denial ⇒ off. */
export async function isAnalyticsConsentGranted(
  storage: Pick<typeof chrome.storage.local, 'get'> = chrome.storage.local,
): Promise<boolean> {
  if (memoryDenial) return false
  try {
    const bag = await storage.get(ANALYTICS_CONSENT_STORAGE)
    const parsed = parseAnalyticsConsent(bag[ANALYTICS_CONSENT_STORAGE])
    return parsed?.granted === true
  } catch {
    return false
  }
}

/**
 * Persist analytics consent immediately.
 * On storage failure: deny in-memory and rethrow so UI can revert.
 */
export async function setAnalyticsConsentGranted(
  granted: boolean,
  storage: Pick<typeof chrome.storage.local, 'set' | 'remove'> = chrome.storage.local,
): Promise<AnalyticsConsentRecord> {
  if (!granted) {
    // Withdrawal: deny immediately even if storage remove fails.
    memoryDenial = true
    try {
      await storage.remove(ANALYTICS_CONSENT_STORAGE)
    } catch (err) {
      throw err
    }
    return {
      schemaVersion: ANALYTICS_CONSENT_SCHEMA_VERSION,
      granted: false,
      updatedAt: Date.now(),
    }
  }
  const record: AnalyticsConsentRecord = {
    schemaVersion: ANALYTICS_CONSENT_SCHEMA_VERSION,
    granted: true,
    updatedAt: Date.now(),
  }
  try {
    await storage.set({ [ANALYTICS_CONSENT_STORAGE]: record })
    memoryDenial = false
    return record
  } catch (err) {
    memoryDenial = true
    throw err
  }
}
