import { test as base, expect } from '@playwright/test'
import { closeExtensionContext, launchExtensionContext, seedExtensionStorage, type LaunchedExtension } from '../helpers/extensionContext.ts'
import { installMockApi } from '../helpers/mockApi.ts'
import { linkDevice, LINKED_DEVICE, supporterBody } from '../helpers/supporterMembership.ts'
import {
  BADGE_LIST_URL,
  CHAT_URL,
  decorations,
  evidencePath,
  registeredChatScripts,
  serveBadgeList,
  serveChatPage,
  setViewerSetting,
  type BadgeListServer,
} from '../helpers/chatBadges.ts'
import { FIXTURE_LIST, FIXTURE_PEOPLE, chatLine, type ChatFixtureStyle } from '../../fixtures/chat-badges/chatMarkup.ts'
import type { Entry } from '../../helpers/chatBadgeSigner.ts'

/**
 * Seen in chat, packaged: the worker downloads and verifies the signed
 * Supporter list, registers the separate content/chat-badges.js chunk for
 * Twitch, and the chunk adds crests and paint to chat lines in each chat
 * style (Twitch native, BTTV, FFZ, 7TV) at the ~340 px chat column.
 *
 * Run headless with the chromium channel (PULSE_EXTENSION_HEADLESS=1,
 * PULSE_EXTENSION_BROWSER_CHANNEL=chromium). PULSE_CHAT_BADGES_EVIDENCE_DIR
 * names a folder for the screenshots.
 *
 * The opt-in journey needs a PULSE_EXTENSION_TWITCH_SIGNIN=tester build (the
 * Twitch window is replaced by a stub in the worker; nothing reaches Twitch).
 */
const STAGE = process.env.PULSE_EXTENSION_TWITCH_SIGNIN === 'tester' || process.env.PULSE_EXTENSION_TWITCH_SIGNIN === 'public' ? 'on' : 'off'
const API = 'https://api.streampulse.stream'
const STYLES: ChatFixtureStyle[] = ['native', 'bttv', 'ffz', '7tv']
const LISTED = new Set(FIXTURE_LIST.map(entry => entry[1]))

type Fixtures = { extension: LaunchedExtension; list: BadgeListServer; style: { current: ChatFixtureStyle; theme: 'dark' | 'light'; lines?: string } }

const test = base.extend<Fixtures>({
  extension: async ({}, use) => {
    const launched = await launchExtensionContext({ viewport: { width: 760, height: 640 } })
    await use(launched)
    await closeExtensionContext(launched)
  },
  style: async ({}, use) => { await use({ current: 'native', theme: 'dark' }) },
  // Auto: every test gets the mocked API and Twitch, so nothing reaches the real ones.
  list: [async ({ extension, style }, use) => {
    const api = await installMockApi(extension.context, 'live-ready')
    // Registered after the catch-all API mock, so these win.
    const list = await serveBadgeList(extension.context, FIXTURE_LIST as Entry[])
    await serveChatPage(extension.context, () => style.current, () => ({ width: 340, theme: style.theme, lines: style.lines }))
    await seedExtensionStorage(extension.serviceWorker)
    await use(list)
    await api.dispose()
  }, { auto: true }],
})

async function openChat(extension: LaunchedExtension) {
  const page = extension.page
  await page.goto(CHAT_URL, { waitUntil: 'load' })
  return page
}

async function expectDecorated(page: import('@playwright/test').Page, count: number) {
  await expect.poll(async () => (await decorations(page)).crests, { timeout: 20_000 }).toBe(count)
}

test.describe('Seen in chat: crests in each chat style', () => {
  for (const chat of STYLES) {
    test(`${chat}: listed Supporters get a crest and paint, nobody else; new lines are decorated as they arrive`, async ({ extension, list, style }, testInfo) => {
      style.current = chat
      const page = await openChat(extension)
      await expectDecorated(page, FIXTURE_LIST.length)
      const seen = await decorations(page)
      expect(seen.style).toBe(true)
      for (const line of seen.byLine) {
        const person = FIXTURE_PEOPLE.find(candidate => (candidate.display ?? candidate.login) === line.name)!
        if (LISTED.has(person.login)) {
          const entry = FIXTURE_LIST.find(candidate => candidate[1] === person.login)!
          expect(line.crest, person.login).toBe(String(entry[2]))
          // paint 0 = no finish equipped: crest only.
          expect(line.paint, person.login).toBe(entry[3] === 0 ? null : String(entry[3]))
        } else {
          expect(line, person.login).toMatchObject({ crest: null, paint: null })
        }
      }
      expect(seen.byLine[0].label).toBe('StreamPulse Supporter, 12 months')
      // The list request carries nothing about the viewer or the page.
      expect(list.requests.length).toBeGreaterThanOrEqual(1)
      for (const request of list.requests) {
        expect(new URL(request.url()).search).toBe('')
        const headers = request.headers()
        expect(headers.authorization).toBeUndefined()
        expect(headers.cookie).toBeUndefined()
        expect(headers.referer).toBeUndefined()
        expect(request.method()).toBe('GET')
      }
      expect(await registeredChatScripts(extension.serviceWorker)).toContain('pulse-chat-badges')
      await page.locator('.chat-column').screenshot({ path: evidencePath(testInfo, `chat-badges-${chat}-dark-340.png`) })

      // Live chat: 40 more lines, a quarter from listed Supporters.
      const more = Array.from({ length: 40 }, (_, i) => chatLine(chat, i % 4 === 0
        ? { login: 'crest_glass', display: 'Crest_Glass', id: '10000001', text: `line ${i}` }
        : { login: `viewer_${i}`, display: `Viewer_${i}`, id: String(20000000 + i), text: `line ${i}` })).join('')
      await page.evaluate(html => {
        const container = document.querySelector('.seventv-chat-list') ?? document.querySelector('[data-test-selector="chat-scrollable-area__message-container"]')!
        const holder = document.createElement('div')
        holder.innerHTML = html
        for (const node of [...holder.children]) container.append(node)
      }, more)
      await expectDecorated(page, FIXTURE_LIST.length + 10)
    })
  }

  test('light theme: darker paint stops, same placement', async ({ extension, style }, testInfo) => {
    style.theme = 'light'
    const page = await openChat(extension)
    await expectDecorated(page, FIXTURE_LIST.length)
    const fill = await page.evaluate(() => getComputedStyle(document.querySelector('[data-sp-paint="1"]')!).getPropertyValue('--sp-a').trim())
    expect(fill).toBe('#0e7490')
    await page.locator('.chat-column').screenshot({ path: evidencePath(testInfo, 'chat-badges-native-light-340.png') })
  })
})

