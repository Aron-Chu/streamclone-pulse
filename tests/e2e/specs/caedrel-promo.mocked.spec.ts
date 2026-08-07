import { test, expect } from '../helpers/testFixtures.ts'
import { assertExactlyOnePulseRoot, assertNoUncaughtErrors, waitForPulseRoot } from '../helpers/assertions.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'

test.describe('Caedrel-style Twitch campaign chrome', () => {
  test('keeps Pulse geometry stable and restores native Chat across promo churn', async ({
    extension,
    prepare,
    evidence,
  }) => {
    await prepare({
      scenario: 'live-ready',
      twitchKind: 'caedrel-promo',
      storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse' },
    })
    await openTwitchChannel(extension.page)
    await waitForPulseRoot(extension.page)

    const initial = await extension.page.evaluate(() => {
      const outer = document.querySelector('.channel-root__right-column')
      const header = document.querySelector('[data-a-target="chat-room-header"]')
      const gift = document.querySelector('[data-a-target="community-sub-gift-progress"]')
      const campaign = document.querySelector('[data-a-target="ewc-campaign-portal"]') as HTMLElement | null
      const panel = document.getElementById('streamclone-pulse-root')
      const tabs = document.getElementById('streamclone-pulse-tabs')
      if (!outer || !header || !gift || !campaign || !panel || !tabs) return null
      const panelRect = panel.getBoundingClientRect()
      const giftRect = gift.getBoundingClientRect()
      return {
        campaignVisibility: getComputedStyle(campaign).visibility,
        campaignPointerEvents: getComputedStyle(campaign).pointerEvents,
        panelTop: panelRect.top,
        giftBottom: giftRect.bottom,
        panelDisplay: getComputedStyle(panel).display,
        tabsDisplay: getComputedStyle(tabs).display,
        outerRect: outer.getBoundingClientRect().toJSON(),
      }
    })

    expect(initial).not.toBeNull()
    expect(initial!.campaignVisibility).toBe('hidden')
    expect(initial!.campaignPointerEvents).toBe('none')
    expect(initial!.panelDisplay).toBe('block')
    expect(initial!.tabsDisplay).toBe('block')
    expect(initial!.panelTop).toBeGreaterThanOrEqual(initial!.giftBottom - 1)

    await extension.page.evaluate(() => {
      const oldCampaign = document.querySelector('[data-a-target="ewc-campaign-portal"]')
      oldCampaign?.remove()
      const next = document.createElement('div')
      next.setAttribute('data-a-target', 'ewc-campaign-portal')
      next.textContent = 'EWC campaign inserted again'
      document.body.appendChild(next)
    })
    await expect
      .poll(() => extension.page.evaluate(() => {
        const campaign = document.querySelector('[data-a-target="ewc-campaign-portal"]') as HTMLElement | null
        return campaign ? getComputedStyle(campaign).visibility : null
      }))
      .toBe('hidden')

    await expect(extension.page.getByRole('tab', { name: 'Chat', exact: true })).toBeVisible()
    await extension.page.getByRole('tab', { name: 'Chat', exact: true }).click()
    await expect(extension.page.getByRole('tab', { name: 'Chat', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => extension.page.evaluate(() => {
      const header = document.querySelector('[data-a-target="chat-room-header"] h2') as HTMLElement | null
      const log = document.querySelector('[role="log"]') as HTMLElement | null
      const campaign = document.querySelector('[data-a-target="ewc-campaign-portal"]') as HTMLElement | null
      return {
        headerVisibility: header ? getComputedStyle(header).visibility : null,
        logVisibility: log ? getComputedStyle(log).visibility : null,
        campaignVisibility: campaign ? getComputedStyle(campaign).visibility : null,
      }
    })).toEqual({ headerVisibility: 'visible', logVisibility: 'visible', campaignVisibility: 'visible' })

    await extension.page.getByRole('tab', { name: 'Pulse', exact: true }).click()
    await expect.poll(() => extension.page.evaluate(() => {
      const panel = document.getElementById('streamclone-pulse-root')
      const campaign = document.querySelector('[data-a-target="ewc-campaign-portal"]') as HTMLElement | null
      return {
        panelDisplay: panel ? getComputedStyle(panel).display : null,
        campaignVisibility: campaign ? getComputedStyle(campaign).visibility : null,
      }
    })).toEqual({ panelDisplay: 'block', campaignVisibility: 'hidden' })

    await assertExactlyOnePulseRoot(extension.page)
    assertNoUncaughtErrors(evidence)
  })
})
