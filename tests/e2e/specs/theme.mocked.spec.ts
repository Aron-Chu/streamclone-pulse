import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '../helpers/testFixtures.ts'
import {
  assertExactlyOnePulseRoot,
  assertNoUncaughtErrors,
  PULSE_ROOT_ID,
  PULSE_TABS_ID,
  waitForPulseRoot,
} from '../helpers/assertions.ts'
import {
  closeExtensionContext,
  launchExtensionContext,
  readExtensionStorage,
  relaunchExtensionContext,
  seedExtensionStorage,
} from '../helpers/extensionContext.ts'
import { installMockApi } from '../helpers/mockApi.ts'
import { installTwitchFixtures, openTwitchChannel, openTwitchVod, setTwitchRootTheme } from '../helpers/mockTwitch.ts'
import { installEvidenceCollectors } from '../helpers/evidence.ts'

const SCREENSHOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/theme-screenshots',
)

async function hostScheme(page: import('@playwright/test').Page, hostId: string): Promise<string | null> {
  return page.evaluate(id => document.getElementById(id)?.getAttribute('data-pulse-color-scheme') ?? null, hostId)
}

async function hostSurfaceCanvas(page: import('@playwright/test').Page, hostId: string): Promise<string> {
  return page.evaluate(id => {
    const host = document.getElementById(id)
    return host?.style.getPropertyValue('--pulse-surface-bg-canvas').trim() ?? ''
  }, hostId)
}

async function openSettings(page: import('@playwright/test').Page): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(rootId => {
        const root = document.getElementById(rootId)?.shadowRoot
        return Boolean(root?.querySelector('button[aria-label="Open settings"], button[aria-label="Back to Pulse"]'))
      }, PULSE_ROOT_ID),
    )
    .toBe(true)
  const clicked = await page.evaluate(rootId => {
    const root = document.getElementById(rootId)?.shadowRoot
    const settings = root?.querySelector(
      'button[aria-label="Open settings"], button[aria-label="Back to Pulse"]',
    ) as HTMLButtonElement | null
    settings?.click()
    return Boolean(settings)
  }, PULSE_ROOT_ID)
  expect(clicked, 'settings control').toBe(true)
  await expect
    .poll(async () =>
      page.evaluate(rootId => {
        const host = document.getElementById(rootId)
        return Boolean(host?.shadowRoot?.querySelector('[aria-label="Color scheme"]'))
      }, PULSE_ROOT_ID),
    )
    .toBe(true)
}

async function pressColorScheme(
  page: import('@playwright/test').Page,
  label: 'Auto' | 'Light' | 'Dark',
): Promise<void> {
  const pressed = await page.evaluate(
    ({ rootId, labelText }) => {
      const host = document.getElementById(rootId)
      const root = host?.shadowRoot
      const group = root?.querySelector('[aria-label="Color scheme"]')
      const button = [...(group?.querySelectorAll('button') ?? [])].find(
        el => el.textContent?.trim() === labelText,
      )
      if (!button) return false
      ;(button as HTMLButtonElement).click()
      return true
    },
    { rootId: PULSE_ROOT_ID, labelText: label },
  )
  expect(pressed, `color scheme button ${label}`).toBe(true)
}

async function routeSurfaceProbe(page: import('@playwright/test').Page) {
  return page.evaluate(rootId => {
    const host = document.getElementById(rootId)
    const root = host?.shadowRoot
    if (!host || !root) return null
    const candidates = [
      root.querySelector('.pulse-panel-body'),
      root.querySelector('.pulse-seven-tv-panel'),
      root.querySelector('.pulse-sparkline-wrap'),
      ...root.querySelectorAll('section'),
    ].filter((value): value is Element => Boolean(value))
    const backgrounds = [...new Set(candidates.map(el => getComputedStyle(el).backgroundColor))]
    const isDarkOpaque = (color: string) => {
      const match = /rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)(?:\D+([\d.]+))?/.exec(color)
      if (!match || Number(match[4] ?? 1) === 0) return false
      return Math.max(Number(match[1]), Number(match[2]), Number(match[3])) < 72
    }
    return {
      scheme: host.getAttribute('data-pulse-color-scheme'),
      canvas: host.style.getPropertyValue('--pulse-surface-bg-canvas').trim(),
      panel: host.style.getPropertyValue('--pulse-surface-panel').trim(),
      chart: host.style.getPropertyValue('--pulse-surface-chart-bg').trim(),
      text: root.textContent ?? '',
      backgrounds,
      darkIslandCount: backgrounds.filter(isDarkOpaque).length,
    }
  }, PULSE_ROOT_ID)
}

