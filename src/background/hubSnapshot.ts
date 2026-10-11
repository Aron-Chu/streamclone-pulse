import { getBackendUrl } from '../shared/storage.ts'
import { slimHubSnapshot, type HubSnapshot } from '../shared/hubSnapshot.ts'
import { fetchWithTimeout, readResponseText } from './api.ts'

const SESSION_KEY = 'hubSnapshot:v1'
/** The hub itself refreshes about once a minute. */
const FRESH_MS = 60_000
/** An older snapshot still beats an empty popup while the hub is unreachable. */
const STALE_MS = 10 * 60_000

interface CachedHub {
  root: string
  at: number
  snapshot: HubSnapshot
}

export interface HubSnapshotDeps {
  now: () => number
  root: () => Promise<string>
  fetchHub: (root: string) => Promise<unknown>
  read: () => Promise<CachedHub | null>
  write: (value: CachedHub) => Promise<void>
}

/**
 * Public, unauthenticated read: no account or device credential is attached,
 * so opening the popup tells the server nothing about who opened it.
 */
async function fetchHub(root: string): Promise<unknown> {
  const res = await fetchWithTimeout(`${root}/v1/public/hub`, { headers: { Accept: 'application/json' }, credentials: 'omit' }, { timeoutMs: 8_000 })
  if (!res.ok) throw new Error(`hub ${res.status}`)
  return JSON.parse(await readResponseText(res))
}

const defaultDeps: HubSnapshotDeps = {
  now: () => Date.now(),
  root: () => getBackendUrl(),
  fetchHub,
  read: async () => {
    const stored = await chrome.storage.session.get(SESSION_KEY)
    return (stored[SESSION_KEY] as CachedHub | undefined) ?? null
  },
  write: value => chrome.storage.session.set({ [SESSION_KEY]: value }),
}

let inFlight: Promise<HubSnapshot> | null = null

/** A fresh-enough hub snapshot for the popup, shared by popups opened close together. */
export function loadHubSnapshot(deps: HubSnapshotDeps = defaultDeps): Promise<HubSnapshot> {
  inFlight ??= (async () => {
    const root = await deps.root()
    const cached = await deps.read().catch(() => null)
    const age = cached && cached.root === root ? deps.now() - cached.at : Infinity
    if (cached && age >= 0 && age < FRESH_MS) return cached.snapshot
    try {
      const snapshot = slimHubSnapshot(await deps.fetchHub(root))
      if (!snapshot) throw new Error('hub_invalid')
      await deps.write({ root, at: deps.now(), snapshot }).catch(() => undefined)
      return snapshot
    } catch (error) {
      if (cached && age >= 0 && age < STALE_MS) return cached.snapshot
      throw error
    }
  })().finally(() => { inFlight = null })
  return inFlight
}
