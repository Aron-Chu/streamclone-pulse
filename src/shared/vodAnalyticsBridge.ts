export const VOD_ANALYTICS_BRIDGE_STORAGE_KEY = 'sp.vodAnalyticsBridge.v1'
export const VOD_ANALYTICS_BRIDGE_TTL_MS = 15 * 60 * 1000

export interface VodAnalyticsBridge {
  vodId: string
  login: string
  streamId?: string
  savedAtMs: number
}

export function vodAnalyticsBridgeIsFresh(
  record: VodAnalyticsBridge | null | undefined,
  nowMs: number,
  ttlMs = VOD_ANALYTICS_BRIDGE_TTL_MS,
): boolean {
  if (!record) return false
  return nowMs - record.savedAtMs >= 0 && nowMs - record.savedAtMs <= ttlMs
}

export function resolveVodAnalyticsBridge(
  record: VodAnalyticsBridge | null | undefined,
  vodId: string,
  nowMs: number,
): Pick<VodAnalyticsBridge, 'login' | 'streamId'> | null {
  const wanted = vodId.trim()
  if (!wanted || !record || record.vodId.trim() !== wanted) return null
  if (!vodAnalyticsBridgeIsFresh(record, nowMs)) return null
  const login = record.login.trim().toLowerCase()
  if (!login || login.startsWith('__vod__:')) return null
  return {
    login,
    streamId: record.streamId?.trim() || undefined,
  }
}

export async function rememberVodAnalyticsBridge(input: {
  vodId: string
  login: string
  streamId?: string
}): Promise<void> {
  const vodId = input.vodId.trim()
  const login = input.login.trim().toLowerCase()
  if (!vodId || !login || login.startsWith('__vod__:')) return
  const record: VodAnalyticsBridge = {
    vodId,
    login,
    streamId: input.streamId?.trim() || undefined,
    savedAtMs: Date.now(),
  }
  await writeBridge(record)
}

export async function readVodAnalyticsBridge(vodId: string): Promise<Pick<VodAnalyticsBridge, 'login' | 'streamId'> | null> {
  const record = await readBridge()
  return resolveVodAnalyticsBridge(record, vodId, Date.now())
}

function storageAreas(): chrome.storage.StorageArea[] {
  const areas: chrome.storage.StorageArea[] = []
  if (chrome.storage?.session) areas.push(chrome.storage.session)
  if (chrome.storage?.local) areas.push(chrome.storage.local)
  return areas
}

async function writeBridge(record: VodAnalyticsBridge): Promise<void> {
  for (const area of storageAreas()) {
    try {
      await area.set({ [VOD_ANALYTICS_BRIDGE_STORAGE_KEY]: record })
      return
    } catch {
      // Try the next available area. The VOD endpoint remains authoritative.
    }
  }
}

async function readBridge(): Promise<VodAnalyticsBridge | null> {
  for (const area of storageAreas()) {
    try {
      const stored = await area.get(VOD_ANALYTICS_BRIDGE_STORAGE_KEY)
      const record = stored[VOD_ANALYTICS_BRIDGE_STORAGE_KEY]
      if (record && typeof record === 'object') {
        return record as VodAnalyticsBridge
      }
    } catch {
      // Try the next available area.
    }
  }
  return null
}
