import type { FigmaSessionViewModel } from './figmaSessionAnalytics'

/** Deterministic demo session matching Figma Make xQc / Minecraft featured block. */
export function buildDemoSessionViewModel(): FigmaSessionViewModel {
  const login = 'xqc'
  const streamId = 'demo-stream-xqc'

  const moments = [
    { offsetSeconds: 18 * 60 + 34, score: 99, label: '7TV cascade after impossible save', chatPerMin: 1171, viewerDelta: '+3.8K', topEmoteCode: 'KEKW', confidence: 99, vodState: 'synced' },
    { offsetSeconds: 73 * 60 + 8, score: 96, label: 'Raid lands + creator callout', chatPerMin: 1044, viewerDelta: '+7.2K', topEmoteCode: 'PogChamp', confidence: 97, vodState: 'synced' },
    { offsetSeconds: 47 * 60 + 22, score: 91, label: 'Near wipe, chat flips negative', chatPerMin: 821, viewerDelta: '+1.9K', topEmoteCode: 'monkaS', confidence: 94, vodState: 'synced' },
    { offsetSeconds: 102 * 60 + 10, score: 82, label: 'Clip-worthy one liner', chatPerMin: 611, viewerDelta: '+940', topEmoteCode: 'OMEGALUL', confidence: 86, vodState: 'partial' },
    { offsetSeconds: 58 * 60 + 15, score: 77, label: 'Hype train trigger', chatPerMin: 524, viewerDelta: '+620', topEmoteCode: 'PauseChamp', confidence: 81, vodState: 'synced' },
    { offsetSeconds: 88 * 60 + 44, score: 71, label: 'VOD highlight flagged by mod', chatPerMin: 448, viewerDelta: '+380', topEmoteCode: 'FeelsBadMan', confidence: 74, vodState: 'synced' },
  ]

  const chartPoints = Array.from({ length: 60 }, (_, i) => {
    const offsetSeconds = i * 120
    const wave = Math.sin(i / 4) * 30 + Math.sin(i / 8) * 15
    const spike = i === 9 ? 85 : i === 24 ? 72 : i === 37 ? 90 : i === 51 ? 68 : 0
    const heat = Math.min(100, Math.round(35 + wave + spike))
    return {
      offsetSeconds,
      chatNorm: Math.min(100, Math.round(heat * 0.9)),
      viewersNorm: Math.min(100, Math.round(40 + wave * 0.8 + spike * 0.5)),
      emotesNorm: Math.min(100, Math.round(30 + wave * 0.6 + spike * 0.7)),
      heat,
    }
  })

  return {
    state: 'ready',
    demo: true,
    reason: 'preview_layout',
    login,
    displayName: 'xQc',
    streamId,
    category: 'Minecraft',
    startedAt: new Date().toISOString(),
    viewers: 84200,
    chatPerMin: 1171,
    seventvPerMin: 438,
    peakCount: 7,
    dataCoveragePct: 99,
    moments: moments.map((m) => ({
      ...m,
    })),
    chartPoints,
    bursts: [
      { code: 'KEKW', count: 4821, deltaPct: 38, peakOffset: '00:18', sharePct: 100 },
      { code: 'PogChamp', count: 3204, deltaPct: 24, peakOffset: '01:13', sharePct: 66 },
      { code: 'monkaS', count: 2891, deltaPct: 19, peakOffset: '00:47', sharePct: 60 },
      { code: 'OMEGALUL', count: 2341, deltaPct: 15, peakOffset: '00:18', sharePct: 48 },
      { code: 'PauseChamp', count: 1923, deltaPct: 12, peakOffset: '01:42', sharePct: 40 },
      { code: 'FeelsBadMan', count: 1567, deltaPct: 9, peakOffset: '01:28', sharePct: 32 },
    ],
    coverageTruth: [
      { label: 'VOD available', value: 'Yes · 2h 01m', ok: true },
      { label: 'Chat replay', value: 'Live sync', ok: true },
      { label: 'Source conf.', value: '99%', ok: true },
      { label: 'Backfill status', value: 'None needed', ok: true },
      { label: 'Data freshness', value: '< 2s lag', ok: true },
      { label: '7TV coverage', value: 'Partial · 93%', ok: false },
    ],
    vodHref: undefined,
  }
}
