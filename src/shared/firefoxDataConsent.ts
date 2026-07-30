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
 * Firefox 142+ has a second, browser-owned consent for technical/interaction
 * data. Product analytics and diagnostics must honor it in addition to their
 * separate StreamPulse toggles.
 */
export async function hasFirefoxTechnicalDataConsent(options?: {
  target?: string
  permissions?: FirefoxDataCollectionPermissions | null
}): Promise<boolean> {
  if ((options?.target ?? currentTarget()) !== 'firefox') return true
  const permissions = options?.permissions ?? defaultPermissions()
  if (!permissions) return false
  try {
    const granted = await permissions.getAll()
    return (
      Array.isArray(granted.data_collection) &&
      granted.data_collection.includes(FIREFOX_TECHNICAL_DATA_PERMISSION)
    )
  } catch {
    return false
  }
}

export async function requestFirefoxTechnicalDataConsent(options?: {
  target?: string
  permissions?: FirefoxDataCollectionPermissions | null
}): Promise<boolean> {
  if ((options?.target ?? currentTarget()) !== 'firefox') return true
  const permissions = options?.permissions ?? defaultPermissions()
  if (!permissions?.request) return false
  if (await hasFirefoxTechnicalDataConsent({ target: 'firefox', permissions })) return true
  try {
    return await permissions.request({
      data_collection: [FIREFOX_TECHNICAL_DATA_PERMISSION],
    })
  } catch {
    return false
  }
}
