import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page, TestInfo } from '@playwright/test'
import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'
import { linkDevice, serveMembership, supporterBody } from '../helpers/supporterMembership.ts'

/**
 * The design lab's Supporter banners, packaged: the quick-settings card and the
 * full-settings banner both show "Emote Pile · Crown" (the sample kit for
 * non-Supporters, a Supporter's own crest and paint). The card's pile is drawn
 * by a script the worker injects only when the card is shown. Neither draws a
 * chat column: nothing a Supporter has is added to Twitch chat. Fixture APIs
 * only; emote images come from the two CDNs the extension already loads.
 *
 * Set SUPPORTER_LAB_PORT_DIR to also write the fidelity captures there.
 */
const CAPTURES = process.env.SUPPORTER_LAB_PORT_DIR
const EMOTE_SRC = /^https:\/\/(static-cdn\.jtvnw\.net\/emoticons\/v2\/\d+\/default\/dark\/2\.0|cdn\.7tv\.app\/emote\/[0-9A-Z]+\/(2x|2x_static)\.webp)$/

/**
 * One clipped page screenshot. An element screenshot makes Chromium re-hit-test
 * the pointer, which reads as leaving and re-entering the card and ends a hover.
 */
async function capture(target: Locator, info: TestInfo, name: string) {
  const box = await target.boundingBox()
  expect(box, `${name}: target is not visible`).not.toBeNull()
  const path = info.outputPath(name)
  await target.page().screenshot({ path, clip: box! })
  if (CAPTURES) {
    mkdirSync(CAPTURES, { recursive: true })
    copyFileSync(path, join(CAPTURES, name))
  }
}

async function openQuickSettingsAt305(page: Page) {
  await openTwitchChannel(page)
  await waitForPulseRoot(page)
  // The lab's sidebar card sits in a ~300 px Twitch rail.
  await page.addStyleTag({ content: '.channel-root__right-column { min-width: 305px !important; width: 305px !important; }' })
  const root = page.locator('#streamclone-pulse-root')
  await root.getByRole('button', { name: 'Open settings', exact: true }).click()
  await expect(root.getByRole('heading', { name: 'Quick settings' })).toBeVisible()
  return root
}

/**
 * The card shows only its title row and the stage, right under it: no copy
 * covers the stage. The copy is the button's description for screen readers,
 * not part of its name.
 */
async function expectStageUncovered(card: Locator, action: string, copy: string) {
  await expect(card).toHaveAccessibleName(new RegExp(`^Pulse Supporter\\s*${action}$`))
  await expect(card).toHaveAccessibleDescription(copy)
  await expect(card.locator('small')).toHaveCount(0)
  await expect(card.getByText(copy)).toBeHidden()
  const [head, stage] = await Promise.all([card.locator('.pulse-supporter-cta-head').boundingBox(), card.locator('.pulse-supporter-stage').boundingBox()])
  expect(stage!.y - (head!.y + head!.height)).toBeLessThanOrEqual(10)
  expect(stage!.height).toBeGreaterThanOrEqual(90)
}

/** Emote images settle before a capture (the CDNs are real; nothing else is). */
async function imagesSettled(stage: Locator) {
  await stage.locator('img').evaluateAll(images => Promise.all(images.map(image => {
    const img = image as HTMLImageElement
    return img.complete ? null : new Promise(resolve => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }) })
  })))
}

/** The card draws perks on their own: no chat column, chat line or chatter names. */
async function expectNoChatColumn(stage: Locator) {
  await expect(stage.locator('.spk-chat, .spk-cl, .spk-sup, .spk-chip')).toHaveCount(0)
  const words = await stage.locator('.spk-body').evaluateAll(bodies => bodies.map(body => body.textContent?.trim() ?? '').filter(Boolean))
  expect(words).toEqual([])
  for (const src of await stage.locator('img').evaluateAll(images => images.map(image => (image as HTMLImageElement).src))) expect(src).toMatch(EMOTE_SRC)
}

