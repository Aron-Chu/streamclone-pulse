/** Thin local-storage helpers for consent modules (trusted extension contexts). */

export async function localStorageGet(
  keys?: string | string[] | null,
): Promise<Record<string, unknown>> {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) return {}
    return (await chrome.storage.local.get(keys ?? null)) as Record<string, unknown>
  } catch {
    return {}
  }
}

export async function localStorageSet(items: Record<string, unknown>): Promise<void> {
  try {
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) return
    await chrome.storage.local.set(items)
  } catch {
    // ignore
  }
}
