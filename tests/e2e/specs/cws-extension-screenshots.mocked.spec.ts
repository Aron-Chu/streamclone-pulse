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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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

/**
 * A caption on the fixture page's stand-in video area, outside the extension:
 * the panel is only the right 340 px of a 1280 px frame, so each store frame
 * says in one line what it shows. Nothing inside the extension is altered.
 */
async function addCaption(page: import('@playwright/test').Page, title: string, body: string) {
  await page.evaluate(({ title, body }) => {
    const box = document.createElement('div')
    box.setAttribute('data-cws-caption', 'true')
    box.style.cssText = 'position:fixed;left:72px;top:50%;transform:translateY(-50%);max-width:760px;z-index:1;font-family:Inter,"Segoe UI",system-ui,sans-serif;color:#fff;pointer-events:none'
    const mark = document.createElement('div')
    mark.textContent = 'StreamPulse'
    mark.style.cssText = 'font-size:20px;font-weight:700;letter-spacing:0.02em;color:#a78bfa;margin-bottom:18px'
    const heading = document.createElement('div')
    heading.textContent = title
    heading.style.cssText = 'font-size:52px;line-height:1.1;font-weight:700;margin-bottom:18px'
    const line = document.createElement('div')
    line.textContent = body
    line.style.cssText = 'font-size:24px;line-height:1.4;font-weight:400;color:#d4d4d8'
    box.append(mark, heading, line)
    document.body.append(box)
  }, { title, body })
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

/**
 * Frame 03's past broadcast: the vod-ready fixture stretched to a whole
 * three-hour stream, so the header's date, length and category, the recap and
 * the chart all describe the same broadcast. Synthetic data on the fixture
 * channel; only this frame uses it.
 */
function replayStoreVod(): Record<string, unknown> {
  const base = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../fixtures/api/vod-ready.json'), 'utf8')) as Record<string, unknown>
  const minutes = 180
  const wave = (minute: number, period: number, phase: number) => (Math.sin((minute / period) * Math.PI * 2 + phase) + 1) / 2
  const spikes = new Map([[38, 2.6], [97, 3.4], [151, 2.2]])
  const points = Array.from({ length: minutes }, (_, index) => {
    const minute = index + 1
    const lift = spikes.get(minute) ?? spikes.get(minute - 1) ?? spikes.get(minute + 1) ?? 1
    const chat = Math.round((34 + 22 * wave(minute, 23, 0.4) + 8 * wave(minute, 7, 1.3)) * lift)
    return {
      offsetSeconds: minute * 60,
      chatPerMin: chat,
      emotesPerMin: Math.round(chat * (0.32 + 0.12 * wave(minute, 11, 2.1))),
      viewers: Math.round(1180 + 520 * Math.min(1, minute / 40) - 140 * wave(minute, 61, 0.2)),
      score: Math.min(100, Math.round(chat / 1.6)),
    }
  })
  const moment = (offsetSeconds: number, label: string) => {
    const point = points[offsetSeconds / 60 - 1]!
    return { offsetSeconds, label, reason: 'emote burst', score: point.score, chatPerMin: point.chatPerMin, emotesPerMin: point.emotesPerMin }
  }
  return {
    ...base,
    durationSeconds: minutes * 60,
    timeline: { bucketSeconds: 60, points },
    topMoments: [moment(97 * 60, 'Chat spike'), moment(38 * 60, 'Emote burst'), moment(151 * 60, 'Chat spike')],
    games: [
      { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 70 * 60 },
      { gameName: 'Minecraft', offsetSeconds: 70 * 60, durationSeconds: 110 * 60 },
    ],
  }
}

async function scrollPulsePanel(page: import('@playwright/test').Page, progress: number) {
  await page.evaluate(
    ({ rootId, p }) => {
      const host = document.getElementById(rootId)
      const body = host?.shadowRoot?.querySelector(
        '.pulse-panel-body, .pulse-sidebar-content, [data-pulse-scroll]',
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
    // Bring the chart into view and point at a minute, so the readout shows.
    const chart = extension.page.locator(`#${PULSE_ROOT_ID} svg[data-testid="pulse-overview-chart"]`)
    await chart.evaluate(element => {
      element.scrollIntoView({ block: 'end' })
      // 'end' leaves the stream-analytics row half under the CHAT/PULSE tabs;
      // scroll a little further so the frame starts cleanly at the stats.
      let node: Element | null = element.parentElement
      while (node && !(node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY))) node = node.parentElement
      node?.scrollBy(0, 20)
    })
    await extension.page.waitForTimeout(300)
    const box = await chart.boundingBox()
    if (box) await extension.page.mouse.move(box.x + box.width * 0.94, box.y + box.height * 0.6)
    await extension.page.waitForTimeout(400)
    await addCaption(extension.page, 'See what Twitch chat reacted to', 'A live Pulse chart of chat, emote and viewer activity, right beside Twitch chat.')
    await writeExactStoreShot(extension.page, '01-live-pulse.png')
  })

  test('02 top moments with a picked moment card', async ({ extension, prepare }) => {
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
    const root = extension.page.locator(`#${PULSE_ROOT_ID}`)
    // Top Moments opens a card only after a pick, and the row stays put.
    const heading = root.getByText(/^Top moments$/i).first()
    await heading.scrollIntoViewIfNeeded()
    const row = root.locator('.pulse-moment-row-button').first()
    await row.scrollIntoViewIfNeeded()
    await row.click()
    await extension.page.waitForTimeout(400)
    await heading.evaluate(element => element.scrollIntoView({ block: 'start' }))
    await extension.page.waitForTimeout(300)
    await addCaption(extension.page, 'Jump to the moments that mattered', 'Top Moments ranks the strongest reactions. Pick one to open its card and jump in the player.')
    await writeExactStoreShot(extension.page, '02-top-moments.png')
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
    const vod = replayStoreVod()
    await extension.page.context().route('https://api.streampulse.stream/v1/extension/pulse/vods/**', route => route.fulfill({ status: 200, json: vod }))
    await openTwitchVod(extension.page)
    await waitForPulseRoot(extension.page, 30_000)
    await assertPulseShadowContains(extension.page, /Minecraft/)
  
    await addCaption(extension.page, 'Recaps for past streams', 'Replay Pulse charts the chat and emotes of a broadcast StreamPulse tracked.')
    await writeExactStoreShot(extension.page, '03-vod-replay.png')
  })

  test('04 quick settings with the Supporter card', async ({ extension, prepare }) => {
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
    const root = extension.page.locator(`#${PULSE_ROOT_ID}`)
    await root.getByRole('button', { name: 'Open settings', exact: true }).click()
    await expect(root.getByRole('heading', { name: 'Quick settings' })).toBeVisible()
    const card = root.locator('[data-settings-host-cta="supporter"]')
    await expect(card).toBeVisible()
    // The Supporter card's stage is scripted motion: wait until the crest has
    // landed (.spk-you, the Crown pile; .spk-sup on builds before it), then
    // let it settle.
    await expect(card.locator('.spk-you, .spk-sup').first()).toBeVisible({ timeout: 30_000 })
    await extension.page.waitForTimeout(900)
    await addCaption(extension.page, 'Settings one click away', 'See what Pulse is charting, and preview Supporter cosmetics only you see, never in chat. Sign-ups are not open yet.')
    await writeExactStoreShot(extension.page, '04-quick-settings.png')
  })

  test('05 help and feedback in settings', async ({ extension, prepare }) => {
    await prepare({ scenario: 'live-ready', twitchKind: 'live' })
    const page = extension.page
    await page.setViewportSize({ width: W, height: H })
    await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#help`)
    // Help & Feedback ships with #74. A branch without it has no fifth frame to
    // take; the store set is captured from the RC, which has every 0.2.2 PR.
    await expect(page.getByText('Updates & Changelog').first()).toBeVisible()
    test.skip(await page.getByText('Help & Feedback').count() === 0, 'this build has no Help & Feedback section')
    await expect(page.getByText('Send feedback', { exact: true }).first()).toBeVisible()
    await page.waitForTimeout(1200)
    await writeExactStoreShot(page, '05-help-feedback.png')

    writeFileSync(
      join(OUT, 'manifest.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          dims: { width: W, height: H },
          kind: 'extension_embedded_on_twitch_tv',
          harness: 'tests/e2e/specs/cws-extension-screenshots.mocked.spec.ts',
          note: 'Real unpacked dist/ content script on *.twitch.tv fixture documents (01-04) and the packaged settings page (05). Synthetic fixture channel; mocked captures are not live evidence. Not the streampulse-web landing tour.',
          files: [
            '01-live-pulse.png',
            '02-top-moments.png',
            '03-vod-replay.png',
            '04-quick-settings.png',
            '05-help-feedback.png',
          ],
        },
        null,
        2,
      ) + '\n',
    )
  })
})
