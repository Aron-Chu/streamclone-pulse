import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel, openTwitchVod } from '../helpers/mockTwitch.ts'

const PANEL = '#streamclone-pulse-root'

/** Twitch flips one class on <html> and repaints its own boxes. */
async function setTwitchTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate(theme => {
    const root = document.documentElement
    root.classList.remove('tw-root--theme-dark', 'tw-root--theme-light')
    root.classList.add(`tw-root--theme-${theme}`)
    let paint = document.getElementById('sp-test-twitch-paint')
    if (!paint) {
      paint = document.createElement('style')
      paint.id = 'sp-test-twitch-paint'
      document.head.append(paint)
    }
    // Paint every light-DOM box in Twitch's ground; shadow internals are untouched.
    paint.textContent = `html, body, body * { background-color: ${theme === 'light' ? '#ffffff' : '#0e0e10'} !important; }`
  }, theme)
  await expect(page.locator(PANEL)).toHaveAttribute('data-twitch-theme', theme)
  await settle(page)
}

async function settle(page: Page) {
  await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => undefined))))
  await page.waitForTimeout(150)
}

async function scrollPanelTo(element: Locator, gap = 12) {
  await element.evaluate((node, gap) => {
    let scroller: Element | null = node.parentElement
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement
    if (scroller) scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - gap
  }, gap)
  await settle(element.page())
}

async function shootPanel(page: Page, path: string) {
  // A docked panel is a fixed card inside a zero-size host.
  const box = await page.locator(PANEL).locator('.pulse-shell').first().boundingBox()
  await page.mouse.move(0, 0)
  await page.screenshot({ path, clip: { x: box!.x, y: box!.y, width: box!.width, height: box!.height } })
}

/**
 * Every visible text in the panel, with its colour composited over the
 * backgrounds behind it (Twitch's white page at the bottom). Text below 4.5:1,
 * or 3:1 when large, is returned. Disabled controls are exempt, as in WCAG.
 */
function lowContrastText(page: Page) {
  return page.locator(PANEL).evaluate(host => {
    type Rgba = [number, number, number, number]
    const parse = (value: string): Rgba | null => {
      const m = value.match(/rgba?\(([^)]+)\)/)
      if (!m) return null
      const [r, g, b, a = '1'] = m[1].split(/[\s,/]+/).filter(Boolean)
      return [Number(r), Number(g), Number(b), Number(a)]
    }
    const over = (top: Rgba, ground: Rgba): Rgba => [0, 1, 2].map(i => top[i] * top[3] + ground[i] * (1 - top[3])).concat(1) as Rgba
    const lum = (c: Rgba) => {
      const [r, g, b] = c.slice(0, 3).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const ratio = (a: Rgba, b: Rgba) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
    const parentOf = (el: Element): Element | null => el.parentElement ?? ((el.getRootNode() as ShadowRoot).host ?? null)
    const ground = (el: Element): Rgba => {
      const layers: Rgba[] = []
      for (let node: Element | null = el; node && node !== document.documentElement; node = parentOf(node)) {
        const bg = parse(getComputedStyle(node).backgroundColor)
        if (bg && bg[3] > 0) layers.push(bg)
        if (bg && bg[3] >= 1) break
      }
      return layers.reduceRight<Rgba>((acc, layer) => over(layer, acc), [255, 255, 255, 1])
    }
    const found: { text: string; color: string; ground: string; ratio: number }[] = []
    const root = host.shadowRoot!
    for (const el of root.querySelectorAll('*')) {
      const text = [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent!.trim()).join(' ').trim()
      if (!text || el.closest('svg, [aria-hidden="true"], :disabled, [aria-disabled="true"]')) continue
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      if (!rect.width || !rect.height || style.visibility === 'hidden' || Number(style.opacity) === 0) continue
      const fg = parse(style.color)
      if (!fg) continue
      const bg = ground(el)
      const value = ratio(over(fg, bg), bg)
      const size = parseFloat(style.fontSize)
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700)
      if (value < (large ? 3 : 4.5)) found.push({ text: text.slice(0, 40), color: style.color, ground: `rgb(${bg.slice(0, 3).map(Math.round).join(', ')})`, ratio: Math.round(value * 100) / 100 })
    }
    return found
  })
}

