import releaseManifestJson from './release-notes.json'
import { isExtensionContextAlive } from './storage.ts'

export const LAST_DISMISSED_RELEASE_VERSION_KEY = 'lastDismissedReleaseVersion'

export interface ReleaseEntry {
  version: string
  status: string
  releasedAt: string | null
  title: string
  summary: string
  new?: string[]
  improved?: string[]
  fixed?: string[]
  knownIssues?: string[]
  links?: { details?: string; support?: string }
}

interface ReleaseManifest {
  schemaVersion: number
  currentVersion: string
  releases: ReleaseEntry[]
}

const releaseManifest: ReleaseManifest = releaseManifestJson
const ALL_RELEASES: ReadonlyArray<ReleaseEntry> = releaseManifest.releases

export const CURRENT_RELEASE: ReleaseEntry | undefined =
  ALL_RELEASES.find(release => release.version === releaseManifest.currentVersion) ??
  ALL_RELEASES[0]

export function allReleases(): ReadonlyArray<ReleaseEntry> {
  return ALL_RELEASES
}

export function installedExtensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version || releaseManifest.currentVersion
  } catch {
    return releaseManifest.currentVersion
  }
}

function isBenignStorageError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '')
  return /Access to storage is not allowed|Extension context invalidated|storage is not allowed from this context/i.test(
    message,
  )
}

async function syncGet(key: string): Promise<string | null> {
  if (!isExtensionContextAlive()) return null
  try {
    const stored = (await chrome.storage.sync.get(key)) as Record<string, unknown>
    const value = stored[key]
    return typeof value === 'string' && value.length > 0 ? value : null
  } catch (err) {
    if (isBenignStorageError(err)) return null
    throw err
  }
}

async function syncSet(key: string, value: string): Promise<void> {
  if (!isExtensionContextAlive()) return
  try {
    await chrome.storage.sync.set({ [key]: value })
  } catch (err) {
    if (isBenignStorageError(err)) return
    throw err
  }
}

export function isNewerVersion(installed: string, dismissed: string | null): boolean {
  if (dismissed === null) return true
  const installedParts = installed.split('.').map(part => Number.parseInt(part, 10) || 0)
  const dismissedParts = dismissed.split('.').map(part => Number.parseInt(part, 10) || 0)
  const maxLen = Math.max(installedParts.length, dismissedParts.length)
  for (let i = 0; i < maxLen; i += 1) {
    const a = installedParts[i] ?? 0
    const b = dismissedParts[i] ?? 0
    if (a > b) return true
    if (a < b) return false
  }
  return false
}

export function shouldShowReleaseBanner(installed: string, dismissed: string | null): boolean {
  if (dismissed === null) return true
  return isNewerVersion(installed, dismissed)
}

export async function getLastDismissedReleaseVersion(): Promise<string | null> {
  return syncGet(LAST_DISMISSED_RELEASE_VERSION_KEY)
}

export async function setLastDismissedReleaseVersion(version: string): Promise<void> {
  await syncSet(LAST_DISMISSED_RELEASE_VERSION_KEY, version)
}
