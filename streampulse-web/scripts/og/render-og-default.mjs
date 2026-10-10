#!/usr/bin/env node
/**
 * Render scripts/og/og-default.html to public/og-default.png (1200x630), the
 * shared link-preview card that scripts/prerender.mjs names in og:image and
 * twitter:image. Run by hand after changing the card; the PNG is committed and
 * the build never renders it.
 */
import { chromium } from 'playwright'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = pathToFileURL(join(here, 'og-default.html')).href
const output = join(here, '..', '..', 'public', 'og-default.png')

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  await page.goto(source)
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: output, clip: { x: 0, y: 0, width: 1200, height: 630 } })
  console.log(`og-default: wrote ${output}`)
} finally {
  await browser.close()
}
