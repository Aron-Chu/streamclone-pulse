export type PulseDebugStep =
  | 'vod.discover.dom'
  | 'vod.discover.page'
  | 'vod.discover.gql'
  | 'vod.hint.api'
  | 'vod.archive.candidate'
  | 'vod.backfill.start'
  | 'vod.backfill.result'
  | 'vod.pulse.api'
  | 'vod.live.bridge'
  | 'vod.helix.health'
  | 'ui.jump'
  | 'ui.coverage'

export type PulseDebugLevel = 'info' | 'warn' | 'error'

export interface PulseDebugEntry {
  ts: number
  step: PulseDebugStep
  message: string
  data?: Record<string, unknown>
  level: PulseDebugLevel
}

const ENABLE_KEY = 'debugLoggingEnabled'
const LOG_KEY = 'pulseDebugLog'
const MAX_ENTRIES = 80

let cachedEnabled = false
let toggleListenerAttached = false
let debugWriteQueue: Promise<void> = Promise.resolve()

export async function initPulseDebug(): Promise<void> {
  const stored = await chrome.storage.sync.get(ENABLE_KEY)
  cachedEnabled = Boolean(stored[ENABLE_KEY])
  if (!toggleListenerAttached) {
    chrome.storage.onChanged.addListener(onDebugToggleChanged)
    toggleListenerAttached = true
  }
}

function onDebugToggleChanged(
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
): void {
  if (area !== 'sync' || !changes[ENABLE_KEY]) return
  cachedEnabled = Boolean(changes[ENABLE_KEY].newValue)
}

export function isPulseDebugEnabled(): boolean {
  return cachedEnabled
}

export async function setPulseDebugEnabled(enabled: boolean): Promise<void> {
  cachedEnabled = enabled
  await chrome.storage.sync.set({ [ENABLE_KEY]: enabled })
  if (!enabled) {
    await debugWriteQueue
    await chrome.storage.local.remove(LOG_KEY)
  }
}

export async function getPulseDebugEnabled(): Promise<boolean> {
  const stored = await chrome.storage.sync.get(ENABLE_KEY)
  return Boolean(stored[ENABLE_KEY])
}

export async function getPulseDebugLog(): Promise<PulseDebugEntry[]> {
  const stored = await chrome.storage.local.get(LOG_KEY)
  return (stored[LOG_KEY] as PulseDebugEntry[] | undefined) ?? []
}

export async function clearPulseDebugLog(): Promise<void> {
  await chrome.storage.local.remove(LOG_KEY)
}

export async function pulseDebug(
  step: PulseDebugStep,
  message: string,
  data?: Record<string, unknown>,
  level: PulseDebugLevel = 'info',
): Promise<void> {
  if (!cachedEnabled) return

  // Expected VOD discovery misses must never hit console.warn — Chrome Web Store
  // Errors aggregates warn/error from content scripts even with debug logging on.
  const consoleLevel: PulseDebugLevel =
    step.startsWith('vod.discover.') && /no archive/i.test(message) ? 'info' : level

  const entry: PulseDebugEntry = { ts: Date.now(), step, message, data, level: consoleLevel }
  const logFn =
    consoleLevel === 'error' ? console.error : consoleLevel === 'warn' ? console.warn : console.info
  // Keep console payload as a single string — Chrome's extension Errors page stringifies
  // extra object args as "[object Object]" and surfaces warn/error as store listing noise.
  const detail =
    data && Object.keys(data).length > 0
      ? ` ${safeJson(data)}`
      : ''
  logFn(`[Pulse ${step}] ${message}${detail}`)

  const write = async () => {
    const stored = await chrome.storage.local.get(LOG_KEY)
    const entries = (stored[LOG_KEY] as PulseDebugEntry[] | undefined) ?? []
    entries.push(entry)
    while (entries.length > MAX_ENTRIES) {
      entries.shift()
    }
    await chrome.storage.local.set({ [LOG_KEY]: entries })
  }
  // Jump start/end and background discovery can log concurrently. Serialize
  // writes so the later event cannot overwrite the earlier one with a stale
  // read of the ring buffer.
  debugWriteQueue = debugWriteQueue.then(write, write)
  await debugWriteQueue
}

function safeJson(data: Record<string, unknown>): string {
  try {
    return JSON.stringify(data)
  } catch {
    return ''
  }
}

/** Format the latest VOD-related log lines for overlay error copy. */
export async function summarizeVodDebugBlockers(
  options?: {
    backendVodResolved?: boolean
    backendHelixEnabled?: boolean | null
    navigationVodId?: string | null
  },
): Promise<string | null> {
  const entries = await getPulseDebugLog()
  return summarizeVodDebugBlockersFromEntries(entries, options)
}

export function summarizeVodDebugBlockersFromEntries(
  entries: PulseDebugEntry[],
  options?: {
    backendVodResolved?: boolean
    backendHelixEnabled?: boolean | null
    navigationVodId?: string | null
  },
): string | null {
  if (options?.backendVodResolved) {
    return vodLocalDiscoveryDiagnostic(entries)
  }
  return interpretVodDebugBlockers(entries, options)
}

