import test from 'node:test'
import assert from 'node:assert/strict'
import { sitemapWithStatedDates, statedUpdateDate } from './sitemap-lastmod.mjs'

test('reads the date a page states, and nothing else', () => {
  assert.equal(statedUpdateDate('<p>Last updated: November 2, 2026 · Applies to</p>'), '2026-11-02')
  assert.equal(statedUpdateDate('<p>Last updated: October 13, 2026</p>'), '2026-10-13')
  assert.equal(statedUpdateDate('<h1>Find your streamer</h1>'), null)
  assert.throws(() => statedUpdateDate('<p>Last updated: Smarch 2, 2026</p>'), /Unreadable/)
  assert.throws(() => statedUpdateDate('<p>Last updated: February 30, 2026</p>'), /Unreadable/)
})

test('adds lastmod only to the pages that state a date', () => {
  const source = [
    '<urlset>',
    '  <url><loc>https://streampulse.stream/</loc></url>',
    '  <url><loc>https://streampulse.stream/privacy</loc></url>',
    '  <url><loc>https://streampulse.stream/analytics/x/1</loc><lastmod>2026-11-01T17:00:00Z</lastmod></url>',
    '</urlset>',
  ].join('\n')
  const out = sitemapWithStatedDates(source, new Map([['https://streampulse.stream/privacy', '2026-11-02']]))
  assert.match(out, /<loc>https:\/\/streampulse\.stream\/<\/loc><\/url>/)
  assert.match(out, /<loc>https:\/\/streampulse\.stream\/privacy<\/loc><lastmod>2026-11-02<\/lastmod><\/url>/)
  assert.match(out, /<lastmod>2026-11-01T17:00:00Z<\/lastmod>/)
  assert.equal(out.match(/<lastmod>/g).length, 2)
})
