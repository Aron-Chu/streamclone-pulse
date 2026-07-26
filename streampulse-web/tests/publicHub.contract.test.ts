import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicHubPath = resolve(__dirname, '../src/lib/publicHub.ts')

/** KPI / header fields consumed by HubCommandHeader and LiveChannelsMatrix. */
const GOLDEN_HUB_KPI_INTERFACE_KEYS = [
  'activity',
  'corpus',
  'corpusPipeline',
  'coverage',
  'emoteIntel',
  'ingest',
  'liveChannels',
  'poolSize',
] as const

const GOLDEN_CORPUS_PIPELINE_KEYS = [
  'collectorActive',
  'collectorMax',
  'roster',
] as const

const GOLDEN_HUB_INGEST_KEYS = [
  'activeCollectors',
  'coreEnabled',
  'desiredCollectors',
  'state',
] as const

function interfaceFieldNames(source: string, interfaceName: string): string[] {
  const re = new RegExp(`export interface ${interfaceName}\\s*\\{`)
  const match = re.exec(source)
  if (!match) {
    throw new Error(`interface ${interfaceName} not found`)
  }
  const braceStart = match.index + match[0].length - 1
  let depth = 0
  let end = braceStart
  for (let i = braceStart; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  const body = source.slice(braceStart + 1, end)
  const names: string[] = []
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('/**') || trimmed.startsWith('*') || trimmed.startsWith('//')) {
      continue
    }
    const match = trimmed.match(/^([A-Za-z_]\w*)(\?)?:/)
    if (match) names.push(match[1])
  }
  return names.sort()
}

describe('PublicHub portal contract', () => {
  const source = readFileSync(publicHubPath, 'utf8')

  it('PublicHub exposes KPI fields used by hub header', () => {
    const got = interfaceFieldNames(source, 'PublicHub')
    for (const key of GOLDEN_HUB_KPI_INTERFACE_KEYS) {
      expect(got, `PublicHub missing ${key}`).toContain(key)
    }
  })

  it('HubCorpusPipeline exposes collector and roster fields', () => {
    const got = interfaceFieldNames(source, 'HubCorpusPipeline')
    for (const key of GOLDEN_CORPUS_PIPELINE_KEYS) {
      expect(got, `HubCorpusPipeline missing ${key}`).toContain(key)
    }
  })

  it('HubIngest exposes IRC health fields from hub_ingest.go', () => {
    const got = interfaceFieldNames(source, 'HubIngest')
    for (const key of GOLDEN_HUB_INGEST_KEYS) {
      expect(got, `HubIngest missing ${key}`).toContain(key)
    }
  })

  it('HubRosterSummary exposes live count for roster-vs-IRC labels', () => {
    const got = interfaceFieldNames(source, 'HubRosterSummary')
    expect(got).toContain('live')
    expect(got).toContain('collectorTracking')
    expect(got).toContain('configuredRosterConfirmed')
    expect(got).toContain('connectedQuiet')
  })

  it('HubIngest exposes aggregate IRC chat-active fields', () => {
    const got = interfaceFieldNames(source, 'HubIngest')
    expect(got).toContain('chatActive5m')
    expect(got).toContain('boundCollectors')
    expect(got).toContain('connectedQuiet')
  })

  it('PublicHubMomentsResponse exposes fields required by bucket click flow', () => {
    const got = interfaceFieldNames(source, 'PublicHubMomentsResponse')
    for (const key of ['status', 'moments', 'bucketT', 'reason'] as const) {
      expect(got, `PublicHubMomentsResponse missing ${key}`).toContain(key)
    }
  })
})
