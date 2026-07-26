import { describe, expect, it } from 'vitest'
import {
  gameSegmentKey,
  gameSegmentPlotBoundsByOffsets,
  gamesNormalizeDurationSeconds,
  normalizeGameSegments,
} from '../src/index.ts'

/** Real xqc 2026-07-12 game list (portal /games). */
const XQC_GAMES = [
  { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 10053 },
  { gameName: 'League of Legends', offsetSeconds: 10053, durationSeconds: 9369 },
  { gameName: 'Just Chatting', offsetSeconds: 19422, durationSeconds: 1490 },
  { gameName: 'ROBLOX', offsetSeconds: 20913, durationSeconds: 1149 },
  { gameName: 'Terraria', offsetSeconds: 22062, durationSeconds: 7070 },
  { gameName: 'Slay the Spire II', offsetSeconds: 29133, durationSeconds: 3069 },
  { gameName: 'Just Chatting', offsetSeconds: 32202, durationSeconds: 55237 },
] as const

describe('xqc 2026-07-12 Terraria/StS highlight after downsample', () => {
  // Full minute coverage ~289..32209; chart downsample keeps endpoints but shrinks length.
  const fullOffsets: number[] = []
  for (let offset = 289; offset <= 32209; offset += 60) fullOffsets.push(offset)
  if (fullOffsets.at(-1) !== 32209) fullOffsets.push(32209)

  const downsampledOffsets = [
    ...fullOffsets.filter((_, index) => index % 3 === 0),
    fullOffsets[fullOffsets.length - 1]!,
  ]
  // Unique sorted
  const chartOffsets = [...new Set(downsampledOffsets)].sort((a, b) => a - b)

  it('length*60 drops Terraria/StS while offset-span duration keeps them', () => {
    const broken = normalizeGameSegments(XQC_GAMES, Math.max(chartOffsets.length * 60, 60))
    expect(broken.map(game => game.gameName)).not.toContain('Terraria')
    expect(broken.map(game => game.gameName)).not.toContain('Slay the Spire II')

    const duration = gamesNormalizeDurationSeconds(chartOffsets, chartOffsets.length)
    expect(duration).toBeGreaterThan(29_000)
    const fixed = normalizeGameSegments(XQC_GAMES, duration)
    expect(fixed.map(game => game.gameName)).toContain('Terraria')
    expect(fixed.map(game => game.gameName)).toContain('Slay the Spire II')
  })

  it('resolves hover highlight bounds for Terraria and Slay the Spire II', () => {
    const duration = gamesNormalizeDurationSeconds(chartOffsets, chartOffsets.length)
    const segments = normalizeGameSegments(XQC_GAMES, duration)
    for (const name of ['Terraria', 'Slay the Spire II'] as const) {
      const segment = segments.find(game => game.gameName === name)
      expect(segment, name).toBeTruthy()
      const key = gameSegmentKey(segment!)
      const found = segments.find(game => gameSegmentKey(game) === key)
      const bounds = gameSegmentPlotBoundsByOffsets(found!, chartOffsets, 90, 876)
      expect(bounds, name).not.toBeNull()
      expect(bounds!.endX).toBeGreaterThan(bounds!.startX + 20)
    }
  })
})
