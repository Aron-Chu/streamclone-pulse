import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { validatePilot, metadataForPage, writeRuntimeManifests, renderRecapSummary, renderRecapDocument, recapStructuredData, recapRedirects, sitemapWithRecaps, replayUrl, recapHeading, otherRecaps } from './recap-pilot.mjs'

import { fixture } from './fixtures/recap-pilot.mjs'
const now = new Date('2026-10-31T18:00:00Z')

function validate(page) { return validatePilot({ schemaVersion: 1, pages: [page] }, { now })[0] }

test('uses canonical draft OR alternatives and honest partial coverage', () => {
  assert.equal(validate(fixture()).path, '/analytics/fixturechan/123')
  assert.equal(validate(fixture({ durationSeconds: 3000, nonMissingRollupMinutes: 30 })).coverage.state, 'partial')
  assert.throws(() => validate(fixture({ durationSeconds: 3000, nonMissingRollupMinutes: 29 })), /duration/)
  assert.throws(() => validate(fixture({ durationSeconds: 1000, nonMissingRollupMinutes: 30 })), /exceed/)
})

test('fails closed for fewer than three moments, unknown coverage and an unapproved, future-dated or inverted review', () => {
  assert.throws(() => validate(fixture({ moments: [{ offsetSeconds: 100, score: 90 }, { offsetSeconds: 200, score: 80 }] })), /top 3/)
  assert.throws(() => validate(fixture({ moments: [] })), /top 3/)
  assert.throws(() => validate(fixture({ moments: Array.from({ length: 21 }, (_, i) => ({ offsetSeconds: i * 60, score: 50 })) })), /top 3/)
  assert.throws(() => validate(fixture({ coverage: { state: 'unknown', description: 'Unknown.' } })), /coverage/)
  for (const review of [{ ...fixture().review, approved: false }, { ...fixture().review, reviewedAt: '2026-11-01T17:00:00Z' }, { ...fixture().review, reviewedAt: '2026-10-31T17:00:00Z', expiresAt: '2026-10-31T17:00:00Z' }]) {
    assert.throws(() => validatePilot({ schemaVersion: 1, pages: [fixture({ review })] }, { now, warn() {} }), /review/)
  }
})

// A second, distinct reviewed page, so one can expire while the other stays.
function second() {
  return fixture({ streamId: '124', title: 'Second fixture recap — StreamPulse', description: 'A second synthetic aggregate fixture for the expiry tests.',
    summary: 'Second synthetic fixture: a different reviewed summary for the expiry tests.',
    review: { ...fixture().review, sourceUrl: 'https://api.streampulse.stream/v1/portal/analytics/streams/124/recap' } })
}

test('an expired review leaves that page out with a warning instead of failing the build', () => {
  const warnings = []
  const expired = fixture({ review: { ...fixture().review, expiresAt: now.toISOString() } })
  const pages = validatePilot({ schemaVersion: 1, pages: [expired, second()] }, { now, warn: message => warnings.push(message) })
  assert.deepEqual(pages.map(page => page.path), ['/analytics/fixturechan/124'])
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /pages\[0\] \/analytics\/fixturechan\/123: review expired at 2026-10-31T18:00:00/)
  // Every page expired: an empty pilot, which /recaps already shows as "No reviewed recaps yet".
  assert.deepEqual(validatePilot({ schemaVersion: 1, pages: [expired] }, { now, warn() {} }), [])
})

test('an expired page is still fully validated and still counts toward duplicates', () => {
  const expiredReview = { ...fixture().review, expiresAt: now.toISOString() }
  assert.throws(() => validatePilot({ schemaVersion: 1, pages: [fixture({ review: expiredReview, rawChat: ['private'] })] }, { now, warn() {} }), /unsupported field/)
  assert.throws(() => validatePilot({ schemaVersion: 1, pages: [fixture({ review: { ...expiredReview, approved: false } })] }, { now, warn() {} }), /manual review/)
  assert.throws(() => validatePilot({ schemaVersion: 1, pages: [fixture({ review: expiredReview }), fixture()] }, { now, warn() {} }), /duplicate/)
})

test('by default the expiry warning goes to the build log', t => {
  const warn = t.mock.method(console, 'warn', () => {})
  validatePilot({ schemaVersion: 1, pages: [fixture({ review: { ...fixture().review, expiresAt: now.toISOString() } })] }, { now })
  assert.equal(warn.mock.callCount(), 1)
  assert.match(warn.mock.calls[0].arguments[0], /^Recap pilot: pages\[0\] .*review expired.*left out until it is reviewed again/)
})

test('a stream qualifies on its own top 3, whatever their absolute scores (owner decision 2026-11-05)', () => {
  const quiet = [{ offsetSeconds: 100, score: 41 }, { offsetSeconds: 200, score: 22 }, { offsetSeconds: 300, score: 9 }]
  assert.equal(validate(fixture({ moments: quiet })).moments.length, 3)
  // The old alternative gate is gone, not silently ignored.
  assert.throws(() => validate(fixture({ peakChatThreshold: { minimum: 100, observed: 120, rationale: 'Retired.' } })), /unsupported field peakChatThreshold/)
})

