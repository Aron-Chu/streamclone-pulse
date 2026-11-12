import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { policyResults, signal } from './audit-ai-crawl.mjs'

const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8')
test('proposed retrieval policy consistently excludes private routes and training', () => {
  assert.equal(policyResults(robots, signal).ready, true)
})
test('a private prefix cannot masquerade as a root training prohibition', () => {
  const weakened = robots.replace('User-agent: GPTBot\nDisallow: /\n', 'User-agent: GPTBot\nDisallow: /account\n')
  assert.equal(policyResults(weakened, signal).ready, false)
})
test('all three policy layers must agree', () => {
  assert.equal(policyResults(robots, signal.replace('ai-input=yes', 'ai-input=no')).ready, false)
  assert.equal(policyResults(robots.replaceAll('Disallow: /account', ''), signal).ready, false)
  assert.equal(policyResults(robots.replace('User-agent: PerplexityBot\nAllow: /', 'User-agent: PerplexityBot\nDisallow: /'), signal).ready, false)
})

test('Google-Extended is an explicit training exception, not a spoofed HTTP bot', () => {
  assert.equal(policyResults(robots.replace('ai-train=yes', 'ai-train=no'), signal).ready, false)
})

test('rejects more-specific permissions and contradictory content signals', () => {
  assert.equal(policyResults(robots.replace('User-agent: GPTBot\nDisallow: /', 'User-agent: GPTBot\nDisallow: /\nAllow: /analytics/'), signal).ready, false)
  assert.equal(policyResults(robots.replace('User-agent: OAI-SearchBot\nAllow: /', 'User-agent: OAI-SearchBot\nAllow: /\nAllow: /account/'), signal).ready, false)
  assert.equal(policyResults(robots.replace('User-agent: Google-Extended\n', 'User-agent: Google-Extended\nContent-signal: search=no\n'), signal).ready, false)
})
