#!/usr/bin/env node
/**
 * Render public/favicon.svg to the two icons browsers and crawlers ask for by
 * name: public/favicon.ico (16, 32 and 48 px) and public/apple-touch-icon.png
 * (180 px, on the mark's own background, since iOS fills transparent corners).
 * Run by hand after changing the mark; the files are committed and the build
 * never renders them.
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pub = join(here, '..', '..', 'public')
const svg = readFileSync(join(pub, 'favicon.svg'), 'utf8')
const background = /<rect[^>]*fill="(#[0-9a-f]{6})"/i.exec(svg)?.[1]
if (!background) throw new Error('favicon.svg: no background rect to fill the touch icon with')

async function render(page, size, fill) {
  await page.setViewportSize({ width: size, height: size })
  const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" `)
  await page.setContent(`<!doctype html><body style="margin:0;background:${fill ?? 'transparent'}">${sized}</body>`)
  return page.screenshot({ clip: { x: 0, y: 0, width: size, height: size }, omitBackground: !fill })
}

/** An .ico holding PNG images, which every current browser reads. */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i
    header.writeUInt8(size >= 256 ? 0 : size, at)
    header.writeUInt8(size >= 256 ? 0 : size, at + 1)
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(png.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...images.map(({ png }) => png)])
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  const images = []
  for (const size of [16, 32, 48]) images.push({ size, png: await render(page, size) })
  writeFileSync(join(pub, 'favicon.ico'), ico(images))
  writeFileSync(join(pub, 'apple-touch-icon.png'), await render(page, 180, background))
  console.log(`icons: wrote ${join(pub, 'favicon.ico')} and ${join(pub, 'apple-touch-icon.png')}`)
} finally {
  await browser.close()
}
