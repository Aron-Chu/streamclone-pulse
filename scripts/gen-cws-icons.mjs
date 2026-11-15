#!/usr/bin/env node
/**
 * Rasterize Peak mark into Chrome extension + CWS icon sizes.
 * Source of truth: store/cws/source/mark-peak-spike.png (operator-chosen Peak).
 *
 * Outputs:
 *   public/icons/icon{16,48,128}.png  — MV3 manifest (RGBA, transparent outside mark plate)
 *   store/cws/icons/icon128.png       — store listing icon (exact 128×128 RGBA)
 *   store/cws/icons/small-promo-440x280.png — small promo tile (opaque)
 *   store/cws/icons/marquee-1400x560.png — marquee promo tile (opaque)
 *
 * CWS rejects or mis-renders 128×128 icons that are opaque RGB with a fake
 * “rounded” look baked into a solid square. Store + toolbar icons must keep a
 * real alpha channel outside the mark plate.
 */
import { mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePng = join(root, 'store/cws/source/mark-peak-spike.png')
const publicIcons = join(root, 'public/icons')
const storeIcons = join(root, 'store/cws/icons')

if (!existsSync(sourcePng)) {
  console.error(`Missing source: ${sourcePng}`)
  process.exit(1)
}

mkdirSync(publicIcons, { recursive: true })
mkdirSync(storeIcons, { recursive: true })

const sourceDataUrl = `data:image/png;base64,${readFileSync(sourcePng).toString('base64')}`

function assertPngIhdr(buf, width, height) {
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
    throw new Error('output is not a PNG')
  }
  const w = buf.readUInt32BE(16)
  const h = buf.readUInt32BE(20)
  const bitDepth = buf[24]
  const colorType = buf[25]
  if (w !== width || h !== height) {
    throw new Error(`expected ${width}x${height}, got ${w}x${h}`)
  }
  // 6 = RGBA truecolor+alpha (required for transparent store/toolbar icons)
  if (colorType !== 6) {
    throw new Error(`expected PNG color type 6 (RGBA), got ${colorType} (bitDepth=${bitDepth})`)
  }
}

/**
 * Draw Peak onto a canvas. Square icons use a dark rounded plate on a
 * transparent page so omitBackground keeps real alpha.
 */
async function rasterize({ width, height, outPath, insetRatio = 0.08 }) {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  })

  const inset = Math.round(Math.min(width, height) * insetRatio)
  const plateRadius = Math.round(Math.min(width, height) * 0.22)
  const markSize = width - inset * 2
  const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  html, body {
    margin: 0;
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    background: transparent;
  }
  .frame {
    box-sizing: border-box;
    width: ${width}px;
    height: ${height}px;
    display: grid;
    place-items: center;
    padding: ${inset}px;
    overflow: hidden;
    background: #050608;
    border-radius: ${plateRadius}px;
  }
  img.mark {
    width: ${markSize}px;
    height: ${markSize}px;
    object-fit: contain;
    display: block;
    border-radius: ${Math.round(markSize * 0.18)}px;
  }
</style></head>
<body>
  <div class="frame">
    <img class="mark" alt="" src="${sourceDataUrl}" />
  </div>
</body></html>`

  await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts?.ready?.catch?.(() => {}))
  await page.waitForFunction(() => {
    const img = document.querySelector('img.mark')
    return img && img.complete && img.naturalWidth > 0
  })

  const exact = await page.screenshot({
    type: 'png',
    clip: { x: 0, y: 0, width, height },
    animations: 'disabled',
    // Critical for CWS / toolbar: keep alpha outside the rounded plate.
    omitBackground: true,
  })
  await browser.close()

  assertPngIhdr(exact, width, height)
  writeFileSync(outPath, exact)
  console.log(`Wrote ${outPath} (${width}x${height}, RGBA)`)
}

// The store summary (manifest.json "description"), whose words both promo tiles carry.
const summary = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).description
const summaryLead = summary.split(':')[0]

/** A promo tile: the Peak mark beside the name and one line, opaque on the mark's own background. */
async function promoTile({ width, height, outPath, line, markSize, titleSize, lineSize, gap, padding }) {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; background: #050608; }
  .frame {
    box-sizing: border-box;
    width: ${width}px;
    height: ${height}px;
    padding: ${padding};
    display: grid;
    grid-template-columns: ${markSize}px minmax(0, 1fr);
    column-gap: ${gap}px;
    align-items: center;
  }
  img.mark { width: ${markSize}px; height: ${markSize}px; object-fit: contain; display: block; border-radius: ${Math.round(markSize * 0.24)}px; }
  .copy { color: #e8eef5; font-family: Inter, Segoe UI, system-ui, sans-serif; min-width: 0; }
  .copy h1 { margin: 0 0 ${Math.round(titleSize / 3)}px; font-size: ${titleSize}px; font-weight: 700; letter-spacing: -0.02em; white-space: nowrap; }
  .copy p { margin: 0; font-size: ${lineSize}px; color: #9aa7b8; line-height: 1.35; text-wrap: balance; }
</style></head>
<body><div class="frame"><img class="mark" alt="" src="${sourceDataUrl}" /><div class="copy"><h1>StreamPulse</h1><p>${line}</p></div></div></body></html>`

  await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts?.ready?.catch?.(() => {}))
  await page.waitForFunction(() => {
    const img = document.querySelector('img.mark')
    return img && img.complete && img.naturalWidth > 0
  })
  const overflow = await page.evaluate(() => document.querySelector('.copy').scrollHeight > document.querySelector('.frame').clientHeight)
  if (overflow) throw new Error(`${outPath}: the line does not fit the tile`)
  const exact = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height }, animations: 'disabled' })
  await browser.close()

  const w = exact.readUInt32BE(16)
  const h = exact.readUInt32BE(20)
  if (w !== width || h !== height) throw new Error(`promo expected ${width}x${height}, got ${w}x${h}`)
  writeFileSync(outPath, exact)
  console.log(`Wrote ${outPath} (${width}x${height})`)
}

await rasterize({ width: 16, height: 16, outPath: join(publicIcons, 'icon16.png'), insetRatio: 0.06 })
await rasterize({ width: 48, height: 48, outPath: join(publicIcons, 'icon48.png'), insetRatio: 0.07 })
await rasterize({ width: 128, height: 128, outPath: join(publicIcons, 'icon128.png'), insetRatio: 0.08 })
copyFileSync(join(publicIcons, 'icon128.png'), join(storeIcons, 'icon128.png'))
// The small tile shows in search results at its own size, so it carries the summary's lead only.
await promoTile({
  width: 440,
  height: 280,
  outPath: join(storeIcons, 'small-promo-440x280.png'),
  line: summaryLead,
  markSize: 152,
  titleSize: 30,
  lineSize: 18,
  gap: 24,
  padding: '28px 28px 28px 32px',
})
await promoTile({
  width: 1400,
  height: 560,
  outPath: join(storeIcons, 'marquee-1400x560.png'),
  line: summary,
  markSize: 300,
  titleSize: 76,
  lineSize: 32,
  gap: 64,
  padding: '0 120px',
})

console.log('Peak CWS icons ready (store icon128 is RGBA 128×128)')
