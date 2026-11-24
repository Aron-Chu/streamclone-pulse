import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { accountMomentsOn, accountRedirects } from './account-redirects.mjs'
import { SWITCHES } from './check-switch-routes.mjs'

const source = readFileSync(new URL('../public/_redirects', import.meta.url), 'utf8')

/** The first static rule matching the path, as Cloudflare Pages picks it. */
function resolve(rules, path) {
  for (const line of rules.split('\n')) {
    const [from, to, status] = line.trim().split(/\s+/)
    if (!from || from.startsWith('#')) continue
    if (from === path) return `${to} ${status ?? '302'}`
  }
  return null
}

test('with My Moments off, both forms of /account open Settings', () => {
  const rules = accountRedirects(source, false)
  assert.equal(rules, source)
  assert.equal(resolve(rules, '/account'), '/account/settings 302')
  assert.equal(resolve(rules, '/account/'), '/account/settings 302')
})

test('with My Moments on, a direct /account loads the app there, as in-app navigation does', () => {
  const rules = accountRedirects(source, true)
  assert.equal(resolve(rules, '/account'), '/ 200')
  assert.equal(resolve(rules, '/account/'), '/account 301')
  assert.doesNotMatch(rules, /^\/account\/? \/account\/settings/m)
  // Every other account rule is untouched.
  assert.equal(resolve(rules, '/account/settings'), resolve(source, '/account/settings'))
})

test('a Windows checkout with CRLF line endings swaps the same two lines', () => {
  const rules = accountRedirects(source.replace(/\n/g, '\r\n'), true)
  assert.equal(resolve(rules, '/account'), '/ 200')
  assert.equal(resolve(rules, '/account/'), '/account 301')
  assert.doesNotMatch(rules, /[^\r]\n/)
})

test('a _redirects without the two Settings aliases fails the build instead of shipping the wrong page', () => {
  const missing = source.replace(/^\/account \/account\/settings 302\r?\n/m, '')
  assert.notEqual(missing, source)
  assert.throws(() => accountRedirects(missing, true), /two adjacent lines/)
  assert.throws(() => accountRedirects(missing, false), /two adjacent lines/)
})

test('two Settings aliases split apart fail the build instead of swapping out an unrelated line', () => {
  const split = source.replace(/^(\/account \/account\/settings 302\r?\n)/m, '$1# a line between them\n')
  assert.notEqual(split, source)
  assert.throws(() => accountRedirects(split, true), /two adjacent lines/)
  assert.throws(() => accountRedirects(split, false), /two adjacent lines/)
})

test('the build reads My Moments the way the app does: only "1" turns it on', () => {
  const moments = SWITCHES.find((entry) => entry.name === 'VITE_ACCOUNT_MOMENTS')
  for (const value of ['1', 'on', 'true', '0', '', undefined]) {
    assert.equal(accountMomentsOn({ VITE_ACCOUNT_MOMENTS: value }), moments.on.includes(value), `VITE_ACCOUNT_MOMENTS=${value}`)
  }
  assert.equal(accountMomentsOn({}), false)
  // The app's own reader: if it ever accepts more than '1', this build check has to follow it.
  const app = readFileSync(new URL('../src/lib/accountMoments.ts', import.meta.url), 'utf8')
  assert.match(app, /import\.meta\.env\.VITE_ACCOUNT_MOMENTS === '1'/)
})

test('both forms of /extension follow /install', () => {
  assert.equal(resolve(source, '/extension'), '/install 302')
  assert.equal(resolve(source, '/extension/'), '/install 302')
  assert.ok(resolve(source, '/install'), '/install itself has a destination')
})
