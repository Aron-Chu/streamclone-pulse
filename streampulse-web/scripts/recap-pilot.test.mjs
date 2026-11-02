import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { validatePilot, metadataForPage, writeRuntimeManifests, renderRecapSummary, renderRecapDocument, recapStructuredData, recapRedirects, sitemapWithRecaps, replayUrl } from './recap-pilot.mjs'

import { fixture } from './fixtures/recap-pilot.mjs'
const now = new Date('2026-10-31T18:00:00Z')

function validate(page) { return validatePilot({ schemaVersion: 1, pages: [page] }, { now })[0] }

test('uses canonical draft OR alternatives and honest partial coverage', () => {
  assert.equal(validate(fixture()).path, '/analytics/fixturechan/123')
  assert.equal(validate(fixture({ durationSeconds: 3000, nonMissingRollupMinutes: 30 })).coverage.state, 'partial')
  assert.throws(() => validate(fixture({ durationSeconds: 3000, nonMissingRollupMinutes: 29 })), /duration/)
  assert.throws(() => validate(fixture({ durationSeconds: 1000, nonMissingRollupMinutes: 30 })), /exceed/)
})

test('fails closed for score gate, unknown coverage and unapproved or expired review', () => {
  assert.throws(() => validate(fixture({ moments: [{ offsetSeconds: 100, score: 69 }] })), /score-70/)
  assert.throws(() => validate(fixture({ coverage: { state: 'unknown', description: 'Unknown.' } })), /coverage/)
  for (const review of [{ ...fixture().review, approved: false }, { ...fixture().review, expiresAt: now.toISOString() }, { ...fixture().review, reviewedAt: '2026-11-01T17:00:00Z' }]) {
    assert.throws(() => validate(fixture({ review })), /review/)
  }
})

test('a documented peak alternative remains explicit and manually reviewed', () => {
  assert.equal(validate(fixture({ moments: [{ offsetSeconds: 100, score: 40 }],
    peakChatThreshold: { minimum: 100, observed: 120, rationale: 'Synthetic threshold for an explicit alternative-gate test.' } })).moments.length, 1)
  assert.throws(() => validate(fixture({ moments: [{ offsetSeconds: 100, score: 40 }], peakChatThreshold: { minimum: 100, observed: 99, rationale: 'Under threshold.' } })), /score-70/)
})

test('rejects raw/private fields, unsafe identities and mismatched provenance', () => {
  assert.throws(() => validate(fixture({ rawChat: ['private'] })), /unsupported field/)
  assert.throws(() => validate(fixture({ login: '../bad' })), /login/)
  assert.throws(() => validate(fixture({ login: 123 })), /login/)
  assert.throws(() => validate(fixture({ streamId: 123 })), /identity/)
  assert.throws(() => validate(fixture({ login: 'moments' })), /login/)
  assert.throws(() => validate(fixture({ review: { ...fixture().review, sourceUrl: 'https://api.streampulse.stream/v1/portal/analytics/streams/999/recap' } })), /identity/)
  assert.throws(() => validate(fixture({ review: { ...fixture().review, sourceUrl: 'https://user:pass@api.streampulse.stream/v1/portal/analytics/streams/123/recap' } })), /identity/)
  assert.throws(() => validate(fixture({ moments: [{ offsetSeconds: -1, score: 80 }] })), /nonnegative/)
})

test('deduplicates output paths, summaries and timestamps', () => {
  assert.throws(() => validatePilot({ schemaVersion: 1, pages: [fixture(), fixture()] }, { now }), /duplicate/)
  assert.throws(() => validatePilot({ schemaVersion: 1, pages: [fixture(), fixture({ streamId: '124', summary: 'A different unique reviewed summary.', review: { ...fixture().review, sourceUrl: 'https://api.streampulse.stream/v1/portal/analytics/streams/124/recap' } })] }, { now }), /duplicate/)
  assert.throws(() => validate(fixture({ moments: [{ offsetSeconds: 100, score: 75 }, { offsetSeconds: 100, score: 90 }] })), /duplicate/)
})

test('maps verified replay offsets and keeps useful expired archives without replay promises', () => {
  const page = validate(fixture())
  assert.equal(replayUrl(page, page.moments[0]), 'https://www.twitch.tv/videos/456?t=95s')
  assert.equal(replayUrl(page, { offsetSeconds: 0 }), null)
  assert.equal(replayUrl(page, { offsetSeconds: 7500 }), null)
  const expired = validate(fixture({ replay: { ...fixture().replay, expiresAt: '2026-10-31T17:30:00Z' } }))
  assert.equal(expired.replay, null)
  assert.equal(metadataForPage(expired).robots, 'index,follow')
  assert.match(renderRecapSummary(expired), /Archive summary/)
  assert.doesNotMatch(renderRecapSummary(expired), /twitch.tv\/videos/)
})

