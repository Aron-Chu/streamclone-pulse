import { getBackendUrl } from './apiClient'

/** Matches extension options schema (`storage.ts` DEFAULT_POLL_INTERVAL_MS). */
export const DEFAULT_COPY_CONFIG_POLL_MS = 30_000

export interface HealthResult {
  ok: boolean
  version?: string
  latencyMs?: number
  error?: string
}

export interface CopyConfigPayload {
  backendUrl: string
  betaKey: string
  pollIntervalMs: number
}

export function detectMixedContent(url: string): boolean {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    return parsed.protocol === 'http:' && host !== 'localhost' && host !== '127.0.0.1'
  } catch {
    return false
  }
}

export function serializeCopyConfig(payload: CopyConfigPayload): string {
  return JSON.stringify(payload, null, 2)
}

export function buildCopyConfig(params: {
  backendUrl: string
  betaKey: string
  pollIntervalMs?: number
}): CopyConfigPayload {
  return {
    backendUrl: params.backendUrl.trim().replace(/\/+$/, ''),
    betaKey: params.betaKey.trim(),
    pollIntervalMs: params.pollIntervalMs ?? DEFAULT_COPY_CONFIG_POLL_MS,
  }
}

export async function checkExtensionHealth(backendUrl?: string): Promise<HealthResult> {
  const base = (backendUrl ?? getBackendUrl()).replace(/\/+$/, '')
  const started = performance.now()

  try {
    const response = await fetch(`${base}/v1/extension/health`, {
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: 'application/json' },
    })
    const latencyMs = Math.round(performance.now() - started)
    if (!response.ok) {
      return { ok: false, latencyMs, error: `HTTP ${response.status}` }
    }
    const payload = (await response.json()) as { ok?: boolean; version?: string }
    return {
      ok: Boolean(payload.ok),
      version: typeof payload.version === 'string' ? payload.version : undefined,
      latencyMs,
    }
  } catch (error) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : 'Unreachable',
    }
  }
}

export type SetupTroubleState =
  | 'not_installed'
  | 'unreachable'
  | 'unauthorized'
  | 'mixed_content'
  | 'version_mismatch'
  | 'connected'

export const TROUBLE_COPY: Record<
  SetupTroubleState,
  { title: string; body: string; action?: string }
> = {
  not_installed: {
    title: 'Extension not installed',
    body: 'Install the StreamPulse extension to connect.',
    action: 'Add to Chrome',
  },
  unreachable: {
    title: 'Backend unreachable',
    body: "Can't reach StreamPulse at the configured URL. Check your connection or try again.",
    action: 'Retry',
  },
  unauthorized: {
    title: 'Beta key required',
    body: 'This beta needs a key. Paste your beta key in the extension options.',
    action: 'Get a key',
  },
  mixed_content: {
    title: 'HTTPS required',
    body: 'The backend URL must be https. Update it to https://api.streampulse.stream.',
    action: 'Update URL',
  },
  version_mismatch: {
    title: 'Extension update needed',
    body: 'Update the extension for the latest Pulse features.',
    action: 'Update extension',
  },
  connected: {
    title: 'Connected',
    body: 'StreamPulse backend is reachable.',
  },
}

export function formatConnectedMessage(version: string | undefined, latencyMs: number | undefined): string {
  const versionLabel = version ? `Streamclone ${version}` : 'Streamclone'
  const latencyLabel = typeof latencyMs === 'number' ? `${latencyMs}ms` : '—'
  return `● Connected — ${versionLabel}, ${latencyLabel}.`
}
