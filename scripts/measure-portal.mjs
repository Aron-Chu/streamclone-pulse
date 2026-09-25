// Layout measurement snapshot — hub + channel, multiple viewports, before any changes.
// Usage: node ../scripts/measure-portal.mjs
import { chromium } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Optional pinned browser; Playwright's managed Chromium otherwise.
const BROWSER = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined
const BASE = 'http://localhost:5173'
// A private, freshly created directory rather than a fixed shared temp path.
const OUTDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-metrics-'))

const browser = await chromium.launch({ headless: true, executablePath: BROWSER })

async function measure(page, url, tag, errors) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(9000) // charts/listings settle
  await page.screenshot({ path: `${OUTDIR}/${tag}.png`, fullPage: false })

  const data = await page.evaluate(() => {
    const rect = (el) => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return {
        x: Math.round(r.x), y: Math.round(r.y),
        w: Math.round(r.width), h: Math.round(r.height),
        right: Math.round(r.right), bottom: Math.round(r.bottom),
        scrollW: el.scrollWidth, clientW: el.clientWidth,
        overflowX: el.scrollWidth > el.clientWidth + 1,
      }
    }
    // Find elements by contained text (case-insensitive) — take the smallest visible match.
    const byText = (needle) => {
      const all = [...document.querySelectorAll('body *')]
        .filter((el) => el.children.length === 0 || el.textContent?.trim() === needle)
        .filter((el) => {
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
          return t.toLowerCase().includes(needle.toLowerCase())
        })
        .filter((el) => {
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.height > 0
        })
      if (!all.length) return null
      all.sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width)
      return all[0]
    }
    const chain = (el) => {
      const out = []
      let cur = el
      for (let i = 0; cur && i < 6; i++) {
        const r = cur.getBoundingClientRect()
        out.push(`${cur.tagName.toLowerCase()}${cur.className?.toString ? '.' + String(cur.className).trim().slice(0, 60) : ''}[${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}]`)
        cur = cur.parentElement
      }
      return out
    }
    const grab = (needle) => {
      const el = byText(needle)
      return { needle, rect: rect(el), chain: chain(el) }
    }
    const d = document.documentElement
    return {
      viewport: { w: innerWidth, h: innerHeight },
      scrollSize: { w: d.scrollWidth, h: d.scrollHeight },
      hOverflowX: d.scrollWidth > innerWidth + 1,
      hOverflowBy: d.scrollWidth - innerWidth,
      // fixed/sticky right-edge elements (candidate rails)
      fixed: [...document.querySelectorAll('*')]
        .filter((el) => {
          const s = getComputedStyle(el)
          const r = el.getBoundingClientRect()
          return (s.position === 'fixed' || s.position === 'sticky') && r.width > 0 && r.height > 0
        })
        .map((el) => {
          const r = el.getBoundingClientRect()
          return {
            tag: el.tagName.toLowerCase(),
            cls: String(el.className).slice(0, 60),
            pos: getComputedStyle(el).position,
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) },
          }
        })
        .sort((a, b) => b.rect.w - a.rect.w),
      blocks: {
        hottestLive: grab('hottest live'),
        globalActivity: grab('global activity'),
        activityGraph: grab('activity'),
        cardTitle: grab('card'),
        liveWire: grab('live wire'),
        viewsLabel: grab('viewers'),
        currentLabel: grab('current'),
        chatLabel: grab('chat'),
        focusChart: grab('focus chart'),
        hideStreams: grab('hide streams'),
      },
    }
  })
  const lines = [`=== ${tag} @ ${data.viewport.w}x${data.viewport.h} ===`]
  lines.push(`scrollSize ${data.scrollSize.w}x${data.scrollSize.h}  hOverflowX=${data.hOverflowX} (by ${data.hOverflowBy}px)`)
  for (const [k, v] of Object.entries(data.blocks)) {
    lines.push(`\n[${k}] ${v.needle}`)
    lines.push(`  rect: ${v.rect ? JSON.stringify(v.rect) : 'NOT FOUND'}`)
    lines.push(`  chain: ${v.chain ? v.chain.join(' > ') : ''}`)
  }
  lines.push('\nfixed/sticky right-edge elements (top 8 by width):')
  for (const f of data.fixed.slice(0, 8)) {
    lines.push(`  ${f.pos} ${f.tag}.${f.cls} ${JSON.stringify(f.rect)}`)
  }
  lines.push(`console errors: ${errors.length ? errors.join(' | ') : '(none)'}`)
  return lines.join('\n')
}

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })

const out = []
out.push(await measure(page, `${BASE}/analytics`, 'hub-1440', errors))
errors.length = 0
out.push(await measure(page, `${BASE}/analytics/jynxzi`, 'channel-1440', errors))

// Narrower viewport for the rail-squish check
await page.setViewportSize({ width: 1024, height: 800 })
errors.length = 0
out.push(await measure(page, `${BASE}/analytics/jynxzi`, 'channel-1024', errors))
errors.length = 0
// Wide
await page.setViewportSize({ width: 1920, height: 1080 })
out.push(await measure(page, `${BASE}/analytics/jynxzi`, 'channel-1920', errors))

fs.writeFileSync(`${OUTDIR}/measurements.txt`, out.join('\n\n'))
console.log(out.join('\n\n'))
await browser.close()