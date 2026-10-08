import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page, TestInfo } from '@playwright/test'
import { test, expect } from '../helpers/testFixtures.ts'
import { openTwitchChannel } from '../helpers/mockTwitch.ts'
import { waitForPulseRoot } from '../helpers/assertions.ts'
import { linkDevice, serveMembership, supporterBody } from '../helpers/supporterMembership.ts'

/**
 * The design lab's Supporter banners, packaged: the quick-settings card is
 * "Your Line" (Anatomy for non-Supporters, Tenure Climb for Supporters), drawn
 * by a script the worker injects only when the card is shown; the full-settings
 * banner is "Emote Pile · Crown". Fixture APIs only; emote images come from the
 * two CDNs the extension already loads.
 *
 * Set SUPPORTER_LAB_PORT_DIR to also write the fidelity captures there.
 */
const CAPTURES = process.env.SUPPORTER_LAB_PORT_DIR
const EMOTE_SRC = /^https:\/\/(static-cdn\.jtvnw\.net\/emoticons\/v2\/\d+\/default\/dark\/2\.0|cdn\.7tv\.app\/emote\/[0-9A-Z]+\/(2x|2x_static)\.webp)$/
const CANNED = /^(mochi_rx|tilted_tom|vod_goblin|orbit42|sleepyyy|nightowl|pixelpanda|clipchimp|ramen_cat|lowping):( |$)/
const YOURS = /^you: (saved that moment|that peak was mine|called it|clip it|gg|still here|here again|run it back|day one)/

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

/** Emote images settle before a capture (the CDNs are real; nothing else is). */
async function imagesSettled(stage: Locator) {
  await stage.locator('img').evaluateAll(images => Promise.all(images.map(image => {
    const img = image as HTMLImageElement
    return img.complete ? null : new Promise(resolve => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }) })
  })))
}

async function expectCannedChat(stage: Locator) {
  const texts = await stage.locator('.spk-cl').evaluateAll(lines => lines.map(line => line.textContent?.replace(/\s+/g, ' ').trim() ?? ''))
  expect(texts.length).toBeGreaterThan(0)
  for (const text of texts) expect(CANNED.test(text) || YOURS.test(text), text).toBe(true)
  for (const text of texts) expect(text).not.toMatch(/supporter|support pulse|subscribe/i)
  for (const src of await stage.locator('img').evaluateAll(images => images.map(image => (image as HTMLImageElement).src))) expect(src).toMatch(EMOTE_SRC)
}

test('quick settings: non-Supporters get Your Line · Anatomy, injected on demand, with no labels over the line and a peak', async ({ extension, prepare }, info) => {
  await prepare({ storage: { overlayPlacement: 'sidebar', sidebarTab: 'pulse', overlayMode: 'expanded' } })
  const page = extension.page
  const root = await openQuickSettingsAt305(page)
  const card = root.locator('[data-settings-host-cta="supporter"]')
  const stage = card.locator('.pulse-supporter-stage')
  await expect(stage).toHaveAttribute('data-mode', 'anatomy')
  await expect(stage).toHaveAttribute('data-running', 'true')
  await expect(card.locator('.pulse-supporter-cta-head')).toHaveText('Pulse SupporterExplore Supporter ›')
  await expect(card.locator('small')).toHaveText('Your crest and paint on your line. Only you see them. Core tools stay free.')
  expect((await card.boundingBox())!.width).toBeLessThanOrEqual(305)

  // Every sixth line is yours, with the lab's sample crest, Etched paint and sample emote.
  const yours = stage.locator('.spk-cl.spk-sup')
  await expect(yours.first()).toBeAttached({ timeout: 20_000 })
  await expect(yours.first().locator('.spk-crest')).toHaveAttribute('data-tenure', '12m')
  await expect(yours.first().locator('.spk-name')).toHaveText('you')
  await expect(yours.first().locator('img.spk-kit-emote')).toHaveAttribute('src', 'https://cdn.7tv.app/emote/01GAFTZ9K80003DHH026MC7JW0/2x.webp')
  await page.mouse.move(5, 5)
  await page.waitForTimeout(1600)
  await capture(card, info, 'ext-card-anatomy-rest.png')

  // Hover brings your line in last and freezes chat; no labels are drawn over it.
  await card.hover()
  await expect(stage.locator('.spk-callouts, .spk-co')).toHaveCount(0)
  await expect(stage.locator('.spk-cl').last()).toHaveClass(/spk-sup/)
  const frozen = await stage.locator('.spk-cl').count()
  await page.waitForTimeout(900)
  await capture(card, info, 'ext-card-anatomy-hover.png')
  await page.waitForTimeout(1700)
  expect(await stage.locator('.spk-cl').count()).toBe(frozen)
  await expect(stage.locator('.spk-cl').last()).toHaveClass(/spk-sup/)
  await page.mouse.move(5, 5)

  // A peak (the lab's timer: 10 s in): three quick lines, then yours.
  await expect(stage).toHaveAttribute('data-peaks', '1', { timeout: 15_000 })
  await expect(stage.locator('.spk-cl.spk-sup', { hasText: 'that peak was mine' }).last()).toBeAttached()
  await expect(stage.locator('.spk-callouts, .spk-co')).toHaveCount(0)
  await page.waitForTimeout(500)
  await capture(card, info, 'ext-card-anatomy-peak.png')
  await expectCannedChat(stage)
  expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)

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

  // Reduced motion: one still frame from static images, ending on your line.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(stage).toHaveAttribute('data-still', 'true')
  await expect(stage).toHaveAttribute('data-running', 'false')
  await expect(stage.locator('.spk-cl.spk-sup').last()).toBeAttached()
  for (const src of await stage.locator('img[src*="cdn.7tv.app"]').evaluateAll(images => images.map(image => (image as HTMLImageElement).src))) expect(src).toMatch(/\/2x_static\.webp$/)
  await imagesSettled(stage)
  await capture(card, info, 'ext-card-anatomy-still.png')
})

