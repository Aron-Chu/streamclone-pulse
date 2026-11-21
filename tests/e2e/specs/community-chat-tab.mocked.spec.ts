import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'

// Twitch's own Community control: one header button opens the list over chat and closes it again.
async function addTwitchCommunityControl(page: import('@playwright/test').Page, locale: 'en' | 'de' | 'ja'): Promise<void> {
  await page.evaluate((lang) => {
    document.documentElement.lang = lang
    const labels = {
      en: ['Community', 'Go back to Chat'],
      de: ['Community', 'Zurück zum Chat'],
      ja: ['コミュニティ', 'チャットに戻る'],
    }[lang]!
    const header = document.querySelector('[data-a-target="chat-room-header"]')!
    const section = header.parentElement!
    const chatArea = section.querySelector<HTMLElement>('[data-a-target="chat-scrollable-area"]')!
    const region = document.createElement('div')
    region.setAttribute('data-test-selector', 'fixture-community-list')
    region.style.cssText = 'display:none;height:420px;padding:12px'
    region.textContent = 'Fixture community list'
    section.insertBefore(region, chatArea)
    const button = document.createElement('button')
    button.setAttribute('data-test-selector', 'chat-viewer-list')
    button.setAttribute('aria-label', labels[0]!)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', '24')
    svg.setAttribute('height', '24')
    svg.setAttribute('viewBox', '0 0 24 24')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    const communityPath = 'M8 2a5 5 0 0 0-1 9.9'
    path.setAttribute('d', communityPath)
    svg.append(path)
    button.append(svg)
    button.addEventListener('click', () => {
      const open = region.style.display !== 'none'
      region.style.display = open ? 'none' : 'block'
      chatArea.style.display = open ? '' : 'none'
      button.setAttribute('aria-label', labels[open ? 0 : 1]!)
      path.setAttribute('d', open ? communityPath : 'M9 10h2v2H9v-2Zm6 0h-2v2h2v-2Z')
      // Twitch can keep the composer mounted behind the Community view.
    })
    header.append(button)
  }, locale)
}

async function communityIsOnTop(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const region = document.querySelector<HTMLElement>('[data-test-selector="fixture-community-list"]')
    if (!region || region.style.display === 'none') return false
    const box = region.getBoundingClientRect()
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return Boolean(top && region.contains(top))
  })
}

for (const locale of ['en', 'de', 'ja'] as const) {
test(`${locale}: Community from the PULSE tab lands on CHAT with the Community list showing`, async ({ extension, prepare }) => {
  await prepare({ storage: { overlayPlacement: 'sidebar', overlayMode: 'expanded', sidebarTab: 'pulse' } })
  const page = extension.page
  await page.setViewportSize({ width: 1440, height: 900 })
  await openTwitchChannel(page)
  await waitForPulseRoot(page)
  await addTwitchCommunityControl(page, locale)

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

test(`${locale}: Community already open behind PULSE stays open when the button moves to CHAT`, async ({ extension, prepare }) => {
  await prepare({ storage: { overlayPlacement: 'sidebar', overlayMode: 'expanded', sidebarTab: 'pulse' } })
  const page = extension.page
  await page.setViewportSize({ width: 1440, height: 900 })
  await openTwitchChannel(page)
  await waitForPulseRoot(page)
  await addTwitchCommunityControl(page, locale)
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('[data-test-selector="chat-viewer-list"]')!.click())

  const tabs = page.locator('#streamclone-pulse-tabs')
  // The list is hidden behind PULSE, so the button offers to show it, not to close it.
  const button = tabs.getByRole('button', { name: 'Open chatters list' })
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await button.click()
  await expect(tabs.getByRole('tab', { name: /chat/i })).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => communityIsOnTop(page)).toBe(true)
})
}
