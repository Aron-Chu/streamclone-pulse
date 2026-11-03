import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'

// Twitch's own Community control: one header button opens the list over chat and closes it again.
async function addTwitchCommunityControl(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const header = document.querySelector('[data-a-target="chat-room-header"]')!
    const section = header.parentElement!
    const chatArea = section.querySelector<HTMLElement>('[data-a-target="chat-scrollable-area"]')!
    const region = document.createElement('div')
    region.setAttribute('role', 'region')
    region.setAttribute('aria-label', 'Community')
    region.style.cssText = 'display:none;height:420px;padding:12px'
    region.textContent = 'Fixture community list'
    section.insertBefore(region, chatArea)
    const button = document.createElement('button')
    button.setAttribute('data-a-target', 'community-tab')
    button.setAttribute('aria-label', 'Community')
    button.textContent = 'Community'
    button.addEventListener('click', () => {
      const open = region.style.display !== 'none'
      region.style.display = open ? 'none' : 'block'
      chatArea.style.display = open ? '' : 'none'
    })
    header.append(button)
  })
}

async function communityIsOnTop(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const region = document.querySelector<HTMLElement>('[role="region"][aria-label="Community"]')
    if (!region || region.style.display === 'none') return false
    const box = region.getBoundingClientRect()
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return Boolean(top && region.contains(top))
  })
}

test('Community from the PULSE tab lands on CHAT with the Community list showing', async ({ extension, prepare }) => {
  await prepare({ storage: { overlayPlacement: 'sidebar', overlayMode: 'expanded', sidebarTab: 'pulse' } })
  const page = extension.page
  await page.setViewportSize({ width: 1440, height: 900 })
  await openTwitchChannel(page)
  await waitForPulseRoot(page)
  await addTwitchCommunityControl(page)

  const tabs = page.locator('#streamclone-pulse-tabs')
  const pulseTab = tabs.getByRole('tab', { name: /pulse/i })
  const chatTab = tabs.getByRole('tab', { name: /chat/i })
  await expect(pulseTab).toHaveAttribute('aria-selected', 'true')

  await tabs.getByRole('button', { name: 'Open chatters list' }).click()
  await expect(chatTab).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => communityIsOnTop(page)).toBe(true)
  await expect(tabs.getByRole('button', { name: 'Close chatters list' })).toHaveAttribute('aria-pressed', 'true')

  // Back on CHAT the same button closes the list and leaves the tab alone.
  await tabs.getByRole('button', { name: 'Close chatters list' }).click()
  await expect(chatTab).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => communityIsOnTop(page)).toBe(false)
})

test('Community already open behind PULSE stays open when the button moves to CHAT', async ({ extension, prepare }) => {
  await prepare({ storage: { overlayPlacement: 'sidebar', overlayMode: 'expanded', sidebarTab: 'pulse' } })
  const page = extension.page
  await page.setViewportSize({ width: 1440, height: 900 })
  await openTwitchChannel(page)
  await waitForPulseRoot(page)
  await addTwitchCommunityControl(page)
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-a-target="community-tab"]')!.click())

  const tabs = page.locator('#streamclone-pulse-tabs')
  // The list is hidden behind PULSE, so the button offers to show it, not to close it.
  const button = tabs.getByRole('button', { name: 'Open chatters list' })
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await button.click()
  await expect(tabs.getByRole('tab', { name: /chat/i })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => communityIsOnTop(page)).toBe(true)
})
