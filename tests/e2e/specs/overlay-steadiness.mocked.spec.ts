import { test, expect } from '../helpers/testFixtures.ts'
import { PULSE_ROOT_ID, assertNoUncaughtErrors, waitForPulseRoot } from '../helpers/assertions.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

/**
 * Codex audit (#70) "Steadier overlay": on a live channel, collapsing and
 * expanding Twitch's side nav, opening a whisper, a Twitch popup and an ad
 * must not make the Pulse panel blink, jitter or replay its slide-in. Unit
 * tests cover the pieces (ad video ignored, live status held, chat remounts
 * held, no entrance animation on the sidebar shell); this drives them in a
 * real page and records every frame.
 */

interface SteadinessLog {
  frames: number
  maxDrift: number
  hiddenFrames: number
  hostRemovals: number
  shellRemovals: number
  entranceAnimations: string[]
  /** Frames with no connected live chart svg in the panel. */
  chartMissingFrames: number
  /** Frames whose header status was not the live one, with what it said instead. */
  statusChangedFrames: number
  statusesSeen: string[]
}

/** The header status pill; "Live chart" while the live panel is up. */
const STATUS_PILL = '.pulse-personal-banner .pulse-banner-copy span[aria-label]'
const LIVE_CHART = 'svg[data-testid="pulse-overview-chart"]'
const LIVE_STATUS = 'Live chart'

