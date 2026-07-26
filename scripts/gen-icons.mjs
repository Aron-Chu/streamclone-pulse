#!/usr/bin/env node
/**
 * Generate StreamPulse Peak extension icons at exact 16 / 48 / 128 px.
 * Source: streampulse-web/public/brand-peak.svg (portal Peak mark).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = join(root, 'streampulse-web', 'public', 'brand-peak.svg')
const outDir = join(root, 'public', 'icons')
const SIZES = [16, 48, 128]

function readPngSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) {
    throw new Error('PNG too small')
  }
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error('missing PNG signature')
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

const svg = readFileSync(svgPath, 'utf8')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  for (const size of SIZES) {
    await page.setViewportSize({ width: size, height: size })
    const sizedSvg = svg.replace(
      /<svg\b([^>]*)>/,
      `<svg width="${size}" height="${size}"$1>`,
    )
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8"></head>` +
        `<body style="margin:0;background:transparent;overflow:hidden">` +
        `${sizedSvg}</body></html>`,
      { waitUntil: 'load' },
    )
    const buf = await page.locator('svg').screenshot({ type: 'png', omitBackground: true })
    const { width, height } = readPngSize(buf)
    if (width !== size || height !== size) {
      throw new Error(`icon${size}.png rendered ${width}x${height}, expected ${size}x${size}`)
    }
    if (buf.length < 200) {
      throw new Error(`icon${size}.png too small (${buf.length} bytes) — likely a stub`)
    }
    const dest = join(outDir, `icon${size}.png`)
    writeFileSync(dest, buf)
    console.log(`Wrote ${dest} (${buf.length} bytes, ${width}x${height})`)
  }
} finally {
  await browser.close()
}
