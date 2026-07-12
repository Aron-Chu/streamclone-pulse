import { describe, expect, it } from 'vitest'
import {
  coverageMeta,
  formatLeadingEmoteShare,
  formatMoverVelocity,
  formatTopMoversHonestyNote,
  hubChatPerMinDisplay,
} from '../src/ui/components/analytics/hubFormat'

describe('formatLeadingEmoteShare', () => {
  it('names the leading emote and percentage', () => {
    const copy = formatLeadingEmoteShare([{ name: 'KEKW', sharePct: 29 }], 29)
    expect(copy.label).toBe('#1 emote share')
    expect(copy.value).toBe('29%')
    expect(copy.sub).toBe('KEKW · 29% of all emotes in this window')
    expect(copy.title).toContain('KEKW')
  })

  it('falls back when no leader emote is present', () => {
    const copy = formatLeadingEmoteShare([], 0)
    expect(copy.value).toBe('—')
    expect(copy.sub).toContain('Shows when emote rollups exist')
  })
})

describe('formatTopMoversHonestyNote', () => {
  it('explains IRC pool vs roster live when movers are sparse', () => {
    const note = formatTopMoversHonestyNote(
      { rosterLive: 68, collectorTracking: 55, poolSize: 40, windowMinutes: 30 },
      2,
    )
    expect(note).toContain('55')
    expect(note).toContain('68')
    expect(note).toContain('30m')
    expect(note).toContain('bounded IRC rollup pool')
  })

  it('returns null when enough movers are present', () => {
    expect(
      formatTopMoversHonestyNote({ rosterLive: 68, collectorTracking: 55 }, 8),
    ).toBeNull()
  })
})

describe('formatMoverVelocity', () => {
  it('uses max emote rate and formats chat secondary', () => {
    const labels = formatMoverVelocity({ emotesPerMin: 412, seventvPerMin: 180, chatPerMin: 95 })
    expect(labels.emoteLabel).toBe('412/m')
    expect(labels.chatLabel).toBe('95 chat/m')
  })
})

describe('hubChatPerMinDisplay', () => {
  it('shows dash with tooltip for stats_only zero chat', () => {
    const cell = hubChatPerMinDisplay({ chatPerMin: 0, coverageState: 'stats_only' })
    expect(cell.text).toBe('—')
    expect(cell.muted).toBe(true)
    expect(cell.title).toContain('Metadata only — no chat coverage')
  })

  it('shows compact chat when rollups exist', () => {
    const cell = hubChatPerMinDisplay({ chatPerMin: 1200, coverageState: 'synced' })
    expect(cell.text).toBe('1.2K')
  })
})

describe('coverageMeta', () => {
  it.each([
    ['synced', 'Chat tracked (IRC)'],
    ['collecting', 'Chat tracked (IRC)'],
    ['chat_only', 'Chat tracked (IRC)'],
    ['warming', 'Warming'],
    ['viewer_only', 'Metadata only — no chat coverage'],
    ['stats_only', 'Metadata only — no chat coverage'],
  ] as const)('maps %s to the canonical coverage label', (state, label) => {
    expect(coverageMeta(state).label).toBe(label)
  })
})
