import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveHeatPoint } from '@streampulse/pulse-core'
import type { ReplayLookups } from '../src/background/bookmarkReplay.ts'
import { bindReplayLookups, handleDeviceBookmarks, handleMyMoments } from '../src/background/myMoments.ts'
import { bookmarkIdentity, emptyPersonalData, momentIdentity, type PersonalData } from '../src/background/myMomentsStore.ts'
import type { PulseBookmark } from '../src/shared/messages.ts'
import { jumpHistoryReference, keptMomentSecond } from '../src/ui/keptMoment.ts'
import type { LibraryMoment, MomentReference } from '../src/ui/library/model.ts'

/**
 * A watched moment and its bookmark are one row in My Moments because they
 * share one identity: channel, stream (or VOD) and the second the moment is
 * kept at. A jump used to record the moment's minute (or its fractional
 * offset) while the save kept its reaction onset, so the two never met: the
 * History row had no "Bookmarked" tag and its Bookmark made a second save.
 */
const f = vi.hoisted(() => ({ data: new Map<string, PersonalData>() }))
vi.mock('../src/background/supporterAccountRuntime.ts', () => ({ bindAccountDataForget: () => undefined,
  supporterAccount: { run: async () => ({ state: 'signed_out' }) } }))
vi.mock('../src/background/api.ts', () => ({ fetchPulseBookmarks: vi.fn(), createPulseBookmark: vi.fn(), deletePulseBookmark: vi.fn() }))
vi.mock('../src/background/myMomentsStore.ts', async original => ({ ...await original<object>(), personalTransaction: async (scope: string, update?: (value: PersonalData) => PersonalData) => {
  const value = f.data.get(scope) ?? emptyPersonalData()
  if (!update) return value
  const next = update(value); f.data.set(scope, next); return next
} }))
const localScope = 'https://api.streampulse.stream|local'
const VOD = '2903344433'
const STREAM = '123456'
beforeEach(() => {
  f.data.clear()
  f.data.set(localScope, { ...emptyPersonalData(), preferences: { captureHistory: true, retentionDays: 30 } })
  bindReplayLookups({ pastVods: vi.fn<ReplayLookups['pastVods']>().mockResolvedValue([]), liveArchive: vi.fn<ReplayLookups['liveArchive']>().mockResolvedValue(null) })
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => undefined) } })
})
afterEach(() => vi.unstubAllGlobals())

const moment = (fields: Partial<LiveHeatPoint>) => ({ offsetSeconds: 120, reasonLabel: 'Chat spike', ...fields }) as LiveHeatPoint
/** Second-precise: the reaction starts 17 s into its minute. */
const refined = moment({ reactionOnsetOffsetSeconds: 137.4, precisionSeconds: 5 })
/** Minute-precise, at a fractional offset that rounds up. */
const fractional = moment({ offsetSeconds: 125.6 })
const minute = moment({})
/** What the moment card saves (`SelectedMomentCard` → `momentBookmarks`, which floors it). */
const save = (point: LiveHeatPoint) => handleDeviceBookmarks({ type: 'SAVE_BOOKMARK', bookmark: { login: 'zackrawrr', streamId: STREAM, vodId: VOD,
  offsetSeconds: Math.floor(keptMomentSecond(point)), label: point.reasonLabel, source: 'extension' } }, {}) as Promise<{ item: PulseBookmark }>
const watch = (reference: MomentReference) => handleMyMoments({ type: 'MOMENT_CAPTURE', action: 'record', epoch: 0, reference, watchedSeconds: 10 },
  { tab: { url: `https://www.twitch.tv/videos/${VOD}` } as chrome.tabs.Tab })
const jumped = (point: LiveHeatPoint) => jumpHistoryReference(point, { login: 'zackrawrr', vodId: VOD, streamId: STREAM })
const load = async () => ((await handleMyMoments({ type: 'MY_MOMENTS', action: 'load' }, {})) as { snapshot: { moments: LibraryMoment[] } }).snapshot.moments

describe('the second a moment is kept at', () => {
  it('is the reaction onset for a second-precise moment, else the rounded offset', () => {
    expect(keptMomentSecond(refined)).toBe(137)
    expect(keptMomentSecond(fractional)).toBe(126)
    expect(keptMomentSecond(minute)).toBe(120)
  })

  it('a jump keeps the second its bookmark keeps, for every kind of moment', async () => {
    for (const point of [refined, fractional, minute]) {
      const { item } = await save(point)
      expect(momentIdentity(jumped(point))).toBe(bookmarkIdentity(item))
    }
  })
})

describe('My Moments shows a watched, saved moment once', () => {
  it('a refined moment saved and then watched after a jump is one row, bookmarked and in History', async () => {
    const { item } = await save(refined)
    expect(await watch(jumped(refined))).toEqual({ ok: true })
    const rows = await load()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: item.id, offsetSeconds: 137 })
    expect(rows[0]!.savedAt).toBeDefined()
    expect(rows[0]!.jumpedAt).toBeDefined()
  })

  it('a moment at a fractional offset is one row too', async () => {
    await save(fractional)
    await watch(jumped(fractional))
    expect(await load()).toHaveLength(1)
  })

  it('the minute a jump used to record is another moment: two rows (the old behaviour)', async () => {
    await save(refined)
    await watch({ ...jumped(refined), offsetSeconds: refined.offsetSeconds })
    expect((await load()).map(m => m.offsetSeconds).sort()).toEqual([120, 137])
  })

  it('a History entry watched first is the row the later save joins', async () => {
    await watch(jumped(refined))
    await save(refined)
    const rows = await load()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.savedAt).toBeDefined()
    expect(rows[0]!.jumpedAt).toBeDefined()
  })
})

describe('the History reference of a jump', () => {
  it('keeps the payload\'s VOD origin delta only for the payload\'s own VOD', () => {
    const at = { login: 'zackrawrr', vodId: VOD, streamId: STREAM }
    expect(jumpHistoryReference(refined, { ...at, payloadVodId: VOD, payloadVodOriginDeltaSeconds: 95 })).toMatchObject({ vodOriginDeltaSeconds: 95 })
    expect(jumpHistoryReference(refined, { ...at, payloadVodId: '2900000001', payloadVodOriginDeltaSeconds: 95 })).not.toHaveProperty('vodOriginDeltaSeconds')
    expect(jumpHistoryReference(refined, { ...at, payloadVodId: VOD, payloadVodOriginDeltaSeconds: 0 })).not.toHaveProperty('vodOriginDeltaSeconds')
    expect(jumpHistoryReference(refined, { ...at, vodId: null, payloadVodId: null, payloadVodOriginDeltaSeconds: 95 })).not.toHaveProperty('vodOriginDeltaSeconds')
    expect(jumpHistoryReference(refined, at)).toEqual({ id: 'moment', channel: 'zackrawrr', title: 'Chat spike', vodId: VOD, streamId: STREAM,
      offsetSeconds: 137, availability: 'unresolved' })
  })
})