test('live: side nav collapse/expand, a whisper, a Twitch popup and an ad do not move, blink or re-animate the panel', async ({
  extension, prepare, evidence,
}, info) => {
  await prepare({ scenario: 'live-ready', twitchKind: 'live' })
  const page = extension.page
  await openTwitchChannel(page)
  await waitForPulseRoot(page)
  const root = page.locator(`#${PULSE_ROOT_ID}`)
  await expect(root.locator(LIVE_CHART)).toBeVisible()
  await expect(root.locator(STATUS_PILL)).toHaveAttribute('aria-label', LIVE_STATUS)
  // Twitch's left side nav, expanded, as the page normally has it.
  await page.evaluate(() => {
    const nav = document.createElement('nav')
    nav.id = 'side-nav'
    nav.setAttribute('data-a-target', 'side-nav-bar')
    nav.style.cssText = 'flex:none;width:240px;height:100vh;background:#1f1f23;transition:none'
    document.getElementById('layout')!.prepend(nav)
  })
  // Let the first placement and its entrance settle before recording.
  await page.waitForTimeout(1_500)
  await info.attach('steadiness-before.png', { body: await page.screenshot(), contentType: 'image/png' })

  await page.evaluate(({ rootId, statusPill, liveChart, liveStatus }) => {
    const host = document.getElementById(rootId)!
    const shadow = host.shadowRoot!
    const log = {
      frames: 0, maxDrift: 0, hiddenFrames: 0, hostRemovals: 0, shellRemovals: 0, entranceAnimations: [] as string[],
      chartMissingFrames: 0, statusChangedFrames: 0, statusesSeen: [] as string[],
    }
    ;(window as unknown as { __steady: typeof log }).__steady = log
    const start = host.getBoundingClientRect()
    const shell = shadow.querySelector('.pulse-shell')
    new MutationObserver(records => {
      for (const record of records) {
        for (const node of Array.from(record.removedNodes)) if (node === host) log.hostRemovals += 1
      }
    }).observe(document.documentElement, { childList: true, subtree: true })
    new MutationObserver(records => {
      for (const record of records) {
        for (const node of Array.from(record.removedNodes)) {
          if (node === shell || (node instanceof Element && node.querySelector?.('.pulse-shell'))) log.shellRemovals += 1
        }
      }
    }).observe(shadow, { childList: true, subtree: true })
    shadow.addEventListener('animationstart', event => {
      const name = (event as AnimationEvent).animationName
      if (/^pulse-in/.test(name)) log.entranceAnimations.push(name)
    }, true)
    const frame = () => {
      log.frames += 1
      const now = host.getBoundingClientRect()
      log.maxDrift = Math.max(log.maxDrift, Math.abs(now.x - start.x), Math.abs(now.y - start.y), Math.abs(now.width - start.width), Math.abs(now.height - start.height))
      const style = getComputedStyle(host)
      if (!host.isConnected || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) < 1 || now.width === 0) log.hiddenFrames += 1
      // The host can stay put while its content flips to a waiting, loading
      // or offline state; check the live chart and live status every frame.
      if (!shadow.querySelector(liveChart)?.isConnected) log.chartMissingFrames += 1
      const status = shadow.querySelector(statusPill)?.getAttribute('aria-label') ?? '(no status)'
      if (status !== liveStatus) {
        log.statusChangedFrames += 1
        if (!log.statusesSeen.includes(status)) log.statusesSeen.push(status)
      }
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }, { rootId: PULSE_ROOT_ID, statusPill: STATUS_PILL, liveChart: LIVE_CHART, liveStatus: LIVE_STATUS })

  const nav = page.locator('#side-nav')
  // Collapse and expand the side nav twice.
  for (const width of ['50px', '240px', '50px', '240px']) {
    await nav.evaluate((el, value) => { el.style.width = value }, width)
    await page.waitForTimeout(400)
  }

  // A whisper thread opens over the page next to chat, then closes.
  await page.evaluate(() => {
    const whisper = document.createElement('div')
    whisper.id = 'whisper-fixture'
    whisper.className = 'whispers-thread'
    whisper.setAttribute('data-a-target', 'whisper-thread')
    whisper.style.cssText = 'position:fixed;right:350px;bottom:0;width:320px;height:420px;background:#18181b;z-index:3000'
    whisper.innerHTML = '<div data-a-target="whisper-thread-header">fixturefriend</div><textarea data-a-target="whisper-message-input"></textarea>'
    document.body.append(whisper)
  })
  await page.waitForTimeout(800)
  await info.attach('steadiness-whisper.png', { body: await page.screenshot(), contentType: 'image/png' })
  await page.evaluate(() => document.getElementById('whisper-fixture')?.remove())
  await page.waitForTimeout(400)

  // A Twitch popup (modal portal) opens and closes.
  await page.evaluate(() => {
    const portal = document.createElement('div')
    portal.id = 'modal-fixture'
    portal.className = 'ReactModalPortal'
    portal.innerHTML = '<div class="ReactModal__Overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:5000"><div role="dialog" class="ReactModal__Content" style="margin:120px auto;width:400px;height:240px;background:#18181b">Popup</div></div>'
    document.body.append(portal)
  })
  await page.waitForTimeout(800)
  await page.evaluate(() => document.getElementById('modal-fixture')?.remove())
  await page.waitForTimeout(400)

  // A pre-roll ad: Twitch puts an ad video ahead of the stream's video in
  // the player, then removes it.
  await page.evaluate(() => {
    const player = document.getElementById('player')!
    const ad = document.createElement('video')
    ad.id = 'ad-fixture'
    ad.setAttribute('data-a-target', 'video-ad-player')
    ad.muted = true
    const label = document.createElement('div')
    label.id = 'ad-label-fixture'
    label.setAttribute('data-a-target', 'video-ad-label')
    label.textContent = 'Ad'
    player.prepend(ad, label)
  })
  await page.waitForTimeout(1_200)
  await page.evaluate(() => {
    document.getElementById('ad-fixture')?.remove()
    document.getElementById('ad-label-fixture')?.remove()
  })
  await page.waitForTimeout(1_500)

  const log = await page.evaluate(() => (window as unknown as { __steady: SteadinessLog }).__steady)
  await info.attach('steadiness-log.json', { body: JSON.stringify(log, null, 2), contentType: 'application/json' })
  await info.attach('steadiness-after.png', { body: await page.screenshot(), contentType: 'image/png' })
  expect(log.frames).toBeGreaterThan(60)
  expect(log.hostRemovals, 'panel host remounted').toBe(0)
  expect(log.shellRemovals, 'panel shell remounted').toBe(0)
  expect(log.entranceAnimations, 'slide-in replayed').toEqual([])
  expect(log.hiddenFrames, 'panel blinked').toBe(0)
  expect(log.maxDrift, 'panel moved or resized').toBeLessThanOrEqual(1)
  // The panel stayed the live panel on every frame, not only at the end.
  expect(log.chartMissingFrames, 'live chart went missing').toBe(0)
  expect(log.statusesSeen, 'header left the live status').toEqual([])
  expect(log.statusChangedFrames, 'header left the live status').toBe(0)
  await expect(root.locator(LIVE_CHART)).toBeVisible()
  assertNoUncaughtErrors(evidence)
})
