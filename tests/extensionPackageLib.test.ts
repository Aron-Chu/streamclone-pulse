import { describe, expect, it } from 'vitest'
import {
  compareZipEntriesToExpected,
  normalizeZipEntry,
  parseChecksumFile,
  shouldSkipPackagedPath,
} from '../scripts/extension-package-lib.mjs'

describe('extension package filtering', () => {
  it('skips maps, env, local, node_modules, and tests paths', () => {
    expect(shouldSkipPackagedPath('chunks/foo.js.map')).toBe(true)
    expect(shouldSkipPackagedPath('.env')).toBe(true)
    expect(shouldSkipPackagedPath('config.env.local')).toBe(true)
    expect(shouldSkipPackagedPath('settings.local')).toBe(true)
    expect(shouldSkipPackagedPath('node_modules/pkg/index.js')).toBe(true)
    expect(shouldSkipPackagedPath('__tests__/x.js')).toBe(true)
    expect(shouldSkipPackagedPath('tests/x.js')).toBe(true)
    expect(shouldSkipPackagedPath('background/service-worker.js')).toBe(false)
    expect(shouldSkipPackagedPath('manifest.json')).toBe(false)
  })
})

describe('zip entry comparison', () => {
  const expected = [
    'background/service-worker.js',
    'content/twitch.js',
    'icons/icon128.png',
    'icons/icon16.png',
    'icons/icon48.png',
    'manifest.json',
    'options/index.html',
    'options/options.js',
    'popup/index.html',
    'popup/popup.js',
  ]

  it('accepts an exact filtered set with nested paths', () => {
    const result = compareZipEntriesToExpected(expected, expected)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('normalizes slash direction before comparison', () => {
    const windowsish = expected.map((e) => e.replace(/\//g, '\\'))
    const result = compareZipEntriesToExpected(windowsish, expected)
    expect(result.ok).toBe(true)
  })

  it('rejects unexpected maps and flattened paths', () => {
    const result = compareZipEntriesToExpected(
      [...expected, 'chunks/x.js.map', 'service-worker.js'],
      expected,
    )
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('unexpected zip entry'))).toBe(true)
    expect(result.errors.some((e) => e.includes('source map'))).toBe(true)
    expect(result.errors.some((e) => e.includes('flattened'))).toBe(true)
  })

  it('rejects missing required nested entrypoints', () => {
    const result = compareZipEntriesToExpected(['manifest.json'], expected)
    expect(result.ok).toBe(false)
    expect(result.errors.some((e) => e.includes('background/service-worker.js'))).toBe(true)
  })
})

describe('checksum parsing', () => {
  it('parses digest and filename', () => {
    const digest = 'a'.repeat(64)
    const parsed = parseChecksumFile(`${digest}  streampulse-extension.zip\n`)
    expect(parsed.digest).toBe(digest)
    expect(parsed.filename).toBe('streampulse-extension.zip')
  })

  it('rejects wrong filename', () => {
    expect(() => parseChecksumFile(`${'b'.repeat(64)}  other.zip`)).toThrow(/filename/)
  })
})

describe('normalizeZipEntry', () => {
  it('strips leading ./ and backslashes', () => {
    expect(normalizeZipEntry('.\\background\\service-worker.js')).toBe(
      'background/service-worker.js',
    )
  })
})
