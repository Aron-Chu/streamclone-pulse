/** Actual local-browser check for the isolated nonempty build from recap-pages-proof.mjs. */
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:17641')
assert.equal(base.protocol, 'http:')
assert.ok(['localhost', '127.0.0.1'].includes(base.hostname), 'Only an isolated loopback Pages proof is supported')
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.cache', 'recap-browser-proof')
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const blocked = []
const captureProof = process.argv.includes('--capture-proof')
const captures = []
await context.route('**/*', route => {
  const target = new URL(route.request().url())
  if (target.origin === base.origin) return route.continue()
  if (captureProof && target.href === 'https://us.i.posthog.com/i/v0/e/') {
    if (route.request().method() === 'POST') captures.push(JSON.parse(route.request().postData()))
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': base.origin,
      'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' } })
  }
  blocked.push(target.toString())
  return route.abort('blockedbyclient')
})
const page = await context.newPage()
const checks = []
try {
  const response = await page.goto(new URL('/analytics/fixturechan/123', base).toString())
  assert.equal(response.status(), 200)
  const source = await response.text()
  assert.match(source, /data-recap-summary/)
  assert.match(source, /content="index,follow"/)
  assert.match(source, /application\/ld\+json/)
  await page.locator('[data-reviewed-recap-mounted]').waitFor({ state: 'visible' })
  assert.equal(await page.title(), 'Fixture Channel reaction recap — StreamPulse')
  assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'index,follow')
  await page.getByRole('heading', { name: 'Fixture Channel reaction recap — StreamPulse', exact: true }).waitFor()
  assert.equal(await page.locator('[data-reviewed-recap-mounted]').count(), 1)
  checks.push('Reviewed content, exact metadata, JSON-LD and indexability survive actual app boot')
  await page.screenshot({ path: join(out, 'reviewed-recap-desktop.png'), fullPage: true })

  let reachedGuide = false
  for (let i = 0; i < 20; i += 1) {
    await page.keyboard.press('Tab')
    if ((await page.evaluate(() => document.activeElement?.textContent))?.includes('Get StreamPulse for tracked Twitch streams')) {
      reachedGuide = true
      break
    }
  }
  assert.ok(reachedGuide, 'Keyboard traversal must reach the real install guide')
  await page.keyboard.press('Enter')
  await page.waitForURL('**/docs#extension')
  await page.getByRole('heading', { name: '1. Install the StreamPulse extension' }).waitFor()
  checks.push('Tab and Enter reach the existing install guide')
  await page.goBack()
  await page.locator('[data-reviewed-recap-mounted]').waitFor({ state: 'visible' })
  if (captureProof) {
    assert.equal(captures.length, 0, 'No capture before voluntary consent')
    const preferences = page.locator('[data-reviewed-recap-mounted] .analytics-preferences')
    await preferences.locator('summary').click()
    await preferences.getByRole('button', { name: 'Allow anonymous analytics' }).click()
    await page.waitForFunction(() => document.querySelector('[data-reviewed-recap-mounted] .analytics-preferences')?.textContent.includes('analytics are on'))
    await expect.poll(() => captures.length).toBe(1)
    assert.equal(captures[0].properties.page_category, 'stream_recap')
    await preferences.locator('summary').click()
  }
  const cta = page.locator('[data-reviewed-recap-mounted]').getByRole('link', { name: 'Add StreamPulse to Chrome', exact: true })
  const popupPromise = context.waitForEvent('page')
  await cta.click()
  const popup = await popupPromise
  await popup.waitForLoadState('domcontentloaded').catch(() => undefined)
  assert.ok(blocked.some(url => url.includes('chromewebstore.google.com/detail/streampulse/nifgoonpcgmdhiffcpmhndjgkgahnelg')))
  await popup.close()
  if (captureProof) {
    await expect.poll(() => captures.length).toBe(2)
    assert.equal(captures[1].properties.cta, 'install_extension')
    assert.equal(captures[1].properties.page_category, 'stream_recap')
  }
  checks.push('Install click opens the canonical store destination; external request blocked by proof guard')

  const preferences = page.locator('[data-reviewed-recap-mounted] .analytics-preferences')
  await preferences.locator('summary').click()
  assert.equal(await preferences.evaluate(element => element.open), true)
  await page.keyboard.press('Escape')
  assert.equal(await preferences.evaluate(element => element.open), false)
  checks.push('Voluntary analytics disclosure opens and Escape closes it; no consent forced')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(out, 'reviewed-recap-mobile.png'), fullPage: true })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  checks.push('390px arrival has no horizontal overflow')

  const unknown = await page.goto(new URL('/analytics/fixturechan/999', base).toString())
  const unknownSource = await unknown.text()
  assert.match(unknownSource, /content="noindex,nofollow"/)
  assert.doesNotMatch(unknownSource, /data-recap-summary/)
  checks.push('Unapproved deep path remains a noindexed fallback without another page snapshot')
  if (captureProof) {
    assert.equal(captures.length, 2, 'Unknown channel paths remain excluded')
    await page.goto(new URL('/tools/twitch-vod-timestamp-link?campaign=private-proof', base).toString())
    await page.getByRole('heading', { name: 'Twitch VOD timestamp link builder', exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelector('.analytics-preferences')?.textContent.includes('analytics are on'))
    await expect.poll(() => captures.length).toBe(3)
    assert.equal(captures[2].properties.page_category, 'tool')
    await page.getByLabel('Twitch VOD link or video ID', { exact: true }).fill('2916038039')
    await page.getByLabel('Start time', { exact: true }).fill('12345')
    await page.getByRole('button', { name: 'Build timestamp link', exact: true }).click()
    await page.getByRole('link', { name: 'Open on Twitch', exact: true }).waitFor()
    assert.equal(captures.length, 3, 'Form actions and generated links are not captured')
    const preferences = page.locator('.analytics-preferences')
    await preferences.locator('summary').click()
    await preferences.getByRole('button', { name: 'Turn analytics off', exact: true }).click()
    await page.goto(new URL('/guides/twitch-vod-timestamps', base).toString())
    await page.getByRole('heading', { name: 'Twitch VOD availability and timestamps explained', exact: true }).waitFor()
    assert.equal(captures.length, 3, 'Withdrawal stops later page events')
    for (const event of captures) {
      assert.deepEqual(Object.keys(event.properties).sort(), ['$geoip_disable', '$process_person_profile', ...(event.properties.cta ? ['cta'] : []), 'page_category'].sort())
      assert.equal(event.api_key, 'phc_localproof', 'Only the synthetic proof token is permitted')
    }
    assert.doesNotMatch(JSON.stringify(captures), /fixturechan|2916038039|12345|private-proof|pathname|referrer|current_url/)
    checks.push('Actual consented recap/tool beacons contain coarse categories only; pre-consent, unknown pages, inputs and withdrawal stay excluded. Requests intercepted locally; no delivery claim')
  }
  writeFileSync(join(out, 'result.json'), JSON.stringify({ scope: 'isolated synthetic nonempty real build; all external network blocked', base: base.origin, checks, blockedRequests: blocked.length }, null, 2))
  console.log(JSON.stringify({ output: out, checks }, null, 2))
} finally {
  await context.close()
  await browser.close()
}
