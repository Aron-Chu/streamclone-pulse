import type { ExtensionHealthResponse, PulsePayload } from '../shared/messages.ts'
import { getBackendUrl } from '../shared/storage.ts'

export async function fetchExtensionHealth(baseUrl?: string): Promise<ExtensionHealthResponse> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetch(`${root}/v1/extension/health`)
  if (!res.ok) {
    throw new Error(`health ${res.status}`)
  }
  return res.json() as Promise<ExtensionHealthResponse>
}

export async function fetchPulseChannel(login: string, baseUrl?: string): Promise<PulsePayload> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetch(`${root}/v1/extension/pulse/channels/${encodeURIComponent(login)}`)
  if (!res.ok) {
    throw new Error(`pulse ${res.status}`)
  }
  return res.json() as Promise<PulsePayload>
}

export async function postWatchChannel(login: string, baseUrl?: string): Promise<void> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetch(`${root}/v1/analytics/channels/${encodeURIComponent(login)}/watch`, {
    method: 'POST',
  })
  if (!res.ok && res.status !== 202) {
    throw new Error(`watch ${res.status}`)
  }
}
