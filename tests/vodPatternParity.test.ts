import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  STREAM_JSON_PATTERNS,
  VOD_ID,
  VOD_JSON_PATTERNS,
} from '../src/shared/vodIdPatterns.ts'

/**
 * `scrapePageVodState` is injected into the MAIN world via `chrome.scripting`,
 * so it cannot import the shared patterns — the function is serialized and any
 * module reference becomes a ReferenceError after minification. The duplication
 * is deliberate; this test is what keeps the two copies in step.
 */
const injectSource = readFileSync(
  fileURLToPath(new URL('../src/background/twitchPageInject.ts', import.meta.url)),
  'utf8',
)

function literalsIn(source: string, arrayName: string): string[] {
  const block = source.match(new RegExp(`const ${arrayName} = \\[([\\s\\S]*?)\\]`))
  if (!block?.[1]) throw new Error(`could not locate ${arrayName} in twitchPageInject.ts`)
  return block[1]
    .split('\n')
    .map(line => line.trim().replace(/,$/, ''))
    .filter(Boolean)
}

describe('MAIN-world VOD scrape regex parity', () => {
  it('duplicates the shared VOD patterns exactly', () => {
    expect(literalsIn(injectSource, 'vodPatterns'))
      .toEqual(VOD_JSON_PATTERNS.map(String))
  })

  it('duplicates the shared stream patterns exactly', () => {
    expect(literalsIn(injectSource, 'streamPatterns'))
      .toEqual(STREAM_JSON_PATTERNS.map(String))
  })

  it('duplicates the shared numeric id bound exactly', () => {
    const inline = injectSource.match(/const vodIdOk = \(id: string\) => (\/.*?\/)\.test\(id\)/)
    expect(inline?.[1]).toBe(String(VOD_ID))
  })

  it('keeps the injected function free of module imports', () => {
    const body = injectSource.match(
      /export function scrapePageVodState\(\): PageVodScrapeResult \{[\s\S]*?\n\}/,
    )?.[0]
    expect(body).toBeTruthy()
    // A bare identifier from another module would survive typecheck but throw at
    // runtime once the injected function is stringified.
    expect(body).not.toMatch(/\bVOD_JSON_PATTERNS\b|\bSTREAM_JSON_PATTERNS\b|\bVOD_ID\b/)
  })
})
