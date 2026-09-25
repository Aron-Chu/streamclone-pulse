import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasPublicHubResponseShape, normalizePublicHub } from '../src/lib/publicHub'

const fixtureDir = process.env.SP_PUBLIC_HUB_PROJECTION_DIR

describe.runIf(Boolean(fixtureDir))('public hub projection from a captured public snapshot', () => {
  it('normalizes the bounded Moments payload', () => {
    const raw: unknown = JSON.parse(readFileSync(join(fixtureDir!, 'hub-moments.json'), 'utf8'))
    expect(hasPublicHubResponseShape(raw)).toBe(true)
    if (!hasPublicHubResponseShape(raw)) return
    const hub = normalizePublicHub(raw)
    expect(hub.livePulseMoments.length).toBeGreaterThan(0)
    expect(hub.liveChannels).toHaveLength(0)
    expect(hub.topEmotes).toHaveLength(0)
  })

  it('normalizes the bounded landing tickers payload', () => {
    const raw: unknown = JSON.parse(readFileSync(join(fixtureDir!, 'hub-tickers.json'), 'utf8'))
    expect(hasPublicHubResponseShape(raw)).toBe(true)
    if (!hasPublicHubResponseShape(raw)) return
    const hub = normalizePublicHub(raw)
    expect(hub.topEmotes.length).toBeGreaterThan(0)
    expect(hub.topMovers.length).toBeGreaterThan(0)
    expect(hub.liveChannels).toHaveLength(0)
    expect(hub.livePulseMoments).toHaveLength(0)
  })
})