test('quick settings: Supporters get Tenure Climb up to their own crest, in their paint', async ({ extension, prepare }, info) => {
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
  await expect(stage).toHaveAttribute('data-mode', 'tenure')
  await expect(card.locator('.pulse-supporter-cta-head')).toHaveText('Pulse SupporterManage Supporter ›')
  await expect(card.locator('small')).toHaveText('A crest that levels up the longer you support. Only you see it. Core tools stay free.')

  // The climb: First signal, Signal set, Steady signal, Year-one crest, then it holds there.
  // A chip a wide emote would reach keeps only its length ("12 mo").
  const chips = new Set<string>()
  await expect.poll(async () => {
    for (const text of await stage.locator('.spk-chip').allTextContents()) chips.add(text)
    return chips.has('Year-one crest · 12 mo') || chips.has('12 mo')
  }, { timeout: 40_000, intervals: [200] }).toBe(true)
  expect([...chips].every(text => ['First signal · New', 'Signal set · 3 mo', 'Steady signal · 6 mo', 'Year-one crest · 12 mo', 'New', '3 mo', '6 mo', '12 mo'].includes(text))).toBe(true)
  // The chip never covers the emote that ends the line.
  const [emoteBox, chipBox] = await Promise.all([stage.locator('.spk-cl.spk-sup').last().locator('img.spk-kit-emote').boundingBox(), stage.locator('.spk-cl.spk-sup').last().locator('.spk-chip').boundingBox()])
  expect(chipBox!.x).toBeGreaterThanOrEqual(emoteBox!.x + emoteBox!.width - 4)
  const mine = stage.locator('.spk-cl.spk-sup').last()
  await expect(mine.locator('img.spk-kit-emote')).toHaveAttribute('src', 'https://cdn.7tv.app/emote/01GAFTZ9K80003DHH026MC7JW0/2x.webp')
  await expect(mine.locator('.spk-name')).toHaveAttribute('data-finish', 'etched')
  await page.mouse.move(5, 5)
  await page.waitForTimeout(700)
  await capture(card, info, 'ext-card-tenure-rest.png')
  // Hover brings your next line right away.
  // Counting lines would not do: the stack keeps a few, so a new line can push an old one of yours out.
  await stage.locator('.spk-cl.spk-sup').evaluateAll(lines => lines.forEach(line => line.setAttribute('data-seen', '')))
  await card.hover()
  await expect.poll(() => stage.locator('.spk-cl.spk-sup:not([data-seen])').count(), { timeout: 1_000, intervals: [50] }).toBeGreaterThan(0)
  await page.waitForTimeout(700)
  await capture(card, info, 'ext-card-tenure-hover.png')
  await expectCannedChat(stage)
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
  await expect(banner.locator('.pulse-settings-supporter-perk')).toHaveText(['Title paint', 'Tenure crest', 'Emote rain'])
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
  await expect(banner.locator('.pulse-settings-supporter-perk')).toHaveText(['Halo paint', 'Year-one crest', 'Emote rain'])
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
