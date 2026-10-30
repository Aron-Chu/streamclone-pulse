import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from './helpers/portalMockedTest'

// .invalid never resolves, so even a broken guard could not reach anything.
const UNROUTED = 'https://unrouted.streampulse.invalid/v1/probe'
const SPEC_DIR = dirname(fileURLToPath(import.meta.url))

test.describe('portal-mocked network guard', () => {
  test('refuses an unrouted https request and records it', async ({ page, networkGuard }) => {
    expect((await page.goto('/robots.txt'))?.status()).toBe(200)
    const outcome = await page.evaluate((url) => fetch(url).then(() => 'reached', () => 'refused'), UNROUTED)
    expect(outcome).toBe('refused')
    expect(networkGuard.refused).toEqual([`GET ${UNROUTED}`])
    // Asserted above; clear it so only the next test shows the failure.
    networkGuard.refused.length = 0
  })

  test('an unrouted request fails the test', async ({ page }) => {
    test.fail(true, 'the guard must fail any test that makes an unrouted request')
    await page.goto('/robots.txt')
    await page.evaluate((url) => fetch(url).catch(() => null), UNROUTED)
  })

  test('spec routes still win, and image hosts get a placeholder PNG', async ({ page, networkGuard }) => {
    await page.route(UNROUTED, (route) => route.fulfill({ json: { ok: true } }))
    await page.goto('/robots.txt')
    const answers = await page.evaluate(
      (urls) => Promise.all(urls.map(async (url) => {
        const response = await fetch(url)
        return `${response.status} ${response.headers.get('content-type')}`
      })),
      [UNROUTED, 'https://cdn.7tv.app/emote/probe/1x.webp'],
    )
    expect(answers).toEqual(['200 application/json', '200 image/png'])
    expect(networkGuard.refused).toEqual([])
  })

  test('every portal-mocked spec runs under the guard', () => {
    const unguarded = readdirSync(SPEC_DIR)
      .filter((name) => name.endsWith('.portal-mocked.spec.ts'))
      .filter((name) => {
        const source = readFileSync(join(SPEC_DIR, name), 'utf8')
        return /from '@playwright\/test'/.test(source)
          || !/from '\.\/helpers\/portalMockedTest'/.test(source)
          || /\.newContext\(/.test(source)
      })
    expect(unguarded, "import test from './helpers/portalMockedTest'; set context options with test.use()").toEqual([])
  })
})
