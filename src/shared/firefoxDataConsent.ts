import { compiledExtensionTarget } from './extensionTarget.ts'

export const FIREFOX_TECHNICAL_DATA_PERMISSION = 'technicalAndInteraction' as const

export interface FirefoxDataCollectionPermissions {
  getAll(): Promise<{ data_collection?: unknown }>
  request?(permissions: { data_collection: string[] }): Promise<boolean>
}

function currentTarget(): string {
  return compiledExtensionTarget()
}

function defaultPermissions(): FirefoxDataCollectionPermissions | null {
  if (typeof chrome === 'undefined' || !chrome.permissions) return null
  return chrome.permissions as unknown as FirefoxDataCollectionPermissions
}

/**
 * Firefox desktop 140+ has a second, browser-owned consent for technical/interaction
 * data. Product analytics and diagnostics must honor it in addition to their
 * separate StreamPulse toggles.
 */
export type FirefoxTechnicalDataConsentState = 'granted' | 'denied' | 'unavailable'

export async function readFirefoxTechnicalDataConsent(options?: {
  target?: string
  permissions?: FirefoxDataCollectionPermissions | null
}): Promise<FirefoxTechnicalDataConsentState> {
  if ((options?.target ?? currentTarget()) !== 'firefox') return 'granted'
  const permissions = options?.permissions ?? defaultPermissions()
  if (!permissions) return 'unavailable'
  try {
    const granted = await permissions.getAll()
    return (
      Array.isArray(granted.data_collection) &&
      granted.data_collection.includes(FIREFOX_TECHNICAL_DATA_PERMISSION)
    ) ? 'granted' : 'denied'
  } catch {
    return 'unavailable'
  }
}

export async function hasFirefoxTechnicalDataConsent(options?: {
  target?: string
  permissions?: FirefoxDataCollectionPermissions | null
}): Promise<boolean> {
  return (await readFirefoxTechnicalDataConsent(options)) === 'granted'
}

export async function requestFirefoxTechnicalDataConsent(options?: {
  target?: string
  permissions?: FirefoxDataCollectionPermissions | null
}): Promise<boolean> {
  if ((options?.target ?? currentTarget()) !== 'firefox') return true
  const permissions = options?.permissions ?? defaultPermissions()
  if (!permissions?.request) return false
  try {
    // Firefox requires this call to happen in the original user-action handler.
    // An awaited getAll() first would lose that context; an already-granted
    // permission is handled by Firefox without prompting again.
    return await permissions.request({
      data_collection: [FIREFOX_TECHNICAL_DATA_PERMISSION],
    })
  } catch {
    return false
  }
}
