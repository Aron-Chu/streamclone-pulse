import type { FigmaMomentRow } from './figmaSessionAnalytics'
import type { HubEmote, HubLiveChannel } from './publicHub'
import {
  buildEmoteLookup,
  isBucketWithinLiveHorizon,
  resolveMomentEmotesPerMin,
  resolveMomentViewers,
} from './pulseMomentsUtils'

export interface PulseMomentEnrichContext {
  liveChannels: Array<Pick<HubLiveChannel, 'login' | 'startedAt' | 'viewers'>>
  categoryByLogin?: Map<string, string>
}

/** Normalize a hub moment row before render (category, emote identity, viewers). */
export function enrichPulseMomentRow(
  moment: FigmaMomentRow,
  ctx: PulseMomentEnrichContext,
): FigmaMomentRow {
  let row: FigmaMomentRow = { ...moment }

  if (!row.category?.trim() && row.login) {
    const category = ctx.categoryByLogin?.get(row.login.toLowerCase())
    if (category) row = { ...row, category }
  }

  const emotesPerMin = resolveMomentEmotesPerMin(row)
  if (emotesPerMin != null && emotesPerMin > 0 && row.emotesPerMin == null) {
    row = { ...row, emotesPerMin }
  }

  const hasTopEmotes = row.topEmotes?.some((emote) => emote.name?.trim())
  if (!hasTopEmotes && row.topEmoteCode?.trim()) {
    row = {
      ...row,
      topEmotes: [
        {
          name: row.topEmoteCode.trim(),
          count: emotesPerMin ?? undefined,
        },
      ],
    }
  }

  const hasMinuteViewers = row.viewers != null && Number.isFinite(row.viewers) && row.viewers > 0
  if (!hasMinuteViewers) {
    const at = row.at ?? (row.streamStartedAt != null && row.offsetSeconds != null
      ? row.streamStartedAt + row.offsetSeconds * 1000
      : undefined)
    if (at == null || isBucketWithinLiveHorizon(at)) {
      const viewers = resolveMomentViewers(row, ctx.liveChannels)
      if (viewers != null && viewers > 0) {
        row = { ...row, viewers }
      }
    }
  }

  return row
}

export function enrichPulseMomentRows(
  moments: FigmaMomentRow[],
  ctx: PulseMomentEnrichContext,
): FigmaMomentRow[] {
  return moments.map((moment) => enrichPulseMomentRow(moment, ctx))
}

/** Build emote lookup from the rows currently visible in the table/inspector. */
export function buildEmoteLookupFromMoments(
  moments: FigmaMomentRow[],
  topEmotes: HubEmote[] = [],
): Map<string, HubEmote> {
  const rows: HubEmote[] = [...topEmotes]
  for (const moment of moments) {
    for (const emote of moment.topEmotes ?? []) {
      if (!emote.name?.trim()) continue
      rows.push({
        name: emote.name,
        provider: emote.provider,
        imageUrl: emote.imageUrl,
        count: emote.count ?? 0,
        sharePct: emote.sharePct ?? 0,
      })
    }
  }
  return buildEmoteLookup(rows)
}