test('quick settings: non-Supporters get the Crown pile with the sample crest, injected on demand, never a chat column', async ({ extension, prepare }, info) => {
  await prepare({ storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
  const page = extension.page
  const root = await openQuickSettingsAt305(page)
  const card = root.locator('[data-settings-host-cta="supporter"]')
  const stage = card.locator('.pulse-supporter-stage')
  await expect(stage).toHaveAttribute('data-mode', 'crown')
  await expect(stage).toHaveAttribute('data-running', 'true')
  await expect(card.locator('.pulse-supporter-cta-head')).toHaveText('Pulse SupporterExplore Supporter ›')
  await expectStageUncovered(card, 'Explore Supporter', 'Supporter perks: Title paint, Tenure crest, Emote rain, Supporter card. Only you see them. Core tools stay free.')
  expect((await card.boundingBox())!.width).toBeLessThanOrEqual(305)

  // The sample crest lands on the pile, with a "you" tag in the sample's paint.
  const you = stage.locator('.spk-you')
  await expect(you.first()).toBeAttached({ timeout: 20_000 })
  await expect(you.first().locator('.spk-crest')).toHaveAttribute('data-tenure', '12m')
  await expect(stage.locator('.spk-tag')).toHaveText('you')
  await expectNoChatColumn(stage)
  await page.mouse.move(5, 5)
  await imagesSettled(stage)
  await page.waitForTimeout(1600)
  await capture(card, info, 'ext-card-crown-rest.png')
  expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)

  // A peak (8 s in): a row lands, then the crest on top.
  await expect(stage).toHaveAttribute('data-peaks', '1', { timeout: 15_000 })
  await page.waitForTimeout(900)
  await capture(card, info, 'ext-card-crown-peak.png')
  await expectNoChatColumn(stage)

  // Hover shakes the pile and drops a crest in.
  await card.hover()
  await expect(you.first()).toBeAttached()
  await page.waitForTimeout(600)
  await capture(card, info, 'ext-card-crown-hover.png')
  await page.mouse.move(5, 5)

  // Scrolled out of the panel, the stage stops scheduling frames.
  await page.setViewportSize({ width: 1440, height: 520 })
  const scroll = (to: 'top' | 'bottom') => card.evaluate((element, where) => {
    let node: Node | null = element
    while (node) {
      if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(node).overflowY)) {
        node.scrollTop = where === 'top' ? 0 : node.scrollHeight
        return true
      }
      node = node.parentNode instanceof ShadowRoot ? node.parentNode.host : node.parentNode
    }
    return false
  }, to)
  expect(await scroll('bottom')).toBe(true)
  await expect(stage).toHaveAttribute('data-running', 'false')
  await scroll('top')
  await expect(stage).toHaveAttribute('data-running', 'true')
  await page.setViewportSize({ width: 1440, height: 900 })

  // Reduced motion: one settled pile from static images.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(stage).toHaveAttribute('data-still', 'true')
  await expect(stage).toHaveAttribute('data-running', 'false')
  await expect(stage.locator('.spk-you').last()).toBeAttached()
  for (const src of await stage.locator('img[src*="cdn.7tv.app"]').evaluateAll(images => images.map(image => (image as HTMLImageElement).src))) expect(src).toMatch(/\/2x_static\.webp$/)
  await imagesSettled(stage)
  await capture(card, info, 'ext-card-crown-still.png')
})

