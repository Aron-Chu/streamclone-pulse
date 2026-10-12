import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

/**
 * /changelog in a real browser (2026-10-11, mockup release-notes D, website
 * part): one rule under the header, the latest release's highlights first,
 * groups folded to counts with Changed and Known limitations open, and a
 * "See all changes" link that lands on the full list. Read from the notes on
 * disk, so marking a version released changes no test.
 */

interface Release {
  version: string
  status: string
  preview?: string[]
  new?: string[]
  changed?: string[]
  improved?: string[]
  fixed?: string[]
  knownIssues?: string[]
}

const notes = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/shared/release-notes.json'), 'utf8')) as { releases: Release[] }
const released = notes.releases.filter((release) => release.status === 'released')
const latest = released[0]
const GROUPS = ['new', 'changed', 'improved', 'fixed', 'knownIssues'] as const
const OPEN_GROUPS = ['changed', 'knownIssues']

async function openChangelog(page: Page) {
  const origin = new URL(test.info().project.use.baseURL ?? 'http://127.0.0.1:4173').origin
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/v1/')) return route.fulfill({ status: 503, json: { error: 'unavailable' } })
    return url.origin === origin ? route.continue() : route.abort('blockedbyclient')
  })
  await page.goto('/changelog')
  await expect(page.getByTestId('changelog-page')).toBeVisible()
}

test('one rule under the header, then the latest release with its highlights first', async ({ page }) => {
  await openChangelog(page)
  const rules = await page.getByTestId('changelog-page').evaluate((article) => {
    const header = article.querySelector('header')!
    const first = article.querySelector('section')!
    // Everything drawn between the header's text and the first section's text.
    const between = [header, ...Array.from(article.children).filter((node) => node !== header && node !== first && header.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING && node.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING), first]
    const widths = between.flatMap((node) => {
      const style = getComputedStyle(node)
      return [
        node === first ? 0 : parseFloat(style.borderBottomWidth),
        node === header ? 0 : parseFloat(style.borderTopWidth),
      ]
    })
    return { visible: widths.filter((width) => width > 0).length, firstSection: first.id }
  })
  expect(rules).toEqual({ visible: 1, firstSection: `v${latest.version}` })
  await expect(page.getByText('What changed in each version of the StreamPulse extension.')).toBeVisible()

  if ((latest.preview?.length ?? 0) > 0) {
    const card = page.getByTestId('changelog-whats-new')
    await expect(card).toBeVisible()
    await expect(card.locator('li')).toHaveText(latest.preview!.slice(0, 3))
    // The card is the first thing in the latest release's section.
    const order = await page.locator(`[id="v${latest.version}"]`).evaluate((section) => section.firstElementChild?.getAttribute('data-testid'))
    expect(order).toBe('changelog-whats-new')
    await card.getByRole('link', { name: 'See all changes ↓' }).click()
    await expect(page).toHaveURL(new RegExp(`#v${latest.version.replace(/\./g, '\\.')}-changes$`))
    // The full list starts near the top of the view, not under the sticky site header.
    const target = page.locator(`[id="v${latest.version}-changes"]`)
    await expect.poll(() => target.evaluate((node) => {
      const box = node.getBoundingClientRect()
      const hit = document.elementFromPoint(box.left + 4, box.top + box.height / 2)
      return Boolean(hit && node.contains(hit)) && box.top >= 0 && box.top < 300
    })).toBe(true)
  }
})

test('groups fold to counts, with Changed and Known limitations open', async ({ page }) => {
  await openChangelog(page)
  for (const release of released) {
    const section = page.locator(`[id="v${release.version}"]`)
    const filled = GROUPS.filter((key) => (release[key]?.length ?? 0) > 0)
    await expect(section.locator('details')).toHaveCount(filled.length)
    for (const key of filled) {
      const group = section.locator(`details[data-category="${key}"]`)
      const items = release[key]!
      await expect(group.locator('summary')).toContainText(String(items.length))
      if (OPEN_GROUPS.includes(key)) {
        await expect(group).toHaveAttribute('open', '')
        await expect(group.locator('li').first()).toBeVisible()
      } else {
        await expect(group).not.toHaveAttribute('open', '')
        await expect(group.locator('li').first()).toBeHidden()
      }
    }
  }
  // A folded group opens on a click and shows its items.
  const category = await page.locator(`[id="v${latest.version}"] details:not([open])`).first().getAttribute('data-category')
  const folded = page.locator(`[id="v${latest.version}"] details[data-category="${category}"]`)
  await folded.locator('summary').click()
  await expect(folded).toHaveAttribute('open', '')
  await expect(folded.locator('li').first()).toBeVisible()
})

test('fits a 390px phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openChangelog(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  if ((latest.preview?.length ?? 0) > 0) await expect(page.getByTestId('changelog-whats-new')).toBeVisible()
})
