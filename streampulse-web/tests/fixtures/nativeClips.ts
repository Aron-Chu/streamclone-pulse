import { vi } from 'vitest'

/** One clip as GET /v1/public/clips sends it (schemaVersion 1). */
export function rawNativeClip(overrides: Record<string, unknown> = {}) {
  return {
    id: 'BraveClipSlug-abc_1',
    url: 'https://clips.twitch.tv/BraveClipSlug-abc_1',
    title: 'Chat loses it',
    thumbnailUrl: 'https://static-cdn.jtvnw.net/twitch-clips/abc-480x272.jpg',
    durationSeconds: 28,
    createdAt: '2026-11-01T12:00:00Z',
    channel: { id: '71092938', login: 'xqc', displayName: 'xQc', profileImageUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/xqc-300x300.png' },
    game: { id: '509658', name: 'Just Chatting' },
    views: { count: 1234, checkedAt: '2026-11-01T13:00:00Z' },
    vod: { videoId: '2100000000', offsetSeconds: 3725 },
    reaction: { chatLift: 6.2, emoteLift: 3.1, chatters: 412, largestShare: 0.04 },
    available: true,
    ...overrides,
  }
}

export function nativeClipsPage(items: unknown[], extra: Record<string, unknown> = {}) {
  return { schemaVersion: 1, generatedAt: '2026-11-01T13:00:00Z', items, facets: { games: [], channels: [] },
    scope: { total: items.length, matching: items.length, truncated: false }, nextCursor: null, ...extra }
}

/** Answers each fetch with the next body; the last one repeats. */
export function stubClipsFetch(...bodies: Array<{ status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  let i = 0
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    // A clip's page also asks for its reviews and comments: answered as switched
    // off, and left out of `calls`, which counts reads of the clip catalogue.
    if (String(input).includes('/v1/account/')) return new Response('{"error":"not found"}', { status: 404, headers: { 'content-type': 'application/json' } })
    calls.push({ url: String(input), init })
    const next = bodies[Math.min(i++, bodies.length - 1)]
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers: { 'content-type': 'application/json' } })
  }))
  return calls
}