test('quick settings: Supporters get the Crown pile with their own crest, in their paint', async ({ extension, prepare }, info) => {
  await prepare({ storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
  // A choice an older build saved for the dropped signature perk: left in place, never shown.
  await extension.serviceWorker.evaluate(() => chrome.storage.sync.set({ supporterSignatureEmote: 'wideReacting' }))
  await linkDevice(extension.serviceWorker)
  // 13 support periods: the Year-one crest.
  await serveMembership(extension.context, () => supporterBody('active', 13, { enabled: true, finish: 'etched' }))
  const page = extension.page
  const root = await openQuickSettingsAt305(page)
  const card = root.locator('[data-settings-host-cta="supporter"]')
  const stage = card.locator('.pulse-supporter-stage')
  await expect(card).toHaveAttribute('data-supporter-verified', 'true')
  await expect(stage).toHaveAttribute('data-mode', 'crown')
  await expect(card.locator('.pulse-supporter-cta-head')).toHaveText('Pulse SupporterManage Supporter ›')
  await expectStageUncovered(card, 'Manage Supporter', 'Your Supporter perks: Title paint, Tenure crest, Emote rain, Supporter card. Only you see them. Core tools stay free.')

  await expect(stage.locator('.spk-you').first().locator('.spk-crest')).toHaveAttribute('data-tenure', '12m', { timeout: 20_000 })
  await expect(stage.locator('.spk-tag .spk-name')).toHaveAttribute('data-finish', 'etched')
  await expectNoChatColumn(stage)
  await page.mouse.move(5, 5)
  await imagesSettled(stage)
  await page.waitForTimeout(700)
  await capture(card, info, 'ext-card-crown-supporter.png')
  await expect(stage.locator('img[src*="01HMM8VG3R0007GXBD883VP2YY"].spk-kit-emote')).toHaveCount(0)
  expect(await extension.serviceWorker.evaluate(() => chrome.storage.sync.get('supporterSignatureEmote'))).toEqual({ supporterSignatureEmote: 'wideReacting' })
})

test('full settings: the staged Crown, the lab sample for non-Supporters, paused offscreen and still under reduced motion', async ({ extension, prepare }, info) => {
  await prepare()
  const page = extension.page
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#pulse`)
  const banner = page.locator('[data-settings-host-banner="supporter"]')
  const stage = banner.locator('.pulse-supporter-pile')
  await expect(banner).toHaveAttribute('data-supporter-kit', 'sample')
  await expect(stage).toHaveAttribute('data-mode', 'crown')
  await expect(stage).toHaveAttribute('data-running', 'true')
  await expect(banner.locator('.pulse-settings-supporter-banner-eyebrow')).toHaveText('Pulse Supporter· US$4.99/mo')
  await expect(banner.locator('strong')).toHaveText('Your crest lands on top')
  await expect(banner.locator('.pulse-settings-supporter-perk')).toHaveText(['Title paint', 'Tenure crest', 'Emote rain', 'Supporter card'])
  await expect(banner.locator('small')).toHaveText('Only you see them. Core tools stay free.')
  await expect(banner.locator('.pulse-settings-supporter-banner-arrow')).toHaveText('View benefits →')
  await expect.poll(() => stage.locator('.spk-body').count()).toBeGreaterThanOrEqual(8)
  // Yours is the sample crest, with the small "you" tag riding above it.
  const you = stage.locator('.spk-you')
  await expect(you.first().locator('.spk-crest')).toHaveAttribute('data-tenure', '12m')
  await expect(you.locator('img')).toHaveCount(0)
  const tag = stage.locator('.spk-tag')
  await expect(tag).toHaveText('you')
  await expect(tag).toHaveCSS('opacity', '1')
  // The pile has the whole right half.
  const [bannerBox, stageBox] = await Promise.all([banner.boundingBox(), stage.boundingBox()])
  expect(stageBox!.x - bannerBox!.x).toBeCloseTo(bannerBox!.width / 2, -1)
  expect(bannerBox!.height).toBeGreaterThanOrEqual(132)
  expect(bannerBox!.height).toBeLessThanOrEqual(134)
  for (const src of await stage.locator('img').evaluateAll(images => images.map(image => (image as HTMLImageElement).src))) expect(src).toMatch(EMOTE_SRC)
  expect(await banner.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await page.waitForTimeout(2500)
  await capture(banner, info, 'ext-banner-crown-rest.png')

  // Hover shakes the pile and drops yours in.
  const yoursBefore = await you.count()
  await banner.hover()
  await expect.poll(() => you.count()).toBeGreaterThanOrEqual(Math.min(2, yoursBefore + 1))
  await page.waitForTimeout(250)
  await capture(banner, info, 'ext-banner-crown-hover.png')
  await page.mouse.move(5, 700)

  // A peak (8 s in, then every 28 to 36 s): a row of nine, then yours on top, and the glow swells.
  const before = await stage.locator('.spk-body').count()
  await expect(stage).toHaveAttribute('data-peaks', '1', { timeout: 15_000 })
  await expect(stage).toHaveAttribute('data-glow', 'peak')
  await page.waitForTimeout(1100)
  expect(await stage.locator('.spk-you').count()).toBeGreaterThanOrEqual(1)
  expect(await stage.locator('.spk-body').count()).toBeGreaterThanOrEqual(Math.min(26, before))
  await capture(banner, info, 'ext-banner-crown-peak.png')

  // Offscreen, the stage stops scheduling frames.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(stage).toHaveAttribute('data-running', 'false')
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(stage).toHaveAttribute('data-running', 'true')

  // The lab's phone layout: copy on top, the pile along the bottom, nothing scrolling sideways.
  await page.setViewportSize({ width: 400, height: 860 })
  await expect.poll(() => banner.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expect.poll(async () => (await stage.boundingBox())!.height).toBeCloseTo(84, 0)
  await page.waitForTimeout(1500)
  expect(await banner.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await capture(banner, info, 'ext-banner-crown-phone.png')
  await page.setViewportSize({ width: 1280, height: 720 })

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(stage).toHaveAttribute('data-still', 'true')
  await expect(stage).toHaveAttribute('data-running', 'false')
  for (const src of await stage.locator('img[src*="cdn.7tv.app"]').evaluateAll(images => images.map(image => (image as HTMLImageElement).src))) expect(src).toMatch(/\/2x_static\.webp$/)
  await expect(stage.locator('.spk-you .spk-crest').first()).toBeAttached()
  await imagesSettled(stage)
  await capture(banner, info, 'ext-banner-crown-still.png')
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  // The banner opens the benefits, where no signature emote is offered any more.
  await banner.click()
  await expect(page).toHaveURL(/#supporter$/)
  await expect(page.getByRole('heading', { name: 'Account & Supporter' })).toBeVisible()
  await expect(page.locator('.pulse-supporter-signature-choices')).toHaveCount(0)
  await expect(page.getByText(/signature emote/i)).toHaveCount(0)
  expect(await extension.serviceWorker.evaluate(() => chrome.storage.sync.get('supporterSignatureEmote'))).toEqual({})
})

test('full settings: a Supporter’s own crest crowns the pile in their paint, and an old signature choice is left alone', async ({ extension, prepare }, info) => {
  await prepare()
  // Saved by an older build for the dropped signature perk.
  await extension.serviceWorker.evaluate(() => chrome.storage.sync.set({ supporterSignatureEmote: 'wideReacting' }))
  await linkDevice(extension.serviceWorker)
  await serveMembership(extension.context, () => supporterBody('active', 13, { enabled: true, finish: 'halo' }))
  const page = extension.page
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#pulse`)
  const banner = page.locator('[data-settings-host-banner="supporter"]')
  const stage = banner.locator('.pulse-supporter-pile')
  await expect(banner).toHaveAttribute('data-supporter-kit', 'own')
  await expect(banner).toHaveCSS('--spk-fin', '#e6a9d6')
  await expect(banner.locator('.pulse-settings-supporter-banner-eyebrow')).toHaveText('Your kit')
  await expect(banner.locator('strong')).toHaveText('Yours lands on top')
  await expect(banner.locator('.pulse-settings-supporter-perk')).toHaveText(['Halo paint', 'Year-one crest', 'Emote rain', 'Supporter card'])
  const you = stage.locator('.spk-you')
  await expect(you.first().locator('.spk-crest')).toHaveAttribute('data-tenure', '12m')
  await expect(you.first().locator('.spk-crest polygon')).toHaveAttribute('stroke', '#e6a9d6')
  await expect(you.locator('img')).toHaveCount(0)
  await expect(stage.locator('.spk-tag .pulse-paint')).toHaveAttribute('data-finish', 'halo')
  await page.waitForTimeout(2500)
  await capture(banner, info, 'ext-banner-crown-supporter.png')

  // Account & Supporter offers no emote picker, and the old choice stays stored, untouched.
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Account & Supporter', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Account & Supporter' })).toBeVisible()
  await expect(page.locator('.pulse-supporter-signature-choices')).toHaveCount(0)
  expect(await extension.serviceWorker.evaluate(() => chrome.storage.sync.get('supporterSignatureEmote'))).toEqual({ supporterSignatureEmote: 'wideReacting' })
})