export function interpretVodDebugBlockers(
  entries: PulseDebugEntry[],
  options?: {
    backendHelixEnabled?: boolean | null
    navigationVodId?: string | null
  },
): string | null {
  const vodEntries = entries.filter(entry => entry.step.startsWith('vod.') || entry.step === 'ui.coverage')
  if (vodEntries.length === 0) return null

  const last = (step: PulseDebugStep) => [...vodEntries].reverse().find(entry => entry.step === step)
  const parts: string[] = []

  const helixEnabled = typeof options?.backendHelixEnabled === 'boolean'
    ? options.backendHelixEnabled
    : latestHelixEvidence(vodEntries)
  if (helixEnabled === false) {
    parts.push('Backend Helix off (needs TWITCH_OAUTH_CLIENT_ID/SECRET)')
  } else if (helixEnabled == null) {
    parts.push('Backend analytics outdated (no helixEnabled — redeploy latest)')
  }

  const navigationVodId = String(options?.navigationVodId ?? '').trim()
  const pulse = last('vod.pulse.api')
  if (pulse?.data?.vodId == null) {
    if (navigationVodId) {
      parts.push(
        `Past Streams has videoId ${navigationVodId}; API vodId still null (not linked for backfill)`,
      )
    } else {
      parts.push('API vodId still null')
    }
  }

  appendLocalVodDiscoveryNotes(vodEntries, parts)

  const hint = last('vod.hint.api')
  if (hint?.data?.status === 401 || hint?.data?.authRequired === true) {
    parts.push('VOD discovered locally, but hosted vod-hint persistence requires extension authentication')
  } else if (hint?.level === 'warn') {
    parts.push('vod-hint route missing on backend (404 until redeploy)')
  }

  const backfill = last('vod.backfill.start')
  if (backfill?.level === 'error') {
    parts.push(String(backfill.message))
  }

  if (parts.length === 0) {
    const latest = vodEntries.slice(-3)
    return latest.map(entry => `${entry.step}: ${entry.message}`).join(' · ')
  }
  return parts.join(' · ')
}

function latestHelixEvidence(entries: PulseDebugEntry[]): boolean | undefined {
  let latest: { ts: number; value: boolean } | undefined
  for (const entry of entries) {
    if (entry.step !== 'vod.helix.health' && entry.step !== 'vod.pulse.api') continue
    if (typeof entry.data?.helixEnabled !== 'boolean') continue
    if (!latest || entry.ts >= latest.ts) {
      latest = { ts: entry.ts, value: entry.data.helixEnabled }
    }
  }
  return latest?.value
}

function appendLocalVodDiscoveryNotes(vodEntries: PulseDebugEntry[], parts: string[]): void {
  const last = (step: PulseDebugStep) => [...vodEntries].reverse().find(entry => entry.step === step)

  const dom = last('vod.discover.dom')
  if (dom?.message.includes('no archive')) {
    parts.push('no VOD id in Twitch page HTML (content script)')
  }

  const page = last('vod.discover.page')
  if (page?.message.includes('no archive')) {
    parts.push(`no VOD id in ${page.data?.scannedScripts ?? 0} page scripts`)
  }

  const gql = last('vod.discover.gql')
  if (gql?.message.includes('no archive')) {
    const source = gql.data?.source
    const streamId = gql.data?.streamId
    if (source === 'stream.archiveVideo') {
      parts.push('Twitch has no live archiveVideo yet (VOD storage off or stream just started)')
    } else if (source === 'videos.archive') {
      parts.push('Twitch GQL returned no archive list')
    } else if (!source) {
      parts.push('Twitch GQL returned no archive id')
    }
    if (typeof streamId === 'string' && streamId) {
      parts.push(`Twitch stream ${streamId}`)
    }
    const gqlErrors = gql.data?.gqlErrors
    if (Array.isArray(gqlErrors) && gqlErrors.length > 0) {
      const blocked = gqlErrors.some(error => {
        const text = String(error)
        return text.includes('Failed to fetch') || text === 'network_error' || text === 'fetch_failed'
      })
      if (blocked) {
        parts.push('GQL blocked (disable ad blocker for gql.twitch.tv or whitelist Twitch)')
      } else if (gqlErrors.some(error => String(error).includes('Client-ID') || String(error).includes('Client-Id'))) {
        parts.push('GQL Client-ID rejected from extension — using page context now (reload extension)')
      } else {
        parts.push(`GQL: ${gqlErrors.slice(0, 2).join(', ')}`)
      }
    }
  }
}

/** Local page/GQL discovery notes only — for footnotes when backend already linked the VOD. */
export function vodLocalDiscoveryDiagnostic(entries: PulseDebugEntry[]): string | null {
  const vodEntries = entries.filter(entry => entry.step.startsWith('vod.discover.'))
  if (vodEntries.length === 0) return null
  const parts: string[] = []
  appendLocalVodDiscoveryNotes(vodEntries, parts)
  return parts.length > 0 ? parts.join(' · ') : null
}
