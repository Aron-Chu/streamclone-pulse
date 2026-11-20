import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-sentry-debug-ids.mjs')
const stamp = (id) => `var n=(new e.Error).stack;n&&(e._sentryDebugIdIdentifier="sentry-dbid-${id}");`

/** A throwaway dist/assets folder holding the given files. */
function assetsFixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'sentry-dbid-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const assets = join(root, 'dist', 'assets')
  mkdirSync(assets, { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(assets, name)), { recursive: true })
    writeFileSync(join(assets, name), body)
  }
  return assets
}

const runCheck = (assets) => spawnSync(process.execPath, [script, assets], { encoding: 'utf8' })

test('fails when any JS chunk, not only the entry, has no debug ID', (t) => {
  const assets = assetsFixture(t, {
    'index-AbC123.js': `${stamp('11111111-1111-4111-8111-111111111111')}console.log(1)`,
    'AnalyticsPage-Def456.js': `${stamp('22222222-2222-4222-8222-222222222222')}export const a = 1`,
    'preload-helper-Ghi789.js': 'var e=function(e){return`/`+e};export{e as t}',
  })
  const result = runCheck(assets)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /preload-helper-Ghi789\.js/)
  assert.doesNotMatch(result.stderr, /index-AbC123\.js|AnalyticsPage-Def456\.js/)
})

test('passes when every JS chunk has a debug ID; CSS, fonts and images need none', (t) => {
  const assets = assetsFixture(t, {
    'index-AbC123.js': `${stamp('11111111-1111-4111-8111-111111111111')}console.log(1)`,
    'preload-helper-Ghi789.js': `${stamp('33333333-3333-4333-8333-333333333333')}export{}`,
    'nested/worker-Jkl012.mjs': `${stamp('44444444-4444-4444-8444-444444444444')}self.onmessage=()=>{}`,
    'index-AbC123.css': 'body{margin:0}',
    'inter-latin.woff2': 'not js',
    'hero.webp': 'not js',
  })
  const result = runCheck(assets)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /3 of 3 JS chunks/)
})

test('does not take a bare "sentry-dbid-" without an ID for a stamp', (t) => {
  const assets = assetsFixture(t, {
    'index-AbC123.js': `${stamp('11111111-1111-4111-8111-111111111111')}console.log(1)`,
    'route-Mno345.js': 'const label = "sentry-dbid-";export{label}',
  })
  const result = runCheck(assets)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /route-Mno345\.js/)
})

test('exempts a whitespace-only JS chunk, which the plugin leaves unstamped', (t) => {
  const assets = assetsFixture(t, {
    'index-AbC123.js': `${stamp('11111111-1111-4111-8111-111111111111')}console.log(1)`,
    'empty-Pqr678.js': '\n  \n',
  })
  const result = runCheck(assets)
  assert.equal(result.status, 0, result.stderr)
})

test('runs as a CLI when reached through a symlinked folder', (t) => {
  const assets = assetsFixture(t, { 'index-AbC123.js': 'console.log(1)' })
  const linkRoot = mkdtempSync(join(tmpdir(), 'sentry-dbid-link-'))
  t.after(() => rmSync(linkRoot, { recursive: true, force: true }))
  const link = join(linkRoot, 'scripts')
  try {
    symlinkSync(dirname(script), link, 'junction')
  } catch {
    t.skip('this system cannot create a directory link')
    return
  }
  const result = spawnSync(process.execPath, [join(link, 'check-sentry-debug-ids.mjs'), assets], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /index-AbC123\.js/)
})

test('fails loudly on an assets folder with no JS chunks', (t) => {
  const assets = assetsFixture(t, { 'index-AbC123.css': 'body{margin:0}' })
  const result = runCheck(assets)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /no JS chunks/)
})

test('fails on a missing assets folder', (t) => {
  const assets = assetsFixture(t, {})
  const result = runCheck(join(assets, 'missing'))
  assert.equal(result.status, 1)
})