test.describe('Seen in chat: viewer setting, kill switch and motion', () => {
  test('turning crests off removes every crest, the stylesheet and the registration, and stops downloads; on brings them back', async ({ extension, list }) => {
    const page = await openChat(extension)
    await expectDecorated(page, FIXTURE_LIST.length)
    await setViewerSetting(extension.serviceWorker, { chatSupporterCrestsEnabled: false })
    await expect.poll(async () => decorations(page)).toMatchObject({ style: false, crests: 0, painted: 0 })
    await expect.poll(() => registeredChatScripts(extension.serviceWorker)).toEqual([])
    expect(await page.evaluate(() => document.querySelectorAll('[data-sp-wave], .sp-cb-crest').length)).toBe(0)
    const before = list.requests.length
    await page.reload({ waitUntil: 'load' })
    await page.waitForTimeout(1_500)
    expect(list.requests.length).toBe(before)
    expect((await decorations(page)).crests).toBe(0)

    await setViewerSetting(extension.serviceWorker, { chatSupporterCrestsEnabled: true })
    await expectDecorated(page, FIXTURE_LIST.length)
  })

  test('404 from the list (feature off on the server) injects nothing', async ({ extension, list }) => {
    list.set({ status: 404 })
    const page = await openChat(extension)
    await expect.poll(() => list.requests.length).toBeGreaterThanOrEqual(1)
    await page.waitForTimeout(1_500)
    expect(await decorations(page)).toMatchObject({ style: false, crests: 0, painted: 0 })
    expect(await registeredChatScripts(extension.serviceWorker)).toEqual([])
  })

  test('a list signed with an unpinned key is refused: nothing injected', async ({ extension, list }) => {
    void list
    const { signList, makeDoc } = await import('../../helpers/chatBadgeSigner.ts')
    await extension.context.route(`${BADGE_LIST_URL}*`, route => route.fulfill({
      status: 200,
      body: signList(makeDoc(FIXTURE_LIST as Entry[], { env: 'sandbox' }), { seed: Buffer.alloc(32, 9) }),
    }))
    const page = await openChat(extension)
    await page.waitForTimeout(2_000)
    expect(await decorations(page)).toMatchObject({ style: false, crests: 0 })
    expect(await registeredChatScripts(extension.serviceWorker)).toEqual([])
  })

  test('still by default; Animate paints adds only the slow Aurora drift; reduced motion stops it', async ({ extension }) => {
    const page = await openChat(extension)
    await expectDecorated(page, FIXTURE_LIST.length)
    const running = () => page.evaluate(() => document.getAnimations().map(animation => (animation as CSSAnimation).animationName ?? ''))
    expect(await running()).toEqual([])
    await setViewerSetting(extension.serviceWorker, { chatSupporterPaintMotion: true })
    // crest_halo wears the Aurora wave: the only painted name that may move.
    await expect.poll(running).toEqual(['sp-cb-drift'])
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect.poll(running).toEqual([])
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect.poll(running).toEqual(['sp-cb-drift'])
    await setViewerSetting(extension.serviceWorker, { chatSupporterPaintMotion: false })
    await expect.poll(running).toEqual([])
  })

  test('the viewer settings appear in Appearance & placement once a list has arrived', async ({ extension }) => {
    const page = await openChat(extension)
    await expectDecorated(page, FIXTURE_LIST.length)
    await page.goto(`chrome-extension://${extension.extensionId}/options/index.html#pulse`)
    const crests = page.getByRole('checkbox', { name: 'Show Supporter crests in chat' })
    await expect(crests).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Animate paints in chat' })).not.toBeChecked()
  })
})

