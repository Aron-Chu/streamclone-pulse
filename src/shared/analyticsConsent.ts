/** Versioned product-analytics consent (RPR-5). Separate from diagnostics. */
import {
  hasFirefoxTechnicalDataConsent,
  readFirefoxTechnicalDataConsent,
  requestFirefoxTechnicalDataConsent,
} from './firefoxDataConsent.ts'

export const ANALYTICS_CONSENT_STORAGE = 'pulse-analytics-consent-v1'
export const ANALYTICS_CONSENT_SCHEMA_VERSION = 1 as const

export type AnalyticsConsentRecord = {
  schemaVersion: typeof ANALYTICS_CONSENT_SCHEMA_VERSION
  granted: boolean
  updatedAt: number
}

/** Fail-closed in-memory denial (storage write failures / forced withdrawal). */
let memoryDenial = false
let consentGeneration = 0
let changeTail: Promise<void> = Promise.resolve()
let requestedChangeGeneration = 0
const withdrawalListeners = new Set<() => void>()
const ANALYTICS_GRANT_TICKETS_STORAGE = 'pulse-analytics-grant-tickets'
const MAX_PENDING_GRANT_TICKETS = 64
type ConsentReadStorage = { get(key: string): Promise<Record<string, unknown>> }
type ConsentWriteStorage = {
  set(items: Record<string, unknown>): Promise<void>
  remove(key: string): Promise<void>
}
type GrantTicketStorage = ConsentReadStorage & ConsentWriteStorage

/**
 * Tickets stay in browser-session storage, never telemetry or sync storage.
 * Serialize all reads/writes with consent changes in the background runtime.
 */
export function issueAnalyticsConsentGrantTicket(
  storage: GrantTicketStorage = chrome.storage.session,
): Promise<string> {
  const generation = consentGeneration
  const change = changeTail.then(async () => {
    if (generation !== consentGeneration) throw new Error('analytics_consent_superseded')
    const tickets = await readGrantTickets(storage)
    if (generation !== consentGeneration) throw new Error('analytics_consent_superseded')
    const ticket = crypto.randomUUID()
    await storage.set({ [ANALYTICS_GRANT_TICKETS_STORAGE]: [...tickets.slice(-(MAX_PENDING_GRANT_TICKETS - 1)), ticket] })
    if (generation !== consentGeneration) throw new Error('analytics_consent_superseded')
    return ticket
  })
  changeTail = change.then(() => undefined, () => undefined)
  return change
}

async function readGrantTickets(storage: GrantTicketStorage): Promise<string[]> {
  const bag = await storage.get(ANALYTICS_GRANT_TICKETS_STORAGE)
  const value = bag[ANALYTICS_GRANT_TICKETS_STORAGE]
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_PENDING_GRANT_TICKETS ||
      !value.every(ticket => typeof ticket === 'string')) throw new Error('analytics_consent_ticket_storage_invalid')
  return value
}

/** Test-only reset. */
export function resetAnalyticsConsentMemoryForTest(): void {
  memoryDenial = false
}

export function denyAnalyticsConsentInMemory(): void {
  memoryDenial = true
  consentGeneration += 1
  for (const listener of withdrawalListeners) listener()
}

export function clearAnalyticsConsentMemoryDenial(): void {
  memoryDenial = false
}