test('rejects raw/private fields, unsafe identities and mismatched provenance', () => {
  assert.throws(() => validate(fixture({ rawChat: ['private'] })), /unsupported field/)
  assert.throws(() => validate(fixture({ login: '../bad' })), /login/)
  assert.throws(() => validate(fixture({ login: 123 })), /login/)
  assert.throws(() => validate(fixture({ streamId: 123 })), /identity/)
  assert.throws(() => validate(fixture({ login: 'moments' })), /login/)
  assert.throws(() => validate(fixture({ review: { ...fixture().review, sourceUrl: 'https://api.streampulse.stream/v1/portal/analytics/streams/999/recap' } })), /identity/)
  assert.throws(() => validate(fixture({ review: { ...fixture().review, sourceUrl: 'https://user:pass@api.streampulse.stream/v1/portal/analytics/streams/123/recap' } })), /identity/)
  assert.throws(() => validate(fixture({ moments: [{ offsetSeconds: -1, score: 80 }, ...fixture().moments.slice(1)] })), /nonnegative/)
})

test('deduplicates output paths, summaries and timestamps', () => {
  assert.throws(() => validatePilot({ schemaVersion: 1, pages: [fixture(), fixture()] }, { now }), /duplicate/)
  assert.throws(() => validatePilot({ schemaVersion: 1, pages: [fixture(), fixture({ streamId: '124', summary: 'A different unique reviewed summary.', review: { ...fixture().review, sourceUrl: 'https://api.streampulse.stream/v1/portal/analytics/streams/124/recap' } })] }, { now }), /duplicate/)
  assert.throws(() => validate(fixture({ moments: [{ offsetSeconds: 100, score: 75 }, { offsetSeconds: 100, score: 90 }, { offsetSeconds: 300, score: 60 }] })), /duplicate/)
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
  // One URL per recap: every trailing-slash form redirects to the canonical path, never a second 200 copy.
  for (const alias of ['/analytics/fixturechan/123/', '/s/fixturechan/123/', '/analytics/fixturechan/s/123/']) {
    assert.ok(rules.includes(`${alias} /analytics/fixturechan/123 301`), alias)
  }
  assert.ok(rules.every(rule => !/\/ \S+ 200$/.test(rule) || rule.startsWith('/analytics/:login')), 'no trailing-slash 200 rewrite for a recap')
  assert.ok(rules.indexOf('/analytics/fixturechan/123/ /analytics/fixturechan/123 301') < rules.indexOf('/analytics/:login/:streamId /analytics-fallback/ 200'))
  assert.doesNotMatch(recapRedirects(source, []), /fixturechan/)
  assert.throws(() => recapRedirects('', [page]), /marker/)
})

test('one heading without the brand, a breadcrumb back to /recaps and links to the other recaps', () => {
  const page = validate(fixture())
  const sameChannel = validate(fixture({ streamId: '124', title: 'Fixture Channel second recap — StreamPulse', description: 'Second synthetic fixture.', summary: 'Second synthetic summary.', startedAt: '2026-10-29T12:00:00Z', review: { ...fixture().review, sourceUrl: 'https://api.streampulse.stream/v1/portal/analytics/streams/124/recap' } }))
  const otherChannel = validate(fixture({ login: 'otherchan', displayName: 'Other', streamId: '125', title: 'Other recap — StreamPulse', description: 'Third synthetic fixture.', summary: 'Third synthetic summary.', startedAt: '2026-10-30T18:00:00Z', review: { ...fixture().review, sourceUrl: 'https://api.streampulse.stream/v1/portal/analytics/streams/125/recap' } }))
  assert.equal(recapHeading(page), 'Fixture Channel reaction recap')
  const html = renderRecapSummary(page, [page, otherChannel, sameChannel])
  assert.deepEqual([...html.matchAll(/<h1>([^<]*)<\/h1>/g)].map(m => m[1]), ['Fixture Channel reaction recap'])
  assert.doesNotMatch(html, /<h[1-6]>\s*<\/h[1-6]>/)
  assert.match(html, /<nav[^>]*aria-label="Breadcrumb"><a href="\/">Home<\/a>.*<a href="\/recaps">Recaps<\/a>.*<span aria-current="page">Fixture Channel reaction recap<\/span><\/nav><h1>/)
  // This channel's other recap comes first, then other channels; never the page itself.
  assert.deepEqual(otherRecaps(page, [page, otherChannel, sameChannel]).map(other => other.path), ['/analytics/fixturechan/124', '/analytics/otherchan/125'])
  assert.match(html, /<h2>More recaps<\/h2><ul><li><a href="\/analytics\/fixturechan\/124">Fixture Channel second recap<\/a><\/li><li><a href="\/analytics\/otherchan\/125">Other recap<\/a><\/li><\/ul>/)
  assert.doesNotMatch(renderRecapSummary(page, [page]), /More recaps/)
  const crumbs = JSON.parse(recapStructuredData(page)).breadcrumb.itemListElement
  assert.deepEqual(crumbs.map(crumb => [crumb.position, crumb.name, crumb.item]), [[1, 'Home', 'https://streampulse.stream/'], [2, 'Recaps', 'https://streampulse.stream/recaps'], [3, 'Fixture Channel reaction recap', 'https://streampulse.stream/analytics/fixturechan/123']])
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
    const list = JSON.parse(readFileSync(join(dir, 'src/generated/recap-page-list.json'), 'utf8'))
    assert.deepEqual(list, [{ path: '/analytics/fixturechan/123', heading: 'Fixture Channel reaction recap', description: 'A deliberately synthetic aggregate fixture for the recap tests.' }])
  } finally {
    if (dirname(resolve(dir)) !== parent || !resolve(dir).startsWith(join(parent, 'streampulse-recap-test-'))) throw new Error('Refusing unsafe test cleanup')
    rmSync(dir, { recursive: true })
  }
})

test('the production manifest has no synthetic review candidates', () => {
  const manifest = JSON.parse(readFileSync(new URL('../content/recap-pilot.json', import.meta.url), 'utf8'))
  assert.doesNotMatch(JSON.stringify(manifest), /fixturechan|Synthetic fixture/)
})
