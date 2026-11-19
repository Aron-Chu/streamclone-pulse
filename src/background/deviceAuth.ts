import { readPrivateRecord, writePrivateRecord } from './privateExtensionStorage.ts'
import { DEVICE_CREDENTIAL_REVISION_KEY, DEFAULT_BACKEND_URL } from '../shared/storage.ts'
import type { DeviceAuthState } from '../shared/messages.ts'

export const DEVICE_CREDENTIAL_STORAGE_KEY = `deviceCredential:${DEFAULT_BACKEND_URL}`

export interface DeviceCredential {
  token: string
  principalId: string
  deviceId: string
  expiresAt: string
  principalKind: 'device'
}

export function isDeviceCredential(value: unknown): value is DeviceCredential {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.token === 'string'
    && /^spdev_[a-f0-9]{64}$/.test(record.token)
    && typeof record.principalId === 'string'
    && /^[a-f0-9]{64}$/.test(record.principalId)
    && typeof record.deviceId === 'string'
    && /^dev_[a-f0-9]{32}$/.test(record.deviceId)
    && typeof record.expiresAt === 'string'
    && Number.isFinite(Date.parse(record.expiresAt))
    && record.principalKind === 'device'
  )
}

export function isDeviceCredentialLive(credential: DeviceCredential | null): credential is DeviceCredential {
  return Boolean(credential && Date.parse(credential.expiresAt) > Date.now())
}

export function isDeviceCredentialInvalidatedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /(?:\b401\b|\b403\b|invalid_authorization|device_authorization_required|device_identity_mismatch|account_authorization_required|account_identity_changed)/i.test(message)
}

export function classifyDeviceAuthError(error: unknown): DeviceAuthState {
  if (isDeviceCredentialInvalidatedError(error)) return 'unauthorized'
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/device_cap_reached|\b409\b/i.test(message)) return 'cap'
  if (/\b408\b|\b425\b|\b429\b|\b5\d\d\b|timeout|cancelled|network|fetch/i.test(message)) return 'retry'
  return 'failure'
}

/** Keep UI diagnostics useful without ever echoing request headers or response bodies. */
export function safeDeviceAuthErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/^(?:device_(?:enroll|rotate|revoke) \d{3}|extension_me_[a-z0-9_]+|device_[a-z0-9_]+|invalid_beta_key|device_auth_hosted_only|extension_api_(?:timeout|cancelled|invalid_[a-z_]+)|pulse_[a-z_]+)$/.test(message)) {
    return message
  }
  return fallback
}

// One worker owns the record. Queue migration, expiry and explicit mutations
// so a late migration or an expired read cannot overwrite a newer rotation.
let pending = Promise.resolve()
let migrated = false
let reportedStorageError = false
const EMPTY_DEVICE_RECORD = false // A durable marker also prevents re-import after revocation.

async function migrateLegacyRecord(): Promise<void> {
  const key = DEVICE_CREDENTIAL_STORAGE_KEY
  const stored = await chrome.storage.local.get(key)
  if (await readPrivateRecord(key) === undefined) {
    const legacy = stored[key]
    await writePrivateRecord(key, isDeviceCredential(legacy) && isDeviceCredentialLive(legacy) ? legacy : EMPTY_DEVICE_RECORD)
  }
  // Commit IndexedDB before removing the only copy. On interruption the
  // private record wins, and the next worker retries the remaining cleanup.
  if (key in stored) await chrome.storage.local.remove(key)
  migrated = true
}

function withDeviceStore<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(async () => {
    if (!migrated) await migrateLegacyRecord()
    return operation()
  })
  pending = result.then(
    () => { reportedStorageError = false },
    () => {
      if (!reportedStorageError) console.warn('device_credential_storage_unavailable')
      reportedStorageError = true
    },
  )
  return result
}

async function replaceDeviceRecord(credential: DeviceCredential | typeof EMPTY_DEVICE_RECORD): Promise<void> {
  await writePrivateRecord(DEVICE_CREDENTIAL_STORAGE_KEY, credential)
  // A failed UI notification must not turn a committed rotation into a failed enrollment.
  await chrome.storage.local.set({ [DEVICE_CREDENTIAL_REVISION_KEY]: crypto.randomUUID() }).catch(() => undefined)
}

export function getDeviceCredential(): Promise<DeviceCredential | null> {
  return withDeviceStore(async () => {
    const record = await readPrivateRecord(DEVICE_CREDENTIAL_STORAGE_KEY)
    if (isDeviceCredential(record) && isDeviceCredentialLive(record)) return record
    if (record !== EMPTY_DEVICE_RECORD) await replaceDeviceRecord(EMPTY_DEVICE_RECORD)
    return null
  }).catch(() => null)
}

export async function setDeviceCredential(credential: DeviceCredential): Promise<void> {
  if (!isDeviceCredential(credential) || !isDeviceCredentialLive(credential)) throw new Error('invalid_device_credential')
  await withDeviceStore(() => replaceDeviceRecord(credential))
}

export function clearDeviceCredential(): Promise<void> {
  return withDeviceStore(() => replaceDeviceRecord(EMPTY_DEVICE_RECORD))
}
