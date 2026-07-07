import {
  hasMeaningfulGameSegments,
  normalizeGameSegments,
  type ChartGameSegment,
  type ChartMinuteRollup,
} from '@streamclone/pulse-charts'
import type { ExtensionEmote, ExtensionGameSegment, ExtensionRollup } from '../shared/messages.ts'
import { emoteSelectionKey } from './chatActivityEmotes.ts'

function minuteTsFromOffset(startedAt: string | undefined, offsetSeconds: number): string {
  if (startedAt) {
    const startMs = Date.parse(startedAt)
    if (Number.isFinite(startMs)) {
      return new Date(startMs + Math.max(0, offsetSeconds) * 1000).toISOString()
    }
  }
  return new Date(Math.max(0, offsetSeconds) * 1000).toISOString()
}

export function extensionRollupsToChartMinutes(
  rollups: ExtensionRollup[],
  startedAt?: string,
): ChartMinuteRollup[] {
  return rollups.map(rollup => {
    const emotes: Record<string, number> = {}
    for (const emote of rollup.topEmotes ?? []) {
      const key = emoteSelectionKey(emote)
      if (!key) continue
      emotes[key] = (emotes[key] ?? 0) + (emote.count ?? 0)
    }
    const viewerCount = rollup.viewerCount ?? 0
    return {
      minuteTs: minuteTsFromOffset(startedAt, rollup.offsetSeconds),
      viewerAvg: viewerCount,
      viewerMax: viewerCount,
      viewerLatest: viewerCount,
      viewerSamples: viewerCount > 0 ? 1 : 0,
      chatCount: rollup.chatCount ?? 0,
      totalEmoteCount: rollup.totalEmoteCount ?? rollup.sevenTvEmoteCount ?? 0,
      seventvEmoteCount: rollup.sevenTvEmoteCount ?? 0,
      emotes,
      missing: rollup.missing,
    }
  })
}

/** Live overlay chart: show current category when backend omits games (rc15 live gap). */
export function extensionGamesForOverviewChart(
  games: ExtensionGameSegment[] | undefined,
  category: string | undefined,
  durationSeconds: number,
): ExtensionGameSegment[] {
  if (games?.length) return games
  const gameName = String(category ?? '').trim()
  if (!gameName || durationSeconds <= 0) return []
  return [{
    gameName,
    offsetSeconds: 0,
    durationSeconds,
  }]
}

export function extensionGamesToChartGames(
  games: ExtensionGameSegment[] | undefined,
  durationSeconds: number,
): ChartGameSegment[] {
  const normalized = normalizeGameSegments(
    (games ?? []).map(game => ({
      gameName: game.gameName,
      boxArtUrl: game.boxArtUrl,
      offsetSeconds: game.offsetSeconds,
      durationSeconds: game.durationSeconds,
    })),
    durationSeconds,
  )
  if (!hasMeaningfulGameSegments(normalized, durationSeconds)) return []
  return normalized
}

export function emoteKeysFromExtension(
  catalog: ExtensionEmote[],
  selectedKeys: string[],
): Set<string> {
  const keys = new Set<string>()
  for (const key of selectedKeys.slice(0, 5)) {
    const emote = catalog.find(item => emoteSelectionKey(item) === key)
    if (emote) keys.add(emoteSelectionKey(emote))
  }
  return keys
}

export function chartRollupIndexForOffset(
  chartRollups: ChartMinuteRollup[],
  startedAt: string | undefined,
  offsetSeconds: number,
): number | null {
  if (!Number.isFinite(offsetSeconds) || chartRollups.length === 0) return null
  const targetMs = startedAt
    ? Date.parse(startedAt) + offsetSeconds * 1000
    : offsetSeconds * 1000
  if (!Number.isFinite(targetMs)) return null
  let best = 0
  let bestDist = Infinity
  chartRollups.forEach((rollup, index) => {
    const ms = Date.parse(rollup.minuteTs)
    if (!Number.isFinite(ms)) return
    const dist = Math.abs(ms - targetMs)
    if (dist < bestDist) {
      bestDist = dist
      best = index
    }
  })
  return best
}
