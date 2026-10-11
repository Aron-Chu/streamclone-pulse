import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Deep-dive evidence (2026-10-09): "Remember watched moments" drops a verified
 * jump when the Twitch URL is not spelled exactly `/{lowercase login}` or
 * `/videos/{vodId of the reference}`. The content script swallows the error.
 */
const db = vi.hoisted(() => ({ data: null as unknown }))
vi.mock('../src/shared/storage.ts', () => ({
  DEFAULT_BACKEND_URL: 'https://api.streampulse.stream',
  getBackendUrl: async () => 'https://api.streampulse.stream',
}))
vi.mock('../src/background/api.ts', () => ({ createPulseBookmark: vi.fn(), deletePulseBookmark: vi.fn(), fetchPulseBookmarks: vi.fn(), accountHistoryRequest: vi.fn() }))
vi.mock('../src/background/supporterAccountRuntime.ts', () => ({
  bindAccountDataForget: () => {},
  supporterAccount: { run: async () => ({ state: 'not_linked' }), localAccountId: async () => null },
}))
vi.mock('../src/background/myMomentsStore.ts', async importOriginal => {
  const real = await importOriginal<typeof import('../src/background/myMomentsStore.ts')>()
  return {
    ...real,
    deletePersonal: async () => {},
    personalTransaction: async (_scope: string, update?: (d: never) => never) => {
      const current = real.prunePersonalData((db.data ?? { ...real.emptyPersonalData(), preferences: { captureHistory: true, retentionDays: 30 }, epoch: 5 }) as never, Date.now())
      const next = update ? update(current as never) : current
      db.data = next
      return next
    },
  }
})

vi.stubGlobal('chrome', { extension: { inIncognitoContext: false } })
const { handleMyMoments } = await import('../src/background/myMoments.ts')

function record(url: string, reference: Record<string, unknown>) {
  return handleMyMoments(
    { type: 'MOMENT_CAPTURE', action: 'record', epoch: 5, watchedSeconds: 10, reference: { id: 'moment', title: 'Big moment', offsetSeconds: 600, availability: 'unresolved', ...reference } } as never,
    { id: 'ext', tab: { id: 1, url } } as never,
  )
}

describe('watched-moment capture source check', () => {
  beforeEach(() => { db.data = null })

  it('records on the exact lowercase channel URL', async () => {
    await expect(record('https://www.twitch.tv/caseoh_', { channel: 'caseoh_', vodId: null, streamId: '318000000001' })).resolves.toEqual({ ok: true })
  })

  it('records when the URL keeps the capitals the viewer typed', async () => {
    await expect(record('https://www.twitch.tv/CaseOh_', { channel: 'caseoh_', vodId: null, streamId: '318000000001' })).resolves.toEqual({ ok: true })
  })

  it('records on a trailing-slash channel URL', async () => {
    await expect(record('https://www.twitch.tv/caseoh_/', { channel: 'caseoh_', vodId: null, streamId: '318000000001' })).resolves.toEqual({ ok: true })
  })

  it('records on a growing VOD when the reference carries the page VOD id', async () => {
    await expect(record('https://www.twitch.tv/videos/2896011569', { channel: 'caseoh_', vodId: '2896011569', streamId: '318000000001' })).resolves.toEqual({ ok: true })
    await expect(record('https://www.twitch.tv/videos/2896011569/', { channel: 'caseoh_', vodId: '2896011569', streamId: '318000000001' })).resolves.toEqual({ ok: true })
  })

  it('still drops a jump whose page is another channel or another VOD', async () => {
    await expect(record('https://www.twitch.tv/someoneelse', { channel: 'caseoh_', vodId: null, streamId: '318000000001' })).rejects.toThrow('Source changed')
    await expect(record('https://www.twitch.tv/videos/2896011569', { channel: 'caseoh_', vodId: '1111111111', streamId: '318000000001' })).rejects.toThrow('Source changed')
    // No VOD id in the reference: a VOD page cannot be verified.
    await expect(record('https://www.twitch.tv/videos/2896011569', { channel: 'caseoh_', vodId: null, streamId: '318000000001' })).rejects.toThrow('Source changed')
  })

  it('the panel sends the page VOD id when the jump has none', async () => {
    const { readFileSync } = await import('node:fs')
    const overlay = readFileSync(new URL('../src/ui/Overlay.tsx', import.meta.url), 'utf8')
    expect(overlay).toContain("vodId: jumpVodId ?? context.vodId, streamId: payload?.streamId")
  })
})