/** Cancel in-memory work in the same runtime when consent is withdrawn. */
export function onAnalyticsConsentWithdrawal(listener: () => void): () => void {
  withdrawalListeners.add(listener)
  return () => withdrawalListeners.delete(listener)
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

export type AnalyticsConsentState = 'granted' | 'denied' | 'unavailable'

/** Keep failed reads distinct from a confirmed denial for the Settings UI. */
export async function readAnalyticsConsentState(
  storage: ConsentReadStorage = chrome.storage.local,
): Promise<AnalyticsConsentState> {
  if (memoryDenial) return 'denied'
  const generation = consentGeneration
  try {
    const bag = await storage.get(ANALYTICS_CONSENT_STORAGE)
    const parsed = parseAnalyticsConsent(bag[ANALYTICS_CONSENT_STORAGE])
    if (parsed?.granted !== true || memoryDenial || generation !== consentGeneration) return 'denied'
    const platformState = await readFirefoxTechnicalDataConsent()
    if (memoryDenial || generation !== consentGeneration) return 'denied'
    return platformState
  } catch {
    return 'unavailable'
  }
}

/** Missing, malformed, older schema, denial, or failed read ⇒ do not send. */
export async function isAnalyticsConsentGranted(
  storage: ConsentReadStorage = chrome.storage.local,
): Promise<boolean> {
  return (await readAnalyticsConsentState(storage)) === 'granted'
}

/**
 * Persist analytics consent immediately.
 * On storage failure: deny in-memory and rethrow so UI can revert.
 */
export function setAnalyticsConsentGranted(
  granted: boolean,
  storage: ConsentWriteStorage = chrome.storage.local,
  options?: {
    requireExistingPlatformPermission?: boolean
    requireGrantTicket?: boolean
    grantTicket?: string
    ticketStorage?: GrantTicketStorage
  },
): Promise<AnalyticsConsentRecord> {
  // This runs synchronously, before any pending storage write or removal.
  if (!granted) {
    denyAnalyticsConsentInMemory()
  }
  const generation = consentGeneration
  const change = changeTail.then(async () => {
    if (!granted) {
      // Acknowledged withdrawal must invalidate tickets even after a worker
      // restart. Try both session operations; never report success if both fail.
      let ticketClearFailed = false
      try {
        await (options?.ticketStorage ?? chrome.storage.session).remove(ANALYTICS_GRANT_TICKETS_STORAGE)
      } catch {
        try {
          await (options?.ticketStorage ?? chrome.storage.session).set({ [ANALYTICS_GRANT_TICKETS_STORAGE]: [] })
        } catch {
          ticketClearFailed = true
        }
      }
      const record: AnalyticsConsentRecord = {
        schemaVersion: ANALYTICS_CONSENT_SCHEMA_VERSION,
        granted: false,
        updatedAt: Date.now(),
      }
      try {
        await storage.remove(ANALYTICS_CONSENT_STORAGE)
      } catch {
        // A denied record is also durable if removal alone fails. If both
        // operations fail, report failure and keep this worker denied.
        await storage.set({ [ANALYTICS_CONSENT_STORAGE]: record })
      }
      if (ticketClearFailed) throw new Error('analytics_consent_ticket_clear_failed')
      return record
    }

    if (generation !== consentGeneration) throw new Error('analytics_consent_superseded')
    if (options?.requireGrantTicket) {
      const ticketStorage = options.ticketStorage ?? chrome.storage.session
      const tickets = await readGrantTickets(ticketStorage)
      if (!options.grantTicket || !tickets.includes(options.grantTicket)) {
        throw new Error('analytics_consent_superseded')
      }
      await ticketStorage.set({
        [ANALYTICS_GRANT_TICKETS_STORAGE]: tickets.filter(ticket => ticket !== options.grantTicket),
      })
      if (generation !== consentGeneration) throw new Error('analytics_consent_superseded')
    }
    const platformGranted = options?.requireExistingPlatformPermission
      ? await hasFirefoxTechnicalDataConsent()
      : await requestFirefoxTechnicalDataConsent()
    if (!platformGranted) {
      denyAnalyticsConsentInMemory()
      throw new Error('analytics_platform_permission_denied')
    }
    if (generation !== consentGeneration) throw new Error('analytics_consent_superseded')
    const record: AnalyticsConsentRecord = {
      schemaVersion: ANALYTICS_CONSENT_SCHEMA_VERSION,
      granted: true,
      updatedAt: Date.now(),
    }
    try {
      await storage.set({ [ANALYTICS_CONSENT_STORAGE]: record })
    } catch (err) {
      denyAnalyticsConsentInMemory()
      throw err
    }
    if (generation !== consentGeneration) throw new Error('analytics_consent_superseded')
    memoryDenial = false
    return record
  })
  // A failed change must not prevent a subsequent withdrawal from removing an
  // earlier grant. Only the service worker owns production consent writes.
  changeTail = change.then(() => undefined, () => undefined)
  return change
}

/** Prepare before the click, so Firefox's permission request keeps its user gesture. */
export async function prepareAnalyticsConsentGrant(): Promise<string> {
  const response = await chrome.runtime.sendMessage({ type: 'PREPARE_ANALYTICS_CONSENT_GRANT' })
  if (!response || response.ok !== true || typeof response.grantTicket !== 'string') {
    throw new Error('analytics_consent_prepare_failed')
  }
  return response.grantTicket
}

/** Settings requests a worker-owned change; only the page requests Firefox's permission. */
export async function requestAnalyticsConsentChange(granted: boolean, grantTicket?: string): Promise<void> {
  const generation = ++requestedChangeGeneration
  if (granted && !grantTicket) throw new Error('analytics_consent_prepare_required')
  if (granted && !(await requestFirefoxTechnicalDataConsent())) {
    throw new Error('analytics_platform_permission_denied')
  }
  if (generation !== requestedChangeGeneration) throw new Error('analytics_consent_superseded')
  const response = await chrome.runtime.sendMessage(granted
    ? { type: 'SET_ANALYTICS_CONSENT', granted: true, grantTicket }
    : { type: 'SET_ANALYTICS_CONSENT', granted: false })
  if (generation !== requestedChangeGeneration) throw new Error('analytics_consent_superseded')
  if (!response || response.ok !== true) {
    throw new Error(response?.error === 'analytics_consent_superseded'
      ? 'analytics_consent_superseded' : 'analytics_consent_update_failed')
  }
}
