#!/usr/bin/env node
/**
 * Rasterize Peak mark into Chrome extension + CWS icon sizes.
 * Source of truth: store/cws/source/mark-peak-spike.png (operator-chosen Peak).
 *
 * Outputs:
 *   public/icons/icon{16,48,128}.png  — MV3 manifest (RGBA, transparent outside mark plate)
 *   store/cws/icons/icon128.png       — store listing icon (exact 128×128 RGBA)
 *   store/cws/icons/small-promo-440x280.png — small promo tile (opaque)
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
 * transparent page so omitBackground keeps real alpha. Promo tiles stay opaque.
 */
async function rasterize({ width, height, outPath, insetRatio = 0.08, promo = false }) {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  })

  const inset = Math.round(Math.min(width, height) * insetRatio)
  const plateRadius = Math.round(Math.min(width, height) * 0.22)
  const markSize = promo ? 152 : width - inset * 2
  const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  html, body {
    margin: 0;
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    background: ${promo ? '#050608' : 'transparent'};
  }
  .frame {
    box-sizing: border-box;
    width: ${width}px;
    height: ${height}px;
    display: grid;
    place-items: center;
    padding: ${inset}px;
    overflow: hidden;
    background: ${promo ? 'transparent' : '#050608'};
    border-radius: ${promo ? 0 : plateRadius}px;
    ${
      promo
        ? 'grid-template-columns: 152px minmax(0, 1fr); column-gap: 24px; padding: 28px 28px 28px 32px; align-items: center; justify-items: stretch; background: transparent;'
        : ''
    }
  }
  img.mark {
    width: ${markSize}px;
    height: ${markSize}px;
    object-fit: contain;
    display: block;
    border-radius: ${promo ? 36 : Math.round(markSize * 0.18)}px;
  }
  .copy {
    color: #e8eef5;
    font-family: Inter, Segoe UI, system-ui, sans-serif;
    min-width: 0;
    overflow: hidden;
  }
  .copy h1 {
    margin: 0 0 10px;
    font-size: 30px;
    font-weight: 700;
    letter-spacing: -0.02em;
    white-space: nowrap;
  }
  .copy p {
    margin: 0;
    font-size: 14px;
    color: #9aa7b8;
    line-height: 1.4;
  }
</style></head>
<body>
  <div class="frame">
    <img class="mark" alt="" src="${sourceDataUrl}" />
    ${
      promo
        ? `<div class="copy"><h1>StreamPulse</h1><p>Live Twitch overlay for viewers, chat, emotes, and games.</p></div>`
        : ''
    }
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
    omitBackground: !promo,
  })
  await browser.close()

  if (!promo) assertPngIhdr(exact, width, height)
  else {
    const w = exact.readUInt32BE(16)
    const h = exact.readUInt32BE(20)
    if (w !== width || h !== height) throw new Error(`promo expected ${width}x${height}, got ${w}x${h}`)
  }

  writeFileSync(outPath, exact)
  console.log(`Wrote ${outPath} (${width}x${height}${promo ? '' : ', RGBA'})`)
}

await rasterize({ width: 16, height: 16, outPath: join(publicIcons, 'icon16.png'), insetRatio: 0.06 })
await rasterize({ width: 48, height: 48, outPath: join(publicIcons, 'icon48.png'), insetRatio: 0.07 })
await rasterize({ width: 128, height: 128, outPath: join(publicIcons, 'icon128.png'), insetRatio: 0.08 })
copyFileSync(join(publicIcons, 'icon128.png'), join(storeIcons, 'icon128.png'))
await rasterize({
  width: 440,
  height: 280,
  outPath: join(storeIcons, 'small-promo-440x280.png'),
  insetRatio: 0.08,
  promo: true,
})

console.log('Peak CWS icons ready (store icon128 is RGBA 128×128)')
