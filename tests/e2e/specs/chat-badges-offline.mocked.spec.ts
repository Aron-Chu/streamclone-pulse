import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { chatContainer, chatLine, FIXTURE_LIST, FIXTURE_PEOPLE, type ChatFixtureStyle } from '../../fixtures/chat-badges/chatMarkup.ts'

// This exercises the built decorator in Chromium with mocked extension messages.
// It does not load the extension, contact Twitch, or prove live 7TV compatibility.
test.use({ headless: true })

async function openFixture(page: Page, style: ChatFixtureStyle, sevenTvPaint = false) {
  const person = { ...FIXTURE_PEOPLE[0], sevenTvPaint }
  await page.setContent(chatContainer(style, chatLine(style, person)))
  await page.evaluate(({ entry }) => {
    const storageListeners: Array<(changes: Record<string, { newValue: boolean }>, area: string) => void> = []
    const runtimeListeners: unknown[] = []
    const runtime = {
      id: 'local-fixture',
      sendMessage: async () => ({ type: 'CHAT_BADGES', ver: '1.0', exp: Math.floor(Date.now() / 1000) + 300, u: [entry] }),
      onMessage: { addListener: (callback: unknown) => runtimeListeners.push(callback), removeListener: () => undefined },
    }
    const storage = {
      sync: { get: async () => ({}) },
      onChanged: { addListener: (callback: typeof storageListeners[number]) => storageListeners.push(callback), removeListener: () => undefined },
    }
    Object.defineProperty(window, 'chrome', { value: { runtime, storage }, configurable: true })
    Object.defineProperty(window, '__hideFixtureCrests', {
      value: () => storageListeners.forEach(listener => listener({ chatSupporterCrestsEnabled: { newValue: false } }, 'sync')),
      configurable: true,
    })
  }, { entry: FIXTURE_LIST[0] })
  await page.addScriptTag({ path: resolve(process.cwd(), 'dist/content/chat-badges.js') })
}

test('two mocked viewers see a supporter, and each can hide the decoration', async ({ page, context }) => {
  const second = await context.newPage()
  await openFixture(page, 'native')
  await openFixture(second, '7tv', true)

  await expect(page.locator('.sp-cb-crest')).toHaveCount(1)
  await expect(page.locator('[data-sp-paint="1"]')).toHaveCount(1)
  await expect(second.locator('.sp-cb-crest')).toHaveCount(1)
  await expect(second.locator('.seventv-painted-content')).toHaveCount(1)
  await expect(second.locator('[data-sp-paint]')).toHaveCount(0)

  await page.evaluate(() => (window as unknown as { __hideFixtureCrests: () => void }).__hideFixtureCrests())
  await expect(page.locator('.sp-cb-crest')).toHaveCount(0)
  await expect(second.locator('.sp-cb-crest')).toHaveCount(1)
  await second.evaluate(() => (window as unknown as { __hideFixtureCrests: () => void }).__hideFixtureCrests())
  await expect(second.locator('.sp-cb-crest')).toHaveCount(0)
})
