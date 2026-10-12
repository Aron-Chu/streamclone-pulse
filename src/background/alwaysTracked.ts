import type { DeviceCredential } from './deviceAuth.ts'
import { isDeviceCredentialLive } from './deviceAuth.ts'

export interface AlwaysTrackedPorts {
  hosted: () => Promise<boolean>
  credential: () => Promise<DeviceCredential | null>
  fetchHosted: () => Promise<string[]>
  fetchLocal: () => Promise<string[]>
}

/**
 * GET_ALWAYS_TRACKED for a Twitch page: whether `login` is on the watchlist.
 * The hosted watchlist belongs to a device key, so without a live one the
 * request could only answer 401: answer "not tracked" without asking.
 * Content pages get only the current channel, never the whole list.
 */
export async function pageAlwaysTracked(login: string, ports: AlwaysTrackedPorts): Promise<string[]> {
  const hosted = await ports.hosted()
  if (hosted && !isDeviceCredentialLive(await ports.credential())) return []
  const channels = hosted ? await ports.fetchHosted() : await ports.fetchLocal()
  return channels.filter(channel => channel === login)
}