test.describe('extension theme', () => {
  test('Auto follows Twitch dark by default', async ({ extension, prepare, evidence }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await expect.poll(() => hostScheme(extension.page, PULSE_ROOT_ID)).toBe('dark')
    await expect.poll(() => hostScheme(extension.page, PULSE_TABS_ID)).toBe('dark')
    expect(await hostSurfaceCanvas(extension.page, PULSE_ROOT_ID)).toBe('#050507')
    assertNoUncaughtErrors(evidence)
  })

  test('Auto switches with Twitch root class without remount', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await extension.page.evaluate(id => {
      document.getElementById(id)?.setAttribute('data-pulse-theme-probe', '1')
    }, PULSE_ROOT_ID)

    await setTwitchRootTheme(extension.page, 'light')
    await expect.poll(() => hostScheme(extension.page, PULSE_ROOT_ID)).toBe('light')
    expect(await hostSurfaceCanvas(extension.page, PULSE_ROOT_ID)).toBe('#eceef1')

    const stillSameHost = await extension.page.evaluate(
      id => document.getElementById(id)?.getAttribute('data-pulse-theme-probe') === '1',
      PULSE_ROOT_ID,
    )
    expect(stillSameHost).toBe(true)
    await assertExactlyOnePulseRoot(extension.page)
    assertNoUncaughtErrors(evidence)
  })

  test('Light and Dark overrides ignore Twitch class changes', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: { colorSchemePreference: 'light' },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await expect.poll(() => hostScheme(extension.page, PULSE_ROOT_ID)).toBe('light')

    await setTwitchRootTheme(extension.page, 'dark')
    await extension.page.waitForTimeout(300)
    expect(await hostScheme(extension.page, PULSE_ROOT_ID)).toBe('light')

    await openSettings(extension.page)
    await pressColorScheme(extension.page, 'Dark')
    await expect.poll(() => hostScheme(extension.page, PULSE_ROOT_ID)).toBe('dark')
    await setTwitchRootTheme(extension.page, 'light')
    await extension.page.waitForTimeout(300)
    expect(await hostScheme(extension.page, PULSE_ROOT_ID)).toBe('dark')
    assertNoUncaughtErrors(evidence)
  })

  test('color scheme persists across service-worker relaunch and stays independent of accent', async () => {
    let launched = await launchExtensionContext()
    const api = await installMockApi(launched.context, 'live-ready')
    await installTwitchFixtures(launched.context, { kind: 'live', login: 'fixturechan' })
    await seedExtensionStorage(launched.serviceWorker, {
      themePreference: 'volt',
      colorSchemePreference: 'light',
    })

    await openTwitchChannel(launched.page)
    await waitForPulseRoot(launched.page)
    await expect.poll(() => hostScheme(launched.page, PULSE_ROOT_ID)).toBe('light')

    await api.dispose()
    launched = await relaunchExtensionContext(launched)
    const api2 = await installMockApi(launched.context, 'live-ready')
    await installTwitchFixtures(launched.context, { kind: 'live', login: 'fixturechan' })
    const evidence = installEvidenceCollectors(
      launched.context,
      launched.page,
      launched.serviceWorker,
    )

    try {
      const stored = await readExtensionStorage(launched.serviceWorker, [
        'themePreference',
        'colorSchemePreference',
      ])
      expect(stored.themePreference).toBe('volt')
      expect(stored.colorSchemePreference).toBe('light')

      await openTwitchChannel(launched.page)
      await waitForPulseRoot(launched.page)
      await expect.poll(() => hostScheme(launched.page, PULSE_ROOT_ID)).toBe('light')
      assertNoUncaughtErrors(evidence)
    } finally {
      await api2.dispose()
      await closeExtensionContext(launched)
    }
  })

  test('sidebar width matrix keeps hosts within bounds and captures theme shots', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: { colorSchemePreference: 'dark' },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

    for (const width of [240, 280, 320, 392, 425]) {
      const geometry = await extension.page.evaluate(
        ({ w, rootId, tabsId }) => {
          const col = document.querySelector('.channel-root__right-column') as HTMLElement | null
          const layout = document.querySelector(
            '[data-test-selector="chat-room-component-layout"]',
          ) as HTMLElement | null
          if (col) {
            col.style.width = `${w}px`
            col.style.minWidth = '0'
            col.style.maxWidth = `${w}px`
          }
          if (layout) {
            layout.style.minWidth = '0'
            layout.style.width = '100%'
          }
          const player = document.getElementById('player')
          const ad = document.createElement('div')
          ad.setAttribute('data-a-target', 'video-ad-banner')
          ad.style.cssText =
            'position:absolute;left:8px;top:8px;width:120px;height:40px;background:#333;z-index:5'
          player?.appendChild(ad)

          const root = document.getElementById(rootId)
          const tabs = document.getElementById(tabsId)
          const colRect = col?.getBoundingClientRect()
          const rootRect = root?.getBoundingClientRect()
          const tabsRect = tabs?.getBoundingClientRect()
          const playerRect = player?.getBoundingClientRect()
          const adRect = ad.getBoundingClientRect()
          const overlaps = (a: DOMRect, b: DOMRect) =>
            a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

          return {
            chatWidth: Math.round(colRect?.width ?? 0),
            rootWidth: Math.round(rootRect?.width ?? 0),
            tabsWidth: Math.round(tabsRect?.width ?? 0),
            overflow: root ? root.scrollWidth > root.clientWidth + 1 : true,
            aligned:
              !!colRect
              && !!rootRect
              && !!tabsRect
              && Math.abs(rootRect.left - colRect.left) < 3
              && Math.abs(tabsRect.left - colRect.left) < 3
              && Math.abs(rootRect.width - colRect.width) < 4,
            overlapsPlayer: !!(rootRect && playerRect && overlaps(rootRect, playerRect)
              && rootRect.left < (playerRect.right - 40)),
            overlapsAd: !!(rootRect && overlaps(rootRect, adRect)),
            menuInBody: document.body.querySelector('ul[role="listbox"]') != null,
            menuInShadow: !!root?.shadowRoot?.querySelector('ul[role="listbox"]'),
          }
        },
        { w: width, rootId: PULSE_ROOT_ID, tabsId: PULSE_TABS_ID },
      )

      await expect
        .poll(async () => extension.page.evaluate(
          ({ rootId, w }) => {
            const col = document.querySelector('.channel-root__right-column') as HTMLElement | null
            const root = document.getElementById(rootId)
            const chatWidth = Math.round(col?.getBoundingClientRect().width ?? 0)
            const rootWidth = Math.round(root?.getBoundingClientRect().width ?? 0)
            return Math.abs(chatWidth - w) <= 2 && Math.abs(rootWidth - w) <= 4
          },
          { rootId: PULSE_ROOT_ID, w: width },
        ), { message: `Pulse host settles at ${width}px`, timeout: 2_000 })
        .toBe(true)
      const after = await extension.page.evaluate(
        ({ rootId, tabsId, w }) => {
          const col = document.querySelector('.channel-root__right-column') as HTMLElement | null
          const root = document.getElementById(rootId)
          const tabs = document.getElementById(tabsId)
          const colRect = col?.getBoundingClientRect()
          const rootRect = root?.getBoundingClientRect()
          const tabsRect = tabs?.getBoundingClientRect()
          return {
            chatWidth: Math.round(colRect?.width ?? 0),
            rootWidth: Math.round(rootRect?.width ?? 0),
            tabsWidth: Math.round(tabsRect?.width ?? 0),
            overflow: root ? root.scrollWidth > root.clientWidth + 1 : true,
            aligned:
              !!colRect
              && !!rootRect
              && !!tabsRect
              && Math.abs(rootRect.left - colRect.left) < 3
              && Math.abs(tabsRect.left - colRect.left) < 3,
            target: w,
          }
        },
        { rootId: PULSE_ROOT_ID, tabsId: PULSE_TABS_ID, w: width },
      )

      expect(Math.abs(after.chatWidth - width), `chat width near ${width}`).toBeLessThanOrEqual(2)
      expect(Math.abs(after.rootWidth - width), `pulse width near ${width}`).toBeLessThanOrEqual(4)
      expect(after.overflow, `no horizontal overflow at ${width}px`).toBe(false)
      expect(after.aligned, `tabs/body aligned at ${width}px`).toBe(true)
      expect(geometry.overlapsAd, `no ad overlap at ${width}px`).toBe(false)
      expect(geometry.menuInBody, `select menu not in body at ${width}px`).toBe(false)

      if (width === 280 || width === 320 || width === 425) {
        await extension.page
          .locator(`#${PULSE_ROOT_ID}`)
          .screenshot({ path: path.join(SCREENSHOT_DIR, `sidebar-dark-${width}.png`) })
      }
    }

    await extension.page
      .locator(`#${PULSE_ROOT_ID}`)
      .screenshot({ path: path.join(SCREENSHOT_DIR, 'sidebar-dark-expanded.png') })

    await setTwitchRootTheme(extension.page, 'light')
    await openSettings(extension.page)
    await pressColorScheme(extension.page, 'Light')
    await expect.poll(() => hostScheme(extension.page, PULSE_ROOT_ID)).toBe('light')

    // Return to live panel so light screenshots show surfaces/charts, not only settings.
    await extension.page.evaluate(rootId => {
      const host = document.getElementById(rootId)
      const root = host?.shadowRoot
      const back = [...(root?.querySelectorAll('button') ?? [])].find(btn =>
        /back/i.test(`${btn.getAttribute('aria-label') ?? ''} ${btn.textContent ?? ''}`),
      )
      ;(back as HTMLButtonElement | undefined)?.click()
    }, PULSE_ROOT_ID)
    await expect
      .poll(async () =>
        extension.page.evaluate(rootId => {
          const host = document.getElementById(rootId)
          return !host?.shadowRoot?.querySelector('[aria-label="Color scheme"]')
        }, PULSE_ROOT_ID),
      )
      .toBe(true)

    const contrast = await extension.page.evaluate(rootId => {
      const host = document.getElementById(rootId)
      const root = host?.shadowRoot
      if (!host || !root) return null
      const parse = (color: string): [number, number, number] | null => {
        const hex = /^#([0-9a-f]{6})$/i.exec(color.trim())
        if (hex) {
          const n = Number.parseInt(hex[1]!, 16)
          return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        }
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(color)
        if (!m) return null
        return [Number(m[1]), Number(m[2]), Number(m[3])]
      }
      const lum = (rgb: [number, number, number]) => {
        const channels = rgb.map(channel => {
          const c = channel / 255
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
      }
      const ratio = (fg: string, bg: string) => {
        const a = parse(fg)
        const b = parse(bg)
        if (!a || !b) return 0
        const l1 = lum(a)
        const l2 = lum(b)
        const lighter = Math.max(l1, l2)
        const darker = Math.min(l1, l2)
        return (lighter + 0.05) / (darker + 0.05)
      }
      const body = root.querySelector('.pulse-panel-body') as HTMLElement | null
      const card = root.querySelector('section') as HTMLElement | null
      const tabsHost = document.getElementById('streamclone-pulse-tabs')
      const tabWrap = tabsHost?.shadowRoot?.querySelector('.pulse-sidebar-tabs') as HTMLElement | null
      const tab = tabWrap?.querySelector('.pulse-sidebar-tab') as HTMLElement | null
      const sample = card ?? body
      if (!sample) return null
      const cs = getComputedStyle(sample)
      const title = [...sample.querySelectorAll('h3, h2, p, span, label')].find(el => {
        const text = (el.textContent ?? '').trim()
        const color = getComputedStyle(el).color
        return text.length > 2 && !/rgb\(\s*1\d{2},\s*1\d{2},\s*2\d{2}\s*\)/i.test(color)
      }) as HTMLElement | undefined
      const titleCs = title ? getComputedStyle(title) : cs
      const tabBg = tabWrap ? getComputedStyle(tabWrap).backgroundColor : 'rgb(255,255,255)'
      const tabFg = tab ? getComputedStyle(tab).color : 'rgb(0,0,0)'
      const secondary = host.style.getPropertyValue('--pulse-surface-text-secondary').trim() || '#3f3f46'
      const elevated = host.style.getPropertyValue('--pulse-surface-panel-elevated').trim() || '#f3f3f6'
      const accentText = host.style.getPropertyValue('--pulse-accent-text').trim()
      const chartBg = host.style.getPropertyValue('--pulse-chart-bg').trim()
      const textPrimary = host.style.getPropertyValue('--pulse-surface-text-primary').trim() || '#18181b'
      const canvas = host.style.getPropertyValue('--pulse-surface-bg-canvas').trim() || '#eceef1'
      const panel = host.style.getPropertyValue('--pulse-surface-panel').trim() || '#fdfdfd'
      const gameChip = host.style.getPropertyValue('--pulse-surface-game-chip-text').trim()
      const link = [...(root.querySelectorAll('a, button') ?? [])].find(el =>
        /analytics|portal|open full/i.test(el.textContent ?? ''),
      ) as HTMLElement | undefined
      const linkColor = link ? getComputedStyle(link).color : accentText
      const label = [...(root.querySelectorAll('label, p, span') ?? [])].find(
        el => /viewers|chat|emotes|live now|games/i.test(el.textContent ?? ''),
      ) as HTMLElement | undefined
      const labelCs = label ? getComputedStyle(label) : null
      const metric = root.querySelector('[data-testid="live-stats"], .pulse-metric-label, .pulse-stat-label') as HTMLElement | null
      const chartShell = root.querySelector('svg')?.closest('div') as HTMLElement | null
      const chartBgComputed = chartShell ? getComputedStyle(chartShell).backgroundColor : ''
      const plotPanel = root.querySelector('.pulse-seven-tv-panel') as HTMLElement | null
      const plotBg = plotPanel ? getComputedStyle(plotPanel).backgroundColor : ''
      const plotIsDarkIsland = /rgb\(\s*(1[0-3]|0?\d),\s*(1[0-3]|0?\d),\s*(1[0-8]|0?\d)\s*\)/i.test(plotBg)
      const activeTab = tabsHost?.shadowRoot?.querySelector('.pulse-sidebar-tab.active') as HTMLElement | null
      const activeTabCs = activeTab ? getComputedStyle(activeTab) : null
      return {
        scheme: host.getAttribute('data-pulse-color-scheme'),
        canvas,
        elevated,
        chartBg,
        accentText,
        textPrimary,
        bodyFgBg: title ? ratio(titleCs.color, cs.backgroundColor || panel) : ratio(textPrimary, panel),
        tokenPrimaryPanel: ratio(textPrimary, panel),
        tabWrapBg: tabBg,
        tabFgBg: tab ? ratio(tabFg, tabBg) : 99,
        tabTokenContrast: ratio(secondary, elevated),
        tokenPrimaryCanvas: ratio(textPrimary, canvas),
        accentOnCanvas: accentText ? ratio(accentText, canvas) : 0,
        linkReadable: linkColor ? ratio(linkColor, panel) : 99,
        labelReadable: labelCs ? ratio(labelCs.color, panel) : 99,
        hasMetric: Boolean(metric),
        chartNotForcedDark: chartBg === '#f0f1f4' || chartBg === '#fdfdfd',
        chartShellLight: !/rgb\(\s*(1[0-3]|0?\d),\s*(1[0-3]|0?\d),\s*(1[0-8]|0?\d)\s*\)/i.test(chartBgComputed),
        gameChipText: gameChip,
        menuInBody: document.body.querySelector('ul[role="listbox"]') != null,
        menuInShadow: !!root.querySelector('ul[role="listbox"]'),
        plotPanelPresent: Boolean(plotPanel),
        plotPanelDarkIsland: plotPanel ? plotIsDarkIsland : false,
        activeTabReadable: activeTabCs
          ? ratio(activeTabCs.color, activeTabCs.backgroundColor)
          : 99,
      }
    }, PULSE_ROOT_ID)

    expect(contrast?.scheme).toBe('light')
    expect(contrast?.canvas).toBe('#eceef1')
    expect(contrast?.elevated).toBe('#f3f3f6')
    expect(contrast?.chartBg).toBe('#f0f1f4')
    expect(contrast?.textPrimary).toBe('#18181b')
    expect(contrast?.accentText?.toLowerCase()).toBe('#5b21b6')
    expect(contrast?.gameChipText?.toLowerCase()).toBe('#9a3412')
    expect(contrast?.tokenPrimaryPanel ?? 0).toBeGreaterThanOrEqual(4.5)
    expect(contrast?.tokenPrimaryCanvas ?? 0).toBeGreaterThanOrEqual(4.5)
    expect(contrast?.accentOnCanvas ?? 0).toBeGreaterThanOrEqual(4.5)
    expect(contrast?.chartNotForcedDark).toBe(true)
    // Tabs use the calmer light control surface.
    expect(contrast?.tabWrapBg ?? '').toMatch(/rgb\(\s*232,\s*233,\s*237\s*\)|#e8e9ed/i)
    expect(contrast?.tabTokenContrast ?? 0).toBeGreaterThanOrEqual(4.5)
    expect(contrast?.menuInBody).toBe(false)
    expect(contrast?.plotPanelDarkIsland).toBe(false)
    if ((contrast?.activeTabReadable ?? 99) < 90) {
      expect(contrast?.activeTabReadable ?? 0).toBeGreaterThanOrEqual(3)
    }
    if ((contrast?.linkReadable ?? 99) < 90) {
      expect(contrast?.linkReadable ?? 0).toBeGreaterThanOrEqual(4.5)
    }
    if ((contrast?.labelReadable ?? 99) < 90) {
      expect(contrast?.labelReadable ?? 0).toBeGreaterThanOrEqual(4.5)
    }

    await extension.page
      .locator(`#${PULSE_ROOT_ID}`)
      .screenshot({ path: path.join(SCREENSHOT_DIR, 'sidebar-light-expanded.png') })
    await extension.page
      .locator(`#${PULSE_ROOT_ID}`)
      .screenshot({ path: path.join(SCREENSHOT_DIR, 'sidebar-light-280.png') })
    await extension.page.evaluate(w => {
      const col = document.querySelector('.channel-root__right-column') as HTMLElement | null
      if (col) {
        col.style.width = `${w}px`
        col.style.minWidth = '0'
        col.style.maxWidth = `${w}px`
      }
    }, 425)
    await extension.page.waitForTimeout(200)
    await extension.page
      .locator(`#${PULSE_ROOT_ID}`)
      .screenshot({ path: path.join(SCREENSHOT_DIR, 'sidebar-light-425.png') })

    assertNoUncaughtErrors(evidence)
  })

  test('VOD recap follows light and dark palettes without route-specific islands', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({
      scenario: 'vod-ready',
      twitchKind: 'vod',
      storage: { colorSchemePreference: 'light' },
    })
    await openTwitchVod(extension.page)
    await waitForPulseRoot(extension.page)
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

    const light = await routeSurfaceProbe(extension.page)
    expect(light?.scheme).toBe('light')
    expect(light?.text).toMatch(/stream recap|stream activity|messages/i)
    expect(light?.canvas).toBe('#eceef1')
    expect(light?.chart).toBe('#f0f1f4')
    expect(light?.darkIslandCount).toBe(0)
    await extension.page
      .locator(`#${PULSE_ROOT_ID}`)
      .screenshot({ path: path.join(SCREENSHOT_DIR, 'vod-light.png') })

    await extension.serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({ colorSchemePreference: 'dark' })
    })
    await expect.poll(() => hostScheme(extension.page, PULSE_ROOT_ID)).toBe('dark')
    const dark = await routeSurfaceProbe(extension.page)
    expect(dark?.canvas).toBe('#050507')
    expect(dark?.panel).toBe('#111117')
    await extension.page
      .locator(`#${PULSE_ROOT_ID}`)
      .screenshot({ path: path.join(SCREENSHOT_DIR, 'vod-dark.png') })
    assertNoUncaughtErrors(evidence)
  })

  test('offline chat recap follows both palettes and stays readable in light mode', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({
      scenario: 'offline',
      twitchKind: 'offline',
      storage: { colorSchemePreference: 'light' },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

    const light = await routeSurfaceProbe(extension.page)
    expect(light?.scheme).toBe('light')
    expect(light?.text).toMatch(/offline|previous stream|recap|past/i)
    expect(light?.darkIslandCount).toBe(0)
    await extension.page
      .locator(`#${PULSE_ROOT_ID}`)
      .screenshot({ path: path.join(SCREENSHOT_DIR, 'offline-light.png') })

    await extension.serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({ colorSchemePreference: 'dark' })
    })
    await expect.poll(() => hostScheme(extension.page, PULSE_ROOT_ID)).toBe('dark')
    const dark = await routeSurfaceProbe(extension.page)
    expect(dark?.canvas).toBe('#050507')
    expect(dark?.panel).toBe('#111117')
    await extension.page
      .locator(`#${PULSE_ROOT_ID}`)
      .screenshot({ path: path.join(SCREENSHOT_DIR, 'offline-dark.png') })
    assertNoUncaughtErrors(evidence)
  })

  test('light mode emote plots use light surfaces and deeper scheme-aware traces', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        colorSchemePreference: 'light',
        overlayMode: 'expanded',
        overlayPlacement: 'right',
      },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await expect.poll(() => hostScheme(extension.page, PULSE_ROOT_ID)).toBe('light')

    const toggle = extension.page.getByRole('button', { name: /Plot on chart/i })
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')

    const row = extension.page.locator('.pulse-seven-tv-row').first()
    await expect(row).toBeVisible()
    await row.click()
    await expect(row).toHaveAttribute('aria-pressed', 'true')

    const probe = await extension.page.evaluate(rootId => {
      const root = document.getElementById(rootId)?.shadowRoot
      const panel = root?.querySelector('.pulse-seven-tv-panel') as HTMLElement | null
      const active = root?.querySelector('.pulse-seven-tv-row[aria-pressed="true"]') as HTMLElement | null
      const count = active?.querySelector('span:last-child') as HTMLElement | null
      const chart = root?.querySelector('.pulse-sparkline-wrap') as HTMLElement | null
      return {
        panelBg: panel ? getComputedStyle(panel).backgroundColor : '',
        rowBg: active ? getComputedStyle(active).backgroundColor : '',
        plotColor: count ? getComputedStyle(count).color : '',
        chartBg: chart ? getComputedStyle(chart).backgroundColor : '',
      }
    }, PULSE_ROOT_ID)
    expect(probe.panelBg).toMatch(/rgb\(\s*253,\s*253,\s*253\s*\)/)
    expect(probe.chartBg).toMatch(/rgb\(\s*240,\s*241,\s*244\s*\)/)
    expect(probe.plotColor).toMatch(/rgb\(\s*190,\s*18,\s*60\s*\)/)
    expect(probe.rowBg).not.toMatch(/rgb\(\s*(?:[0-6]?\d),\s*(?:[0-6]?\d),\s*(?:[0-6]?\d)\s*\)/)
    await extension.page
      .locator('.pulse-seven-tv-panel')
      .screenshot({ path: path.join(SCREENSHOT_DIR, 'emote-plots-light.png') })
    assertNoUncaughtErrors(evidence)
  })

  test('color scheme storage removal and invalid values snap to auto', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: { colorSchemePreference: 'light' },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await expect.poll(() => hostScheme(extension.page, PULSE_ROOT_ID)).toBe('light')

    await extension.serviceWorker.evaluate(async () => {
      await chrome.storage.sync.remove('colorSchemePreference')
    })
    await expect.poll(() => hostScheme(extension.page, PULSE_ROOT_ID)).toBe('dark')

    await extension.serviceWorker.evaluate(async () => {
      await chrome.storage.sync.set({ colorSchemePreference: 'sepia' })
    })
    await expect.poll(() => hostScheme(extension.page, PULSE_ROOT_ID)).toBe('dark')

    assertNoUncaughtErrors(evidence)
  })

  test('settings color-scheme control exposes aria-pressed and keyboard focus', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)
    await openSettings(extension.page)

    const pressed = await extension.page.evaluate(rootId => {
      const host = document.getElementById(rootId)
      const root = host?.shadowRoot
      const group = root?.querySelector('[aria-label="Color scheme"]')
      const auto = [...(group?.querySelectorAll('button') ?? [])].find(
        el => el.textContent?.trim() === 'Auto',
      ) as HTMLButtonElement | undefined
      return auto?.getAttribute('aria-pressed') ?? null
    }, PULSE_ROOT_ID)
    expect(pressed).toBe('true')

    await pressColorScheme(extension.page, 'Light')
    await expect
      .poll(async () =>
        extension.page.evaluate(rootId => {
          const host = document.getElementById(rootId)
          const root = host?.shadowRoot
          const group = root?.querySelector('[aria-label="Color scheme"]')
          const light = [...(group?.querySelectorAll('button') ?? [])].find(
            el => el.textContent?.trim() === 'Light',
          )
          return light?.getAttribute('aria-pressed') ?? null
        }, PULSE_ROOT_ID),
      )
      .toBe('true')

    const lightSettings = await extension.page.evaluate(rootId => {
      const host = document.getElementById(rootId)
      const root = host?.shadowRoot
      if (!host || !root) return null
      const parse = (color: string): [number, number, number] | null => {
        const hex = /^#([0-9a-f]{6})$/i.exec(color.trim())
        if (hex) {
          const n = Number.parseInt(hex[1]!, 16)
          return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
        }
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(color)
        if (!m) return null
        return [Number(m[1]), Number(m[2]), Number(m[3])]
      }
      const lum = (rgb: [number, number, number]) => {
        const channels = rgb.map(channel => {
          const c = channel / 255
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
      }
      const ratio = (fg: string, bg: string) => {
        const a = parse(fg)
        const b = parse(bg)
        if (!a || !b) return 0
        const l1 = lum(a)
        const l2 = lum(b)
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
      }
      const canvas = host.style.getPropertyValue('--pulse-surface-bg-canvas').trim() || '#eceef1'
      const lightBtn = [...(root.querySelectorAll('[aria-label="Color scheme"] button') ?? [])].find(
        el => el.textContent?.trim() === 'Light',
      ) as HTMLElement | undefined
      const lightCs = lightBtn ? getComputedStyle(lightBtn) : null
      const pills = [...(root.querySelectorAll('*') ?? [])]
        .filter(el => /^(Hosted|Local|Custom)$/i.test((el.textContent ?? '').trim()))
        .slice(0, 3)
        .map(el => {
          const cs = getComputedStyle(el as HTMLElement)
          return { text: el.textContent?.trim(), color: cs.color, bg: cs.backgroundColor, ratio: ratio(cs.color, canvas) }
        })
      const labels = [...(root.querySelectorAll('label, p, span') ?? [])]
        .filter(el => /color scheme|backend|theme|accent/i.test(el.textContent ?? ''))
        .slice(0, 4)
        .map(el => {
          const cs = getComputedStyle(el as HTMLElement)
          return ratio(cs.color, canvas)
        })
      return {
        activeBtnRatio: lightCs ? ratio(lightCs.color, lightCs.backgroundColor) : 0,
        accentText: host.style.getPropertyValue('--pulse-accent-text').trim(),
        pills,
        minLabelRatio: labels.length ? Math.min(...labels) : 99,
      }
    }, PULSE_ROOT_ID)

    expect(lightSettings?.activeBtnRatio ?? 0).toBeGreaterThanOrEqual(3)
    expect(lightSettings?.accentText?.toLowerCase()).toBe('#5b21b6')
    expect(lightSettings?.minLabelRatio ?? 0).toBeGreaterThanOrEqual(4.5)
    for (const pill of lightSettings?.pills ?? []) {
      expect(pill.ratio, `pill ${pill.text}`).toBeGreaterThanOrEqual(3)
    }

    assertNoUncaughtErrors(evidence)
  })

  test('themed select menus stay inside Pulse shadow and support keyboard selection', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const trigger = extension.page
      .locator(`#${PULSE_ROOT_ID}`)
      .locator('button[aria-haspopup="listbox"]')
      .first()
    await expect(trigger).toBeVisible()
    await trigger.click()

    await expect
      .poll(async () =>
        extension.page.evaluate(rootId => {
          const host = document.getElementById(rootId)
          const root = host?.shadowRoot
          return {
            inShadow: !!root?.querySelector('ul[role="listbox"]'),
            inBody: !!document.body.querySelector('ul[role="listbox"]'),
          }
        }, PULSE_ROOT_ID),
      )
      .toMatchObject({ inShadow: true, inBody: false })

    await trigger.press('ArrowDown')
    await trigger.press('Enter')

    await expect
      .poll(async () =>
        extension.page.evaluate(rootId => {
          const host = document.getElementById(rootId)
          return !!host?.shadowRoot?.querySelector('ul[role="listbox"]')
        }, PULSE_ROOT_ID),
      )
      .toBe(false)

    await expect(trigger).toBeFocused()
    assertNoUncaughtErrors(evidence)
  })

  test('accent themes remain distinct across light and dark host schemes', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: { colorSchemePreference: 'light', themePreference: 'aurora' },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const samples: Array<{ pref: string; scheme: string; accentText: string; elevated: string }> = []
    for (const pref of ['aurora', 'volt', 'azure'] as const) {
      for (const scheme of ['light', 'dark'] as const) {
        await extension.serviceWorker.evaluate(
          async ({ themePreference, colorSchemePreference }) => {
            await chrome.storage.sync.set({ themePreference, colorSchemePreference })
          },
          { themePreference: pref, colorSchemePreference: scheme },
        )
        await expect.poll(() => hostScheme(extension.page, PULSE_ROOT_ID)).toBe(scheme)
        const sample = await extension.page.evaluate(
          ({ rootId, prefName, schemeName }) => {
            const host = document.getElementById(rootId)
            return {
              pref: prefName,
              scheme: schemeName,
              accentText: host?.style.getPropertyValue('--pulse-accent-text').trim() ?? '',
              elevated: host?.style.getPropertyValue('--pulse-surface-panel-elevated').trim() ?? '',
            }
          },
          { rootId: PULSE_ROOT_ID, prefName: pref, schemeName: scheme },
        )
        samples.push(sample)
      }
    }

    for (const scheme of ['light', 'dark']) {
      const texts = samples.filter(s => s.scheme === scheme).map(s => s.accentText.toLowerCase())
      expect(new Set(texts).size, `${scheme} accent texts`).toBe(3)
    }
    expect(samples.every(s => s.elevated.toLowerCase() !== '#2a2440')).toBe(true)
    expect(samples.find(s => s.scheme === 'dark')?.elevated.toLowerCase()).toBe('#1a1a22')
    expect(samples.find(s => s.scheme === 'light')?.elevated.toLowerCase()).toBe('#f3f3f6')
    const darkSecondary = await extension.page.evaluate(rootId => {
      return document.getElementById(rootId)?.style.getPropertyValue('--pulse-surface-text-secondary').trim() ?? ''
    }, PULSE_ROOT_ID)
    expect(darkSecondary.toLowerCase()).toBe('#a1a1b2')
    assertNoUncaughtErrors(evidence)
  })
})
