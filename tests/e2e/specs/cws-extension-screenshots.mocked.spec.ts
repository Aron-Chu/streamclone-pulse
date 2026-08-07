/**
 * Chrome Web Store screenshots of the *actual* MV3 extension embedded on
 * twitch.tv (content script + Pulse overlay), not the marketing landing tour.
 *
 * Uses the same extension Playwright harness as the PR-gate mocked suite
 * (`launchExtensionContext` + Twitch HTML fixtures + mock API scenarios).
 *
 * Run: npm run capture:cws
 */
import { test, expect } from '../helpers/testFixtures.ts'
import { waitForPulseRoot, assertPulseShadowContains, PULSE_ROOT_ID } from '../helpers/assertions.ts'
import { openTwitchChannel, openTwitchVod } from '../helpers/mockTwitch.ts'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const W = 1280
const H = 800
const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../../store/cws/screenshots')

async function hideAllScrollbars(page: import('@playwright/test').Page) {
  await page.addStyleTag({
    content: `
      html, body, * { scrollbar-width: none !important; }
      *::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
      html, body { overflow: hidden !important; }
    `,
  })
  // Shadow-DOM Pulse panel scrollports (content script root)
  await page.evaluate(rootId => {
    const host = document.getElementById(rootId)
    const root = host?.shadowRoot
    if (!root) return
    const style = document.createElement('style')
    style.textContent = `
      * { scrollbar-width: none !important; }
      *::-webkit-scrollbar { width: 0 !important; height: 0 !important; display: none !important; }
      .pulse-panel-body, .pulse-sidebar-content, [data-pulse-scroll], .sl-ext__scrollport, .sl-ext__scroll {
        overflow: hidden !important;
        scrollbar-width: none !important;
      }
    `
    root.appendChild(style)
  }, PULSE_ROOT_ID)
}

async function writeExactStoreShot(page: import('@playwright/test').Page, filename: string) {
  mkdirSync(OUT, { recursive: true })
  await page.setViewportSize({ width: W, height: H })
  await hideAllScrollbars(page)
  await page.waitForTimeout(350)

  // Capture at device pixels when available, then high-quality downsample to exact CWS size.
  const hi = await page.screenshot({
    type: 'png',
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
    scale: 'device',
  })

  const browser = page.context().browser()
  let exact: Buffer
  if (browser) {
    const scaleCtx = await browser.newContext({
      viewport: { width: W, height: H },
      deviceScaleFactor: 1,
    })
    const scaler = await scaleCtx.newPage()
    const dataUrl = `data:image/png;base64,${hi.toString('base64')}`
    await scaler.setContent(
      `<!doctype html><html><head><style>
        html,body{margin:0;overflow:hidden;width:${W}px;height:${H}px;background:#0e0e10}
        canvas{display:block}
      </style></head><body><canvas id="c" width="${W}" height="${H}"></canvas>
      <script>
        const img = new Image();
        img.onload = () => {
          const c = document.getElementById('c');
          const ctx = c.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, ${W}, ${H});
          document.title = 'ready';
        };
        img.src = ${JSON.stringify(dataUrl)};
      </script></body></html>`,
      { waitUntil: 'load' },
    )
    await scaler.waitForFunction(() => document.title === 'ready')
    exact = await scaler.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: W, height: H },
      animations: 'disabled',
    })
    await scaleCtx.close()
  } else {
    exact = await page.screenshot({
      type: 'png',
      fullPage: false,
      animations: 'disabled',
      caret: 'hide',
      clip: { x: 0, y: 0, width: W, height: H },
      scale: 'css',
    })
  }

  const w = exact.readUInt32BE(16)
  const h = exact.readUInt32BE(20)
  expect(w, `${filename} width`).toBe(W)
  expect(h, `${filename} height`).toBe(H)
  writeFileSync(join(OUT, filename), exact)
}

async function scrollPulsePanel(page: import('@playwright/test').Page, progress: number) {
  await page.evaluate(
    ({ rootId, p }) => {
      const host = document.getElementById(rootId)
      const body = host?.shadowRoot?.querySelector(
        '[data-testid="pulse-panel-scroll"], .pulse-panel-scroll',
      ) as HTMLElement | null
      if (!body) return
      const max = Math.max(0, body.scrollHeight - body.clientHeight)
      body.scrollTop = Math.round(max * p)
    },
    { rootId: PULSE_ROOT_ID, p: progress },
  )
  await page.waitForTimeout(500)
}

