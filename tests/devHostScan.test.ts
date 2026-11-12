import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { describeStoreDevHosts, findEncodedDevHosts } from '../scripts/lib/dev-host-scan.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function values(text: string): string[] {
  return findEncodedDevHosts(text).map(hit => hit.value)
}

describe('store dev-host scan', () => {
  // Minified forms copied from the 0.2.2 store bundles before the dev hosts
  // were compiled out of them.
  it.each([
    ['fromCharCode word', 'ks=String.fromCharCode(108,111,99,97,108,104,111,115,116)', 'localhost'],
    ['joined fromCharCode calls', '[String.fromCharCode(49,50,55),String.fromCharCode(48),String.fromCharCode(48),String.fromCharCode(49)].join(".")', '127.0.0.1'],
    ['char-code array mapped', '[108,97,112,116,111,112,119,111,114,107,101,114].map(e=>String.fromCharCode(e)).join("")', 'laptopworker'],
    ['joined template strings', 'let n=[`127`,`0`,`0`,`1`].join(`.`)', '127.0.0.1'],
    ['joined octets', 'Ms=[127,0,0,1].join(".")', '127.0.0.1'],
    ['fromCharCode port', 'const p=String.fromCharCode(56,48,56,49)', '8081'],
    ['hex fromCharCode', 'String.fromCharCode(0x6c,0x6f,0x63,0x61,0x6c,0x68,0x6f,0x73,0x74)', 'localhost'],
    ['hex escapes', 'x="\\x6c\\x6f\\x63\\x61\\x6c\\x68\\x6f\\x73\\x74"', 'localhost'],
    ['unicode escapes', 'x="\\u006c\\u006f\\u0063\\u0061\\u006c\\u0068\\u006f\\u0073\\u0074"', 'localhost'],
    ['percent-encoding', 'u="%6c%6f%63%61%6c%68%6f%73%74"', 'localhost'],
    ['concatenation', 'h="local"+"host"', 'localhost'],
    ['reversal', 'r="tsohlacol".split("").reverse().join("")', 'localhost'],
    ['integer address', 'fetch("http://2130706433:8081/")', '127.0.0.1'],
  ])('finds %s', (_label, text, expected) => {
    expect(values(text)).toContain(expected)
  })

  it.each([0, 1, 2])('finds base64 at offset %i', offset => {
    const encoded = Buffer.from(`${'x'.repeat(offset)}http://localhost:8081/`).toString('base64')
    expect(values(`atob("${encoded}")`)).toContain('localhost')
  })

  it('reports plain spellings too', () => {
    expect(describeStoreDevHosts('const h=`localhost`')).toEqual(['plain /localhost/i'])
    expect(describeStoreDevHosts('fetch("http://127.0.0.1/")')).toEqual(['plain /\\b127\\.0\\.0\\.1\\b/'])
    expect(describeStoreDevHosts('url.port==="5173"')).toHaveLength(1)
  })

  it.each([
    ['a space char code', 'e+=String.fromCharCode(32)'],
    ['a number array', 'const a=[0,1,2,3].join(","),b=[16,9];'],
    ['a version join', '[0,2,2].join(".")'],
    ['an ordinary RGB array', 'fill([12,34,56])'],
    ['the hosted API', 'fetch("https://api.streampulse.stream/v1/live")'],
    ['an unrelated port number', 'const n=8081+t'],
    ['base64 image data', `data:image/png;base64,${Buffer.from(Array.from({ length: 96 }, (_, i) => (i * 37) % 256)).toString('base64')}`],
  ])('ignores %s', (_label, text) => {
    expect(describeStoreDevHosts(text)).toEqual([])
  })
})

describe('extension build configs', () => {
  it('give every bundle the store-build flag, so shared dev-only code compiles out', () => {
    const configs = readdirSync(root).filter(name => /^vite\..*config\.ts$/.test(name))
    expect(configs.length).toBeGreaterThanOrEqual(5)
    for (const name of configs) {
      expect(readFileSync(join(root, name), 'utf8'), name).toContain('__EXTENSION_STORE_BUILD__: JSON.stringify(isStoreBuild)')
    }
  })
})