/** Light then dark, at each stop, so the pair can be compared side by side. */
async function captureStops(page: Page, stops: [string, Locator | null][], outputPath: (name: string) => string) {
  const failures: Awaited<ReturnType<typeof lowContrastText>> = []
  for (const theme of ['light', 'dark'] as const) {
    await setTwitchTheme(page, theme)
    // Twitch's panel white in light; the dark canvas comes back in dark.
    await expect(page.locator(PANEL).locator('.pulse-shell').first()).toHaveCSS('background-color', theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(11, 11, 15)')
    for (const [name, target] of stops) {
      if (target) await scrollPanelTo(target)
      else await page.locator(PANEL).locator('.pulse-shell').first().evaluate(node => { node.scrollTop = 0 })
      await shootPanel(page, outputPath(`${name}-${theme}.png`))
      if (theme === 'light') failures.push(...await lowContrastText(page))
    }
  }
  return [...new Map(failures.map(f => [`${f.text}|${f.color}|${f.ground}`, f])).values()]
}

test('the CHAT/PULSE row follows Twitch light and dark themes', async ({ extension, prepare }, info) => {
  await prepare()
  const page = extension.page
  await page.setViewportSize({ width: 1440, height: 900 })
  await openTwitchChannel(page)
  const host = page.locator('#streamclone-pulse-tabs')
  await expect(host).toHaveAttribute('data-twitch-theme', 'dark')

  // Twitch flips one class on <html> and repaints its header white.
  await page.evaluate(() => {
    document.documentElement.classList.replace('tw-root--theme-dark', 'tw-root--theme-light')
    if (!document.documentElement.classList.contains('tw-root--theme-light')) document.documentElement.classList.add('tw-root--theme-light')
    const style = document.createElement('style')
    // Paint every light-DOM box white, the host included; shadow internals are untouched.
    style.textContent = 'html, body, body * { background-color: #ffffff !important; }'
    document.head.append(style)
  })
  await expect(host).toHaveAttribute('data-twitch-theme', 'light')
  await expect(page.locator('#streamclone-pulse-root')).toHaveAttribute('data-twitch-theme', 'light')

  // The row is opaque in the sidebar placement, so it must repaint itself.
  await expect(host.locator('section.pulse-sidebar-header-tabs')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  const inactive = host.locator('.pulse-sidebar-header-tabs .pulse-sidebar-tab:not(.active)').first()
  await expect(inactive).toBeVisible()
  // Dark-only labels were pale (#a1a1b2); light mode switches to dark ink once the colour transition ends.
  await expect.poll(() => inactive.evaluate(element => Math.max(...getComputedStyle(element).color.match(/\d+/g)!.slice(0, 3).map(Number))))
    .toBeLessThan(120)
  await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished)))
  const box = await host.boundingBox()
  await page.screenshot({ path: info.outputPath('twitch-tabs-light.png'), clip: { x: box!.x - 8, y: box!.y - 8, width: box!.width + 16, height: box!.height + 16 } })

  await page.evaluate(() => document.documentElement.classList.replace('tw-root--theme-light', 'tw-root--theme-dark'))
  await expect(host).toHaveAttribute('data-twitch-theme', 'dark')
  await expect(host.locator('section.pulse-sidebar-header-tabs')).toHaveCSS('background-color', 'rgb(11, 11, 15)')
})

test('the Pulse panel follows Twitch light on a VOD recap', async ({ extension, prepare }, info) => {
  await prepare({ scenario: 'vod-ready', twitchKind: 'vod' })
  const page = extension.page
  await page.setViewportSize({ width: 1440, height: 1100 })
  await openTwitchVod(page)
  const root = page.locator(PANEL)
  await expect(root.getByText(/^Top moments$/i).first()).toBeAttached({ timeout: 30_000 })
  await captureStops(page, [
    ['vod-top', null],
    ['vod-chart', root.locator('.pulse-ch-legend').first()],
    ['vod-moments', root.getByText(/^Top moments$/i).first()],
  ], name => info.outputPath(name)).then(failures => expect(failures).toEqual([]))
})

test('the Pulse panel follows Twitch light while live', async ({ extension, prepare }, info) => {
  await prepare({ scenario: 'live-ready' })
  const page = extension.page
  await page.setViewportSize({ width: 1440, height: 1100 })
  await openTwitchChannel(page)
  const root = page.locator(PANEL)
  await expect(root.getByText(/^Top moments$/i).first()).toBeAttached({ timeout: 30_000 })
  await captureStops(page, [
    ['live-top', null],
    ['live-chart', root.locator('.pulse-ch-legend').first()],
    ['live-moments', root.getByText(/^Top moments$/i).first()],
  ], name => info.outputPath(name)).then(failures => expect(failures).toEqual([]))
  await root.getByRole('button', { name: 'Open settings', exact: true }).click()
  await expect(root.locator('[data-overlay-settings-panel="true"]')).toBeVisible()
  await captureStops(page, [
    ['live-settings-top', root.locator('[data-overlay-settings-panel="true"] .pulse-settings-supporter-cta').first()],
    ['live-settings', null],
  ], name => info.outputPath(name)).then(failures => expect(failures).toEqual([]))
})

test('the docked Pulse panel follows Twitch light', async ({ extension, prepare }, info) => {
  await prepare({ scenario: 'live-ready', storage: { overlayPlacement: 'right', overlayMode: 'expanded' } })
  const page = extension.page
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openTwitchChannel(page)
  await expect(page.locator(PANEL).getByText(/^Top moments$/i).first()).toBeAttached({ timeout: 30_000 })
  expect(await captureStops(page, [['dock-right', null]], name => info.outputPath(name))).toEqual([])
})
