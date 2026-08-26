export interface EmoteMarketPreviewFixture {
  generatedAt: string
  currentWindow: { start: string; end: string; label: string }
  comparisonWindow: { start: string; end: string; label: string }
  breadth: Array<{ name: string; provider: string; channelSharePct: number; channelCount: number; measuredChannels: number }>
  concentration: Array<{ label: string; sharePct: number; color: string }>
  rotation: Array<{ name: string; provider: string; previousRank?: number; currentRank: number; status: 'new' | 'up' | 'down' | 'flat' }>
  providers: Array<{ provider: string; currentSharePct: number; previousSharePct: number; color: string }>
}

/** Deterministic design/test fixture. Never presented as production analytics. */
export const EMOTE_MARKET_PREVIEW_FIXTURE: EmoteMarketPreviewFixture = {
  generatedAt: '2026-08-26T12:00:00Z',
  currentWindow: { start: '2026-08-26T11:30:00Z', end: '2026-08-26T12:00:00Z', label: 'Latest 30 min' },
  comparisonWindow: { start: '2026-08-26T11:00:00Z', end: '2026-08-26T11:30:00Z', label: 'Prior 30 min' },
  breadth: [
    { name: 'LUL', provider: 'Twitch', channelSharePct: 63, channelCount: 151, measuredChannels: 240 },
    { name: 'OMEGALUL', provider: '7TV', channelSharePct: 41, channelCount: 98, measuredChannels: 240 },
    { name: 'KEKW', provider: '7TV', channelSharePct: 29, channelCount: 70, measuredChannels: 240 },
  ],
  concentration: [
    { label: 'Top 1', sharePct: 22, color: '#a78bfa' },
    { label: 'Next 4', sharePct: 35, color: '#8b5cf6' },
    { label: 'Next 5', sharePct: 18, color: '#7c3aed' },
    { label: 'Long tail', sharePct: 25, color: '#4c1d95' },
  ],
  rotation: [
    { name: 'OMEGALUL', provider: '7TV', previousRank: 6, currentRank: 2, status: 'up' },
    { name: 'LUL', provider: 'Twitch', previousRank: 1, currentRank: 1, status: 'flat' },
    { name: 'catJAM', provider: '7TV', currentRank: 5, status: 'new' },
    { name: 'KEKW', provider: '7TV', previousRank: 3, currentRank: 7, status: 'down' },
  ],
  providers: [
    { provider: '7TV', currentSharePct: 58, previousSharePct: 51, color: '#86efac' },
    { provider: 'Twitch', currentSharePct: 25, previousSharePct: 30, color: '#8b5cf6' },
    { provider: 'BTTV', currentSharePct: 9, previousSharePct: 10, color: '#fb7185' },
    { provider: 'FFZ', currentSharePct: 6, previousSharePct: 7, color: '#fbbf24' },
    { provider: 'Other', currentSharePct: 2, previousSharePct: 2, color: '#94a3b8' },
  ],
}
