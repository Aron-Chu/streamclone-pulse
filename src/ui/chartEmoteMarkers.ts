import type { ExtensionEmote, ExtensionRollup } from '../shared/messages.ts'

export interface PlottedEmote {
  timestampMs: number
  offsetSeconds: number
  id: string
  provider: string
  name: string
  imageUrl?: string
  count: number
}

export interface PlottedEmoteMarker extends PlottedEmote {
  /** Position in the visible time domain, normalized to [0, 1]. */
  xFraction: number
  /** Pixel-space collision lane; lane 0 is the primary marker rail. */
  lane: number
  /** Number of raw emote entries represented by this marker. */
  eventCount: number
  /** Distinct emote names merged into this occupied cell. */
  clusteredNames: string[]
  /** Stable identity for React keys and marker focus state. */
  key: string
}

export interface PlottedEmoteMarkerLayout {
  markers: PlottedEmoteMarker[]
  /** Aggregate count remains truthful even when visual markers are capped. */
  totalCount: number
  totalEventCount: number
  hiddenMarkerCount: number
}

export interface PlottedEmoteMarkerOptions {
  pixelWidth: number
  fromOffsetSeconds?: number
  toOffsetSeconds?: number
  markerSpacingPx?: number
  maxMarkers?: number
  maxLanes?: number
}

interface CellGroup {
  identity: string
  emote: PlottedEmote
  eventCount: number
}

function providerKey(provider?: string): string {
  const normalized = provider?.trim().toLowerCase() ?? ''
  return normalized === '7tv' ? 'seventv' : normalized || 'unknown'
}

function emoteIdentity(emote: Pick<ExtensionEmote, 'id' | 'providerEmoteId' | 'provider' | 'name'>): string {
  const provider = providerKey(emote.provider)
  const id = emote.id?.trim() || emote.providerEmoteId?.trim() || emote.name.trim()
  return `${provider}:${id}:${emote.name.trim().toLowerCase()}`
}

function normalizedDomain(rollups: readonly ExtensionRollup[], options: PlottedEmoteMarkerOptions): {
  from: number
  to: number
} {
  const finiteOffsets = rollups
    .map(rollup => rollup.offsetSeconds)
    .filter(offsetSeconds => Number.isFinite(offsetSeconds))
  const first = finiteOffsets[0] ?? 0
  const last = finiteOffsets[finiteOffsets.length - 1] ?? first
  const from = Number.isFinite(options.fromOffsetSeconds) ? options.fromOffsetSeconds! : first
  const requestedTo = Number.isFinite(options.toOffsetSeconds) ? options.toOffsetSeconds! : last + 60
  return { from, to: Math.max(from, requestedTo) }
}

function cellForOffset(offsetSeconds: number, from: number, to: number, cellCount: number): number {
  if (cellCount <= 1 || to <= from) return 0
  const fraction = Math.min(1, Math.max(0, (offsetSeconds - from) / (to - from)))
  return Math.min(cellCount - 1, Math.floor(fraction * cellCount))
}

function compareGroups(left: CellGroup, right: CellGroup): number {
  return right.emote.count - left.emote.count
    || right.eventCount - left.eventCount
    || left.emote.name.localeCompare(right.emote.name)
    || left.identity.localeCompare(right.identity)
}

/**
 * Convert per-minute emote totals into a bounded marker rail.  Identical
 * emotes merge inside one pixel-space cell, collisions pick a deterministic
 * primary and secondary lane, and the cap only limits visual markers—not the
 * aggregate totals returned alongside them.
 */
export function buildPlottedEmoteMarkerLayout(
  rollups: readonly ExtensionRollup[],
  options: PlottedEmoteMarkerOptions,
): PlottedEmoteMarkerLayout {
  if (rollups.length === 0 || options.pixelWidth <= 0) {
    return { markers: [], totalCount: 0, totalEventCount: 0, hiddenMarkerCount: 0 }
  }

  const { from, to } = normalizedDomain(rollups, options)
  const markerSpacingPx = Math.max(12, options.markerSpacingPx ?? 28)
  const cellCount = Math.max(1, Math.ceil(options.pixelWidth / markerSpacingPx))
  const maxMarkers = Math.max(1, Math.floor(options.maxMarkers ?? cellCount * 2))
  const maxLanes = Math.max(1, Math.floor(options.maxLanes ?? 2))
  const cells = new Map<number, Map<string, CellGroup>>()
  let totalCount = 0
  let totalEventCount = 0

  for (const rollup of rollups) {
    if (rollup.missing || !Number.isFinite(rollup.offsetSeconds)) continue
    if (rollup.offsetSeconds < from || rollup.offsetSeconds > to) continue
    const cell = cellForOffset(rollup.offsetSeconds, from, to, cellCount)
    for (const source of rollup.topEmotes ?? []) {
      const count = Number.isFinite(source.count) ? Math.max(0, source.count) : 0
      if (count <= 0 || !source.name.trim()) continue
      totalCount += count
      totalEventCount += 1
      const identity = emoteIdentity(source)
      const byIdentity = cells.get(cell) ?? new Map<string, CellGroup>()
      const existing = byIdentity.get(identity)
      if (existing) {
        existing.emote.count += count
        existing.eventCount += 1
      } else {
        const emote: PlottedEmote = {
          timestampMs: Math.max(0, rollup.offsetSeconds) * 1000,
          offsetSeconds: rollup.offsetSeconds,
          id: source.id?.trim() || source.providerEmoteId?.trim() || source.name.trim(),
          provider: providerKey(source.provider),
          name: source.name.trim(),
          imageUrl: source.imageUrl,
          count,
        }
        byIdentity.set(identity, { identity, emote, eventCount: 1 })
      }
      cells.set(cell, byIdentity)
    }
  }

  const candidates: PlottedEmoteMarker[] = []
  let hiddenMarkerCount = 0
  for (const [cell, groupsByIdentity] of cells) {
    const groups = [...groupsByIdentity.values()].sort(compareGroups)
    if (groups.length === 0) continue
    const visibleGroups = groups.slice(0, maxLanes)
    hiddenMarkerCount += Math.max(0, groups.length - visibleGroups.length)
    const clusteredNames = groups.map(group => group.emote.name).slice(0, 3)
    visibleGroups.forEach((group, lane) => {
      const xFraction = cellCount <= 1 ? 0 : (cell + 0.5) / cellCount
      candidates.push({
        ...group.emote,
        xFraction,
        lane,
        eventCount: group.eventCount,
        clusteredNames,
        key: `${group.identity}@${cell}`,
      })
    })
  }

  if (candidates.length > maxMarkers) {
    const keep = [...candidates]
      .sort((left, right) => compareGroups(
        { identity: left.key, emote: left, eventCount: left.eventCount },
        { identity: right.key, emote: right, eventCount: right.eventCount },
      ) || left.xFraction - right.xFraction || left.key.localeCompare(right.key))
      .slice(0, maxMarkers)
    const keepKeys = new Set(keep.map(marker => marker.key))
    hiddenMarkerCount += candidates.filter(marker => !keepKeys.has(marker.key)).length
    candidates.splice(0, candidates.length, ...keep)
  }

  candidates.sort((left, right) => left.xFraction - right.xFraction || left.lane - right.lane || left.key.localeCompare(right.key))
  return { markers: candidates, totalCount, totalEventCount, hiddenMarkerCount }
}
