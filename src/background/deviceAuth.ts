import { DEFAULT_BACKEND_URL } from '../shared/storage.ts'
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
  return /(?:\b401\b|\b403\b|invalid_authorization|device_authorization_required|device_identity_mismatch)/i.test(message)
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

export async function getDeviceCredential(): Promise<DeviceCredential | null> {
  try {
    const stored = await chrome.storage.local.get(DEVICE_CREDENTIAL_STORAGE_KEY)
    const value = stored[DEVICE_CREDENTIAL_STORAGE_KEY]
    if (!isDeviceCredential(value) || !isDeviceCredentialLive(value)) {
      if (value != null) await chrome.storage.local.remove(DEVICE_CREDENTIAL_STORAGE_KEY)
      return null
    }
    return value
  } catch {
    return null
  }
}

export async function setDeviceCredential(credential: DeviceCredential): Promise<void> {
  if (!isDeviceCredential(credential)) throw new Error('invalid_device_credential')
  await chrome.storage.local.set({ [DEVICE_CREDENTIAL_STORAGE_KEY]: credential })
}

export async function clearDeviceCredential(): Promise<void> {
  await chrome.storage.local.remove(DEVICE_CREDENTIAL_STORAGE_KEY)
}