test('escapes HTML and JSON-LD instead of treating external text as code', () => {
  const page = validate(fixture({ title: '</script><img src=x onerror=alert(1)>', topEmotes: [{ code: '<3', count: 3 }], game: '<img src=x onerror=alert(1)>' }))
  const html = renderRecapSummary(page)
  assert.doesNotMatch(html, /<img/)
  assert.match(html, /&lt;3/)
  assert.doesNotMatch(recapStructuredData(page), /<\/script>/)
  assert.equal(JSON.parse(recapStructuredData(page)).name, page.title)
})

test('Cloudflare eligible rules precede dynamic catchalls and aliases resolve to same asset', () => {
  const page = validate(fixture())
  const source = '# Reviewed recap pilot routes are inserted here at build time.\n/analytics/:login/:streamId /analytics-fallback/ 200\n'
  const rules = recapRedirects(source, [page]).split('\n').filter(line => line.startsWith('/'))
  assert.equal(rules[0], '/analytics/fixturechan/123 /_recap-pages/fixturechan/123/ 200')
  assert.ok(rules.indexOf('/analytics/:login/:streamId /analytics-fallback/ 200') > 0)
  assert.ok(rules.includes('/analytics/fixturechan/s/123 /_recap-pages/fixturechan/123/ 200'))
  assert.ok(rules.includes('/s/fixturechan/123 /_recap-pages/fixturechan/123/ 200'))
  assert.doesNotMatch(recapRedirects(source, []), /fixturechan/)
  assert.throws(() => recapRedirects('', [page]), /marker/)
})

test('initial reviewed HTML has its own metadata/content and keeps real asset references', () => {
  const page = validate(fixture({ title: 'Reactions & moments $& — StreamPulse' }))
  const shell = '<html><head><title>Generic</title><meta name="robots" content="noindex,nofollow" /><meta name="description" content="Generic" /><link rel="canonical" href="https://streampulse.stream/analytics-fallback" /><script src="/assets/real-build.js"></script></head><body><!--public-root:start--><div id="root">Loading</div><!--public-root:end--></body></html>'
  const html = renderRecapDocument(shell, page)
  assert.match(html, /<title>Reactions &amp; moments \$&amp; — StreamPulse<\/title>/)
  assert.match(html, /content="index,follow"/)
  assert.doesNotMatch(html, /noindex/)
  assert.match(html, /href="https:\/\/streampulse.stream\/analytics\/fixturechan\/123"/)
  assert.match(html, /data-recap-summary/)
  assert.match(html, /\/assets\/real-build.js/)
  assert.match(html, /application\/ld\+json/)
})

test('sitemap contains only explicitly reviewed pilot URLs with genuine review dates', () => {
  const page = validate(fixture())
  assert.match(sitemapWithRecaps('<urlset></urlset>', [page]), /<loc>https:\/\/streampulse.stream\/analytics\/fixturechan\/123<\/loc>/)
  assert.doesNotMatch(sitemapWithRecaps('<urlset></urlset>', []), /fixturechan/)
})

test('runtime classification manifest contains paths and coarse categories only', () => {
  const parent = resolve(tmpdir())
  const dir = mkdtempSync(join(parent, 'streampulse-recap-test-'))
  try {
    writeRuntimeManifests(dir, [validate(fixture())])
    const entries = JSON.parse(readFileSync(join(dir, 'src/generated/recap-page-paths.json'), 'utf8'))
    assert.deepEqual(entries, [{ path: '/analytics/fixturechan/123', category: 'stream_recap' }])
  } finally {
    if (dirname(resolve(dir)) !== parent || !resolve(dir).startsWith(join(parent, 'streampulse-recap-test-'))) throw new Error('Refusing unsafe test cleanup')
    rmSync(dir, { recursive: true })
  }
})

test('the production manifest has no synthetic review candidates', () => {
  const manifest = JSON.parse(readFileSync(new URL('../content/recap-pilot.json', import.meta.url), 'utf8'))
  assert.doesNotMatch(JSON.stringify(manifest), /fixturechan|Synthetic fixture/)
})
