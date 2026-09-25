import type { ExtensionHealthResponse } from '../shared/messages.ts'

export const HEALTH_SUCCESS_TTL_MS = 30_000
export const HEALTH_FAILURE_TTL_MS = 5_000

export type ExtensionHealthCacheResult =
  | { ok: true; value: ExtensionHealthResponse; checkedAt: number; cached: boolean }
  | { ok: false; error: string; checkedAt: number; cached: boolean }

type CacheEntry =
  | { ok: true; value: ExtensionHealthResponse; checkedAt: number }
  | { ok: false; error: string; checkedAt: number }

function messageForError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'health_failed')
  return message.trim().slice(0, 160) || 'health_failed'
}

export function createExtensionHealthCache(options: { now?: () => number } = {}) {
  const now = options.now ?? Date.now
  const entries = new Map<string, CacheEntry>()

  return {
    async read(
      backendUrl: string,
      loader: () => Promise<ExtensionHealthResponse>,
      options: { force?: boolean } = {},
    ): Promise<ExtensionHealthCacheResult> {
      const key = backendUrl.trim()
      const currentTime = now()
      const cached = entries.get(key)
      const ttl = cached?.ok ? HEALTH_SUCCESS_TTL_MS : HEALTH_FAILURE_TTL_MS
      if (!options.force && cached && currentTime - cached.checkedAt < ttl) {
        return cached.ok
          ? { ok: true, value: cached.value, checkedAt: cached.checkedAt, cached: true }
          : { ok: false, error: cached.error, checkedAt: cached.checkedAt, cached: true }
      }
      try {
        const value = await loader()
        if (!value.ok) {
          const entry: CacheEntry = { ok: false, error: 'health_not_ok', checkedAt: currentTime }
          entries.set(key, entry)
          return { ok: false, error: entry.error, checkedAt: entry.checkedAt, cached: false }
        }
        const entry: CacheEntry = { ok: true, value, checkedAt: currentTime }
        entries.set(key, entry)
        return { ok: true, value: entry.value, checkedAt: entry.checkedAt, cached: false }
      } catch (error) {
        const entry: CacheEntry = { ok: false, error: messageForError(error), checkedAt: currentTime }
        entries.set(key, entry)
        return { ok: false, error: entry.error, checkedAt: entry.checkedAt, cached: false }
      }
    },
    clear(backendUrl?: string) {
      if (backendUrl == null) entries.clear()
      else entries.delete(backendUrl.trim())
    },
  }
}