test.describe('CWS extension-on-Twitch screenshots', () => {
  test.describe.configure({ timeout: 90_000 })

  test('01 live pulse docked beside chat', async ({ extension, prepare }) => {
    await extension.page.setViewportSize({ width: W, height: H })
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        overlayMode: 'expanded',
        overlayPlacement: 'sidebar',
        sidebarTab: 'pulse',
        autoUpdateEnabled: true,
      },
    })
    await openTwitchChannel(extension.page, 'fixturechan')
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /Viewers|Chat \/ min|Collecting|1,180|Just Chatting/i)
    await writeExactStoreShot(extension.page, '01-live-pulse.png')
  })

  test('02 honest not-tracked / coverage state', async ({ extension, prepare }) => {
    await extension.page.setViewportSize({ width: W, height: H })
    await prepare({
      // live-partial pairs rollups with coverage-warming and surfaces Warming UI.
      // CWS listing needs the honest not-tracked panel copy.
      scenario: 'live-not-tracked',
      twitchKind: 'live',
      storage: {
        overlayMode: 'expanded',
        overlayPlacement: 'sidebar',
        sidebarTab: 'pulse',
      },
    })
    await openTwitchChannel(extension.page, 'fixturechan')
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(
      extension.page,
      /Not tracked|live IRC pool|Partial tracking|joined after stream start/i,
    )
    await writeExactStoreShot(extension.page, '02-coverage.png')
  })

  test('03 vod replay pulse', async ({ extension, prepare }) => {
    await extension.page.setViewportSize({ width: W, height: H })
    await prepare({
      scenario: 'vod-ready',
      twitchKind: 'vod',
      storage: {
        overlayMode: 'expanded',
        overlayPlacement: 'sidebar',
        sidebarTab: 'pulse',
      },
    })
    await openTwitchVod(extension.page)
    await waitForPulseRoot(extension.page, 30_000)
    await assertPulseShadowContains(extension.page, /Pulse|VOD|Replay|Past streams|Chat|STREAM RECAP|Peak/i)
    await writeExactStoreShot(extension.page, '03-vod-replay.png')
  })

  test('04 most reacted region on live overlay', async ({ extension, prepare }) => {
    await extension.page.setViewportSize({ width: W, height: H })
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'live',
      storage: {
        overlayMode: 'expanded',
        overlayPlacement: 'sidebar',
        sidebarTab: 'pulse',
      },
    })
    await openTwitchChannel(extension.page, 'fixturechan')
    await waitForPulseRoot(extension.page)
    await assertPulseShadowContains(extension.page, /Most Reacted|Viewers|Collecting/i)
    await extension.page.evaluate(rootId => {
      const host = document.getElementById(rootId)
      const root = host?.shadowRoot
      const body = root?.querySelector(
        '[data-testid="pulse-panel-scroll"], .pulse-panel-scroll',
      ) as HTMLElement | null
      const target = [...(root?.querySelectorAll('h2, h3, section') ?? [])].find(el =>
        /^Most Reacted/i.test((el.textContent ?? '').trim())
        || /Most Reacted So Far/i.test(el.textContent ?? ''),
      ) as HTMLElement | undefined
      if (body && target) {
        const bodyRect = body.getBoundingClientRect()
        const targetRect = target.getBoundingClientRect()
        body.scrollTop += targetRect.top - bodyRect.top - 12
      } else if (body) {
        body.scrollTop = Math.round(Math.max(0, body.scrollHeight - body.clientHeight) * 0.85)
      }
    }, PULSE_ROOT_ID)
    await extension.page.waitForTimeout(400)
    await assertPulseShadowContains(extension.page, /Most Reacted/i)
    await writeExactStoreShot(extension.page, '04-most-reacted.png')

    writeFileSync(
      join(OUT, 'manifest.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          dims: { width: W, height: H },
          kind: 'extension_embedded_on_twitch_tv',
          harness: 'tests/e2e/specs/cws-extension-screenshots.mocked.spec.ts',
          note: 'Real unpacked dist/ content script on *.twitch.tv fixture documents. Not the streampulse-web landing tour.',
          files: [
            '01-live-pulse.png',
            '02-coverage.png',
            '03-vod-replay.png',
            '04-most-reacted.png',
          ],
        },
        null,
        2,
      ) + '\n',
    )
  })
})