test.describe('Seen in chat: your own entry', () => {
  const OWN: Entry = ['10000099', 'my_login', 2, 3, 1]

  test('consent panel → Twitch check → on: your crest shows at once; Turn off: gone at once', async ({ extension, list, style }, testInfo) => {
    test.skip(STAGE === 'off', 'needs a PULSE_EXTENSION_TWITCH_SIGNIN=tester build (the Twitch check)')
    style.lines = [...FIXTURE_PEOPLE, { login: 'my_login', display: 'My_Login', id: OWN[0], text: 'that one is me' }].map(person => chatLine('native', person)).join('')
    let state: 'off' | 'on' = 'off'
    const posts: Array<{ path: string; body: unknown; authorization?: string }> = []
    await linkDevice(extension.serviceWorker)
    await extension.context.route(`${API}/v1/billing/supporter`, route => route.fulfill({
      json: { ...supporterBody('active', 7, { enabled: true, finish: 'halo' }), accountKind: 'twitch', chatBadge: state === 'on' ? { available: true, state: 'on', login: 'my_login', wave: 'ripple', consentVersion: 1 } : { available: true, state: 'off' } },
    }))
    const flowId = 'f'.repeat(32)
    await extension.context.route(`${API}/v1/account/auth/twitch/start-device`, route => {
      posts.push({ path: 'start-device', body: route.request().postDataJSON(), authorization: route.request().headers().authorization })
      const redirect = `https://${extension.extensionId}.chromiumapp.org/`
      return route.fulfill({ status: 201, json: { flowId, flowSecret: 'e'.repeat(64), authorizeUrl: `https://id.twitch.tv/oauth2/authorize?response_type=id_token&client_id=x&state=${flowId}&nonce=n&redirect_uri=${encodeURIComponent(redirect)}` } })
    })
    await extension.context.route(`${API}/v1/account/auth/twitch/badge`, route => {
      posts.push({ path: 'badge', body: route.request().postDataJSON(), authorization: route.request().headers().authorization })
      state = 'on'
      return route.fulfill({ json: { status: 'badge_on', stepUpExpiresAt: new Date(Date.now() + 600_000).toISOString(), chatBadge: { available: true, state: 'on', login: 'my_login', wave: 'ripple', consentVersion: 1 }, own: OWN } })
    })
    await extension.context.route(`${API}/v1/billing/badge`, route => {
      posts.push({ path: 'billing/badge', body: route.request().postDataJSON(), authorization: route.request().headers().authorization })
      state = 'off'
      return route.fulfill({ json: { status: 'off' } })
    })
    // The Twitch window, stubbed in the worker: it answers with the flow's own state.
    await extension.serviceWorker.evaluate(() => {
      chrome.identity.launchWebAuthFlow = (async (details: { url: string }) => {
        const url = new URL(details.url)
        return `${url.searchParams.get('redirect_uri')}#state=${url.searchParams.get('state')}&id_token=aaa.bbb.ccc`
      }) as typeof chrome.identity.launchWebAuthFlow
    })

    const chat = await openChat(extension)
    await expectDecorated(chat, FIXTURE_LIST.length)
    const ownCrest = () => chat.evaluate(() => document.querySelector('[data-a-user="my_login"] .sp-cb-crest') !== null)
    expect(await ownCrest()).toBe(false)

    const options = await extension.context.newPage()
    await options.goto(`chrome-extension://${extension.extensionId}/options/index.html#supporter`)
    const card = options.locator('.pulse-chat-badge')
    await expect(card).toHaveAttribute('data-chat-badge-state', 'off')
    await card.getByRole('switch').click()
    const consent = card.locator('[data-chat-badge-consent="1"]')
    await expect(consent).toContainText('Anyone can download this list.')
    expect(posts).toEqual([])
    await options.screenshot({ path: evidencePath(testInfo, 'chat-badges-consent.png'), fullPage: true })
    await consent.getByRole('button', { name: 'Continue with Twitch and turn on' }).click()
    await expect(card.getByRole('switch')).toBeChecked()
    await expect(card).toContainText('next to @my_login in chat')
    expect(posts.map(post => post.path)).toEqual(['start-device', 'badge'])
    expect(posts[0].body).toMatchObject({ purpose: 'badge', mode: 'interactive' })
    expect(posts[1].body).toMatchObject({ flowId, idToken: 'aaa.bbb.ccc', badge: { consentVersion: 1 } })
    expect(posts.every(post => post.authorization === `Bearer ${LINKED_DEVICE.token}`)).toBe(true)
    // Your own extension shows your crest at once, before any list refresh.
    await expect.poll(ownCrest).toBe(true)
    await options.screenshot({ path: evidencePath(testInfo, 'chat-badges-on.png'), fullPage: true })

    await card.getByRole('button', { name: 'Turn off' }).click()
    await expect(card.getByRole('switch')).not.toBeChecked()
    expect(posts.at(-1)).toMatchObject({ path: 'billing/badge', body: { enabled: false } })
    await expect.poll(ownCrest).toBe(false)
    expect(list.requests.length).toBe(1)
  })
})
