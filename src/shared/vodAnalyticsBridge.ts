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
  return { login, streamId: record.streamId?.trim() || undefined }
}

export async function readVodAnalyticsBridge(
  vodId: string,
): Promise<Pick<VodAnalyticsBridge, 'login' | 'streamId'> | null> {
  const record = await readVodAnalyticsBridgeRecord()
  return resolveVodAnalyticsBridge(record, vodId, Date.now())
}

export async function rememberVodAnalyticsBridge(input: {
  vodId: string
  login: string
  streamId?: string
}): Promise<void> {
  const vodId = input.vodId.trim()
  const login = input.login.trim().toLowerCase()
  if (!vodId || !login || login.startsWith('__vod__:')) return
  await writeVodAnalyticsBridgeRecord({
    vodId,
    login,
    streamId: input.streamId?.trim() || undefined,
    savedAtMs: Date.now(),
  })
}

function storageArea(): chrome.storage.StorageArea | null {
  return chrome.storage?.session ?? chrome.storage?.local ?? null
}

async function writeVodAnalyticsBridgeRecord(record: VodAnalyticsBridge): Promise<void> {
  try {
    const area = storageArea()
    if (!area) return
    await area.set({ [VOD_ANALYTICS_BRIDGE_STORAGE_KEY]: record })
  } catch {
    // Storage is an optimization; the VOD endpoint remains authoritative.
  }
}

async function readVodAnalyticsBridgeRecord(): Promise<VodAnalyticsBridge | null> {
  try {
    const area = storageArea()
    if (!area) return null
    const stored = await area.get(VOD_ANALYTICS_BRIDGE_STORAGE_KEY)
    const record = stored[VOD_ANALYTICS_BRIDGE_STORAGE_KEY]
    if (!record || typeof record !== 'object') return null
    return record as VodAnalyticsBridge
  } catch {
    return null
  }
}
