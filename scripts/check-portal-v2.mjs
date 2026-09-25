// Quick render check: navigate, collect console errors + pageerrors, screenshot.
import { chromium } from 'playwright'

const BASE = process.env.CHECK_URL || 'http://localhost:5173/analytics/jynxzi'
const OUT = process.env.CHECK_OUT || '/tmp/portal-check-v2'
const browser = await chromium.launch({
  headless: true,
  executablePath: '/home/aron/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`[console.error] ${msg.text().slice(0, 500)}`)
})
page.on('pageerror', (err) => errors.push(`[pageerror] ${String(err).slice(0, 500)}`))
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 }).catch((e) => errors.push(`[goto] ${e.message.slice(0, 300)}`))
await page.waitForTimeout(4000)
await page.screenshot({ path: `${OUT}.png`, fullPage: false })
const title = await page.title().catch(() => '')
const bodyText = (await page.evaluate(() => document.body.innerText)).slice(0, 1200)
console.log('TITLE:', title)
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)')
console.log('BODY:', JSON.stringify(bodyText))
await browser.close()