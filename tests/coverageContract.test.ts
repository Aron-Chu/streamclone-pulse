import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const messagesPath = resolve(__dirname, '../src/shared/messages.ts')

/** Golden keys must match Go ExtensionCoverage in pulse_coverage.go (api_contract_test.go). */
const GOLDEN_PULSE_COVERAGE_KEYS = [
  'backfillReason',
  'canBackfill',
  'chatSource',
  'chatSourceDetail',
  'copyKey',
  'coverageEndOffsetSeconds',
  'coverageStartOffsetSeconds',
  'hasFullStreamCoverage',
  'hasGaps',
  'manualRetryAllowed',
  'message',
  'missingRanges',
  'state',
  'trackedFromStart',
  'vodStatus',
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

describe('PulseCoverage contract', () => {
  it('matches ExtensionCoverage JSON keys from streamclone BFF', () => {
    const source = readFileSync(messagesPath, 'utf8')
    const got = interfaceFieldNames(source, 'PulseCoverage')
    const want = [...GOLDEN_PULSE_COVERAGE_KEYS].sort()
    expect(got).toEqual(want)
  })
})
