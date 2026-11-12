import { test, expect } from '../helpers/testFixtures.ts'
import { PULSE_ROOT_ID, PULSE_TABS_ID, assertNoUncaughtErrors, waitForPulseRoot } from '../helpers/assertions.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

/**
 * Twitch's pinned-message card carries a 32 px "Collapse" button of its own
 * at the top of the message list. Read as a chat-header control it stretched
 * the header row, and the Pulse tab row and panel dropped 26 px for as long as
 * a message was pinned. Pin and unpin a message and record both hosts every
 * frame.
 */

interface PinnedLog {
  frames: number
  tabsDrift: number
  panelDrift: number
}

const LIVE_CHART = 'svg[data-testid="pulse-overview-chart"]'

test('live: pinning and unpinning a chat message does not move the Pulse tab row or panel', async ({
  extension, prepare, evidence,
}, info) => {
  await prepare({ scenario: 'live-ready', twitchKind: 'live' })
  const page = extension.page
  await openTwitchChannel(page)
  await waitForPulseRoot(page)
  await expect(page.locator(`#${PULSE_ROOT_ID}`).locator(LIVE_CHART)).toBeVisible()
  // Twitch's header row: collapse toggle, title and chatters button on one 50 px row.
  await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('[data-a-target="chat-room-header"]')!
    header.style.cssText = 'display:flex;align-items:center;gap:8px;height:50px;box-sizing:border-box;padding:0 10px'
    header.innerHTML = [
      '<button data-a-target="right-column__toggle-collapse-btn" aria-label="Collapse Chat" style="width:30px;height:30px;flex:none"></button>',
      '<h2 style="margin:0;flex:1;font-size:13px;line-height:20px;text-align:center">Stream chat</h2>',
      '<button data-a-target="chat-viewers" aria-label="Users in chat" style="width:30px;height:30px;flex:none"></button>',
    ].join('')
  })
  await page.waitForTimeout(1_500)
  await expect(page.locator(`#${PULSE_TABS_ID}`)).toBeVisible()
  await info.attach('pinned-before.png', { body: await page.screenshot(), contentType: 'image/png' })

  await page.evaluate(({ tabsId, rootId }) => {
    const tabs = document.getElementById(tabsId)!
    const panel = document.getElementById(rootId)!
    const log = { frames: 0, tabsDrift: 0, panelDrift: 0 }
    ;(window as unknown as { __pinned: typeof log }).__pinned = log
    const drift = (start: DOMRect, now: DOMRect) => Math.max(
      Math.abs(now.x - start.x), Math.abs(now.y - start.y),
      Math.abs(now.width - start.width), Math.abs(now.height - start.height),
    )
    const tabsStart = tabs.getBoundingClientRect()
    const panelStart = panel.getBoundingClientRect()
    const frame = () => {
      log.frames += 1
      log.tabsDrift = Math.max(log.tabsDrift, drift(tabsStart, tabs.getBoundingClientRect()))
      log.panelDrift = Math.max(log.panelDrift, drift(panelStart, panel.getBoundingClientRect()))
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }, { tabsId: PULSE_TABS_ID, rootId: PULSE_ROOT_ID })

  // A message is pinned: the card lands at the top of the message list.
  await page.evaluate(() => {
    document.querySelector('[data-a-target="chat-scrollable-area"]')!.insertAdjacentHTML('afterbegin', [
      '<div id="pinned-fixture" data-a-target="pinned-chat-messages-list"',
      ' style="display:flex;align-items:flex-start;gap:8px;padding:8px;background:#26262c;border-radius:6px">',
      '<div style="flex:1">Pinned by fixturechan: welcome in</div>',
      '<button aria-label="Collapse" style="width:32px;height:32px;flex:none"></button>',
      '</div>',
    ].join(''))
  })
  // Past the mutation burst and the 2 s periodic remeasure.
  await page.waitForTimeout(2_600)
  await info.attach('pinned-shown.png', { body: await page.screenshot(), contentType: 'image/png' })
  await page.evaluate(() => document.getElementById('pinned-fixture')?.remove())
  await page.waitForTimeout(2_600)

  const log = await page.evaluate(() => (window as unknown as { __pinned: PinnedLog }).__pinned)
  await info.attach('pinned-log.json', { body: JSON.stringify(log, null, 2), contentType: 'application/json' })
  expect(log.frames).toBeGreaterThan(60)
  expect(log.tabsDrift, 'Pulse tab row moved or resized').toBeLessThanOrEqual(1)
  expect(log.panelDrift, 'Pulse panel moved or resized').toBeLessThanOrEqual(1)
  assertNoUncaughtErrors(evidence)
})
