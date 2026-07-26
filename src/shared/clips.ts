import type { ExtensionClip } from './messages.ts'

/** Pick the clip with the highest viewCount; null when empty or all zero views. */
export function pickTopClip(items: ExtensionClip[]): ExtensionClip | null {
  if (items.length === 0) return null
  let best: ExtensionClip | null = null
  for (const clip of items) {
    const views = clip.viewCount ?? 0
    if (!best || views > (best.viewCount ?? 0)) {
      best = clip
    }
  }
  return best
}

export function clipWindowBounds(
  startedAt?: string,
  isLive?: boolean,
): { startedAt: string; endedAt: string } {
  const now = new Date()
  const endedAt = now.toISOString()
  if (startedAt && isLive) {
    return { startedAt, endedAt }
  }
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  return { startedAt: weekAgo.toISOString(), endedAt }
}
