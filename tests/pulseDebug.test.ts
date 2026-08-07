import { describe, expect, it, vi } from 'vitest'
import {
  interpretVodDebugBlockers,
  summarizeVodDebugBlockersFromEntries,
  vodLocalDiscoveryDiagnostic,
  type PulseDebugEntry,
} from '../src/shared/pulseDebug.ts'

const gqlBlockedEntry: PulseDebugEntry = {
  ts: Date.now(),
  step: 'vod.discover.gql',
  message: 'GQL returned no archive id',
  data: { gqlErrors: ['Failed to fetch'], source: null, streamId: '123' },
  level: 'warn',
}

describe('pulseDebug VOD blockers', () => {
  it('surfaces GQL blocked as primary when backend has not linked a VOD', () => {
    const summary = interpretVodDebugBlockers([gqlBlockedEntry])
    expect(summary).toContain('GQL blocked')
    expect(summary).toContain('API vodId still null')
  })

  it('reports Past Streams navigation id when API vodId is still null', () => {
    const summary = interpretVodDebugBlockers([
      {
        ts: Date.now(),
        step: 'vod.pulse.api',
        message: 'pulse',
        data: { vodId: null },
        level: 'info',
      },
      gqlBlockedEntry,
    ], { navigationVodId: '2839713915' })
    expect(summary).toContain('Past Streams has videoId 2839713915')
    expect(summary).toContain('not linked for backfill')
    expect(summary).not.toMatch(/^API vodId still null$/)
  })

  it('demotes GQL blocked to a local discovery note when backend resolved the VOD', () => {
    const summary = summarizeVodDebugBlockersFromEntries([gqlBlockedEntry], { backendVodResolved: true })
    expect(summary).toContain('GQL blocked')
    expect(summary).not.toContain('API vodId still null')
  })

  it('does not report stale no-Helix copy when a newer pulse entry confirms Helix', () => {
    const entries: PulseDebugEntry[] = [
      {
        ts: 10,
        step: 'vod.helix.health',
        message: 'Helix unknown',
        data: { helixEnabled: null },
        level: 'warn',
      },
      {
        ts: 20,
        step: 'vod.pulse.api',
        message: 'pulse fetched',
        data: { helixEnabled: true, vodId: null },
        level: 'info',
      },
    ]

    const summary = interpretVodDebugBlockers(entries)
    expect(summary).not.toContain('Backend analytics outdated')
    expect(summary).toContain('API vodId still null')
  })

  it('lets current health evidence override stale persisted entries', () => {
    const summary = summarizeVodDebugBlockersFromEntries(
      [{
        ts: 10,
        step: 'vod.helix.health',
        message: 'Helix unknown',
        data: { helixEnabled: null },
        level: 'warn',
      }],
      { backendHelixEnabled: true },
    )

    expect(summary).not.toContain('Backend analytics outdated')
  })

  it('returns null local discovery note when page discovery succeeded', () => {
    expect(vodLocalDiscoveryDiagnostic([])).toBeNull()
  })

  it('explains that a locally discovered VOD is blocked only by hosted write auth', () => {
    const summary = interpretVodDebugBlockers([
      {
        ts: 10,
        step: 'vod.pulse.api',
        message: 'pulse payload received',
        data: { vodId: null },
        level: 'info',
      },
      {
        ts: 20,
        step: 'vod.discover.gql',
        message: 'found archive id via Twitch GQL (videos.archive)',
        data: { vodId: '2838742057', source: 'videos.archive' },
        level: 'info',
      },
      {
        ts: 30,
        step: 'vod.hint.api',
        message: 'vod-hint requires an authenticated extension session',
        data: { status: 401, authRequired: true },
        level: 'info',
      },
    ])

    expect(summary).toContain('VOD discovered locally')
    expect(summary).toContain('requires extension authentication')
    expect(summary).not.toContain('route missing')
  })
})

describe('pulseDebug console level for expected VOD misses', () => {
  it('keeps discover miss entries at info even when callers pass warn', async () => {
    // Dynamic import keeps chrome mocks isolated if other suites stub storage.
    const { pulseDebug, initPulseDebug, setPulseDebugEnabled, getPulseDebugLog, clearPulseDebugLog } =
      await import('../src/shared/pulseDebug.ts')

    const local = new Map<string, unknown>()
    const sync = new Map<string, unknown>()
    // @ts-expect-error test stub
    globalThis.chrome = {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: local.get(key) }),
          set: async (values: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(values)) local.set(k, v)
          },
          remove: async (key: string) => {
            local.delete(key)
          },
        },
        sync: {
          get: async (key: string) => ({ [key]: sync.get(key) }),
          set: async (values: Record<string, unknown>) => {
            for (const [k, v] of Object.entries(values)) sync.set(k, v)
          },
        },
        onChanged: { addListener() {} },
      },
    }

    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await setPulseDebugEnabled(true)
    await initPulseDebug()
    await clearPulseDebugLog()
    await pulseDebug('vod.discover.dom', 'no archive id in page html', { login: 'xqc' }, 'warn')

    expect(warn).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledTimes(1)
    const logged = String(info.mock.calls[0]?.[0] ?? '')
    expect(logged).toContain('[Pulse vod.discover.dom] no archive id in page html')
    expect(logged).toContain('"login":"xqc"')
    expect(logged).not.toContain('[object Object]')

    const entries = await getPulseDebugLog()
    expect(entries[0]?.level).toBe('info')
  })
})
