import type { MomentContextState } from '../../../../src/ui/library/MomentPreview.tsx'
import type { MomentPresentation } from '../../../../src/ui/library/MomentMedia.tsx'

/** Illustrative backend-shaped data only; never used in the shipping extension. */
export const demoContexts: Readonly<Record<string, MomentContextState>> = {
  one: { kind: 'ready', value: {
    // Copied from the preceding read-only audit, not refreshed measurements.
    provenance: 'fixture', capturedAt: Date.now(), coverage: 'partial', windowLabel: '3 measured minutes from the audit',
    samples: [502, 328, 390].map((messages, index) => ({ offsetSeconds: 12261 + index * 60, messages })),
    selectedMessages: 328, selectedEmotes: 297, topEmotes: [{ name: 'LO', count: 37 }, { name: 'EZ', count: 37 }, { name: 'LOL', count: 30 }],
  } },
  two: { kind: 'ready', value: {
    provenance: 'fixture', capturedAt: Date.UTC(2026, 8, 4, 18), coverage: 'partial', windowLabel: '7-minute context',
    samples: [51, null, 117, 416, 268, null, 83].map((messages, index) => ({ offsetSeconds: 2100 + index * 60, messages })),
    selectedMessages: 416, selectedViewers: 18500, selectedEmotes: 520,
    // Illustrative counts, not these emotes' measured usage in xQc's stream.
    // Static 7TV artwork IDs reused from the existing landing fixture catalog.
    topEmotes: [
      { name: 'forsenPls', provider: '7TV', count: 156, staticImageUrl: 'https://cdn.7tv.app/emote/01GB8EQNJ8000497KFBZWNSDFZ/2x_static.webp' },
      { name: 'Clap', provider: '7TV', count: 104, staticImageUrl: 'https://cdn.7tv.app/emote/01GAM8EFQ00004MXFXAJYKA859/2x_static.webp' },
      { name: 'WAYTOODANK', provider: '7TV', count: 26, staticImageUrl: 'https://cdn.7tv.app/emote/01G98W833R0000BRQD106P0ZNT/2x_static.webp' },
    ],
  } },
  three: { kind: 'unavailable', reason: 'This bookmark has no saved analysis snapshot. The source VOD is also unavailable; your note is still here.' },
  four: { kind: 'loading' },
}

export const demoPresentations: Readonly<Record<string, MomentPresentation>> = {
  one: { gameAtMoment: 'Halloween: The Game', analysisUrl: 'http://127.0.0.1:5173/analytics/xqc/321274489178#t=12321' },
  two: { gameAtMoment: 'Just Chatting', signal: { label: 'Chat · 2.4× its recent baseline', basis: 'Compared with the preceding 15 measured minutes of this stream.', illustrative: true } },
  three: { gameAtMoment: 'Minecraft' },
  four: {},
}
