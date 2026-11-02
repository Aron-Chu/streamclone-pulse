// Opt-in local proof only: PULSE_FIREFOX_CONSENT_E2E=1, EXTENSION_TARGET=firefox.
// Requires a freshly built Firefox dist, Firefox and geckodriver. Never uses a
// user profile, an actual PostHog endpoint, or the production extension ID.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { build, loadConfigFromFile } from 'vite'
import { Builder, By, until } from 'selenium-webdriver'
import firefox from 'selenium-webdriver/firefox.js'

if (process.env.PULSE_FIREFOX_CONSENT_E2E !== '1' || process.env.EXTENSION_TARGET !== 'firefox') {
  throw new Error('Explicitly opt in and select EXTENSION_TARGET=firefox')
}
const root = process.cwd()
const addonId = 'sp64-analytics-consent-test@invalid'
const consentKey = 'pulse-analytics-consent-v1'
const probeKey = '__test_analytics_probe'
const legacy = process.argv.includes('--legacy')
const disabled = process.argv.includes('--disabled')
const localBackend = process.argv.includes('--backend')
const crossPage = process.argv.includes('--cross-page')
const lifecycle = process.argv.includes('--lifecycle')
if ([legacy, disabled, localBackend, crossPage, lifecycle].filter(Boolean).length > 1) throw new Error('Choose one test variant')
let backendUrl
const fixtureNonce = process.env.PULSE_ANALYTICS_LOCAL_E2E_NONCE
if (localBackend) {
  backendUrl = new URL(process.env.PULSE_ANALYTICS_LOCAL_E2E_URL || '')
  if (backendUrl.protocol !== 'http:' || backendUrl.hostname !== '127.0.0.1' || !backendUrl.port ||
      backendUrl.username || backendUrl.password || backendUrl.pathname !== '/' || backendUrl.search || backendUrl.hash) {
    throw new Error('Integration backend must be an explicit loopback HTTP origin')
  }
  if (!fixtureNonce || !/^[0-9a-f-]{36}$/i.test(fixtureNonce)) throw new Error('Missing loopback fixture nonce')
}
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sp64-firefox-consent-'))
let driver
let installedAddon

async function removeTestDirectory(target) {
  const base = await fs.realpath(os.tmpdir())
  const actual = await fs.realpath(target)
  const normalized = value => process.platform === 'win32' ? path.normalize(value).toLowerCase() : path.normalize(value)
  if (normalized(path.dirname(actual)) !== normalized(base) || !path.basename(actual).startsWith('sp64-firefox-consent-')) {
    throw new Error('Refusing to remove a directory outside the isolated test root')
  }
  await fs.rm(actual, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

async function makeTestExtension(destination) {
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'dist/extension-target.json'), 'utf8'))
  assert.equal(metadata.target, 'firefox', 'Build the Firefox target first')
  await fs.cp(path.join(root, 'dist'), destination, { recursive: true })
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(root, 'vite.config.ts'))
  if (!loaded) throw new Error('Missing Vite configuration')
  let switched = false
  let backendSwitched = !localBackend
  let legacyApplied = !legacy
  const plugin = {
    name: 'test-only-firefox-analytics',
    enforce: 'pre',
    transform(code, id) {
      const file = id.replaceAll('\\', '/')
      if (file.endsWith('/src/shared/firefoxDataConsent.ts') && legacy) {
        const boundary = '  if (!permissions?.request) return false\n  try {'
        if (!code.includes(boundary)) throw new Error('Expected Firefox permission boundary')
        legacyApplied = true
        return code.replace(boundary, '  if (!permissions?.request) return false\n  if (await hasFirefoxTechnicalDataConsent({ target: \'firefox\', permissions })) return true\n  try {')
      }
      if (localBackend && file.endsWith('/src/shared/storage.ts')) {
        const original = "export const DEFAULT_BACKEND_URL = 'https://api.streampulse.stream'"
        if (!code.includes(original)) throw new Error('Expected store backend boundary')
        backendSwitched = true
        return code.replace(original, `export const DEFAULT_BACKEND_URL = ${JSON.stringify(backendUrl.origin)}`)
      }
      if (!file.endsWith('/src/shared/extensionAnalytics.ts')) return
      const original = 'export const EXTENSION_ANALYTICS_INGEST_ENABLED = false'
      if (!code.includes(original)) throw new Error('Expected disabled analytics switch')
      switched = true
      if (disabled) return code
      const enabled = code.replace(original, 'export const EXTENSION_ANALYTICS_INGEST_ENABLED = true')
      if (localBackend) return enabled
      const start = enabled.indexOf('async function defaultTransport(')
      const end = enabled.indexOf('/**\n * Emit allowlisted', start)
      if (start < 0 || end < 0) throw new Error('Expected analytics transport boundary')
      const mock = `
async function defaultTransport(body: { events: Array<{ name: AnalyticsEmitEventName }> }, signal: AbortSignal): Promise<void> {
  const key = '__test_analytics_probe'
  const previous = (await chrome.storage.local.get(key))[key] as { calls?: Array<{ body: unknown; aborted: boolean }> } | undefined
  const calls = [...(previous?.calls ?? []), { body, aborted: false }]
  await chrome.storage.local.set({ [key]: { calls } })
  await new Promise<void>(resolve => {
    if (signal.aborted) { resolve(); return }
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
  calls[calls.length - 1].aborted = true
  await chrome.storage.local.set({ [key]: { calls } })
}

`
      return enabled.slice(0, start) + mock + enabled.slice(end)
    },
  }
  const config = loaded.config
  const plugins = (config.plugins ?? []).flat(Infinity).filter(item => item && typeof item === 'object' && item.name !== 'streamclone-pulse-extension')
  const output = await build({
    ...config, root, configFile: false, logLevel: 'silent', plugins: [plugin, ...plugins],
    build: { ...config.build, write: false, emptyOutDir: false },
  })
  assert.ok(switched && backendSwitched && legacyApplied, 'Test transforms did not run')
  for (const result of Array.isArray(output) ? output : [output]) {
    if (!('output' in result)) throw new Error('Unexpected watch build')
    for (const item of result.output) {
      const target = path.resolve(destination, item.fileName)
      if (!target.startsWith(`${path.resolve(destination)}${path.sep}`)) throw new Error('Output escapes test extension')
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, item.type === 'chunk' ? item.code : item.source)
    }
  }
  const manifestPath = path.join(destination, 'manifest.json')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  manifest.name = 'TEST ONLY - Firefox analytics consent'
  manifest.browser_specific_settings.gecko.id = addonId
  if (!disabled) manifest.browser_specific_settings.gecko.data_collection_permissions.optional = ['technicalAndInteraction']
  manifest.host_permissions = localBackend ? ['http://127.0.0.1/*'] : []
  manifest.optional_host_permissions = []
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  await fs.writeFile(path.join(destination, 'consent-lifecycle-probe.html'), '<!doctype html><title>Test-only consent probe</title>')
}

async function contentScript(script, ...args) {
  await driver.setContext(firefox.Context.CONTENT)
  return driver.executeAsyncScript(`const done = arguments[arguments.length - 1]; Promise.resolve((async () => { ${script} })()).then(done, e => done({ testError: String(e) }));`, ...args)
}

async function notificationState() {
  await driver.setContext(firefox.Context.CHROME)
  try {
    return await driver.executeScript(`
      const notifications = [...(PopupNotifications._currentNotifications || [])];
      return { ids: notifications.map(n => n.id),
        nodes: [...document.querySelectorAll('popupnotification')].filter(n => !n.hidden).map(n => ({ id: n.id, label: n.getAttribute('label') })) };
    `)
  } finally {
    await driver.setContext(firefox.Context.CONTENT)
  }
}

async function decidePermission(allow) {
  await driver.setContext(firefox.Context.CHROME)
  try {
    const result = await driver.executeScript(`
      const node = document.getElementById('addon-webext-permissions-notification');
      const button = arguments[0] ? node?.button : node?.secondaryButton;
      if (!button) return { clicked: false, hasNode: !!node, hasPrimary: !!node?.button, hasSecondary: !!node?.secondaryButton };
      const label = button.label || button.getAttribute('label');
      button.click();
      return { clicked: true, label };
    `, allow)
    assert.equal(result.clicked, true, `Firefox permission button missing: ${JSON.stringify(result)}`)
    return result.label
  } finally {
    await driver.setContext(firefox.Context.CONTENT)
  }
}

async function waitForPermissionPrompt() {
  let state
  for (let i = 0; i < 40; i++) {
    state = await notificationState()
    if (state.ids.includes('addon-webext-permissions')) return state
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return state
}

async function storageValue(key) {
  return contentScript('return (await chrome.storage.local.get(arguments[0]))[arguments[0]] ?? null', key)
}

async function backendCounts() {
  if (!backendUrl) throw new Error('Missing loopback backend')
  const response = await fetch(new URL('/__test/accepted', backendUrl))
  if (!response.ok) throw new Error(`Loopback test status ${response.status}`)
  const state = await response.json()
  if (state.fixture !== 'streampulse-analytics-local-e2e' || state.nonce !== fixtureNonce) {
    throw new Error('Wrong loopback fixture')
  }
  return { accepted: state.accepted, attempted: state.attempted }
}

try {
  if (localBackend) assert.deepEqual(await backendCounts(), { accepted: 0, attempted: 0 })
  const extension = path.join(directory, 'TEST-ONLY-extension')
  await makeTestExtension(extension)
  const profile = path.join(directory, 'profile')
  await fs.mkdir(profile)
  const binary = process.env.FIREFOX_BINARY || 'C:/Program Files/Mozilla Firefox/firefox.exe'
  const options = new firefox.Options().setBinary(binary).addArguments('-headless', '-profile', profile).windowSize({ width: 1280, height: 900 })
    .setPageLoadStrategy('none')
    .setPreference('browser.shell.checkDefaultBrowser', false)
    .setPreference('browser.startup.page', 0)
    .setPreference('network.proxy.type', 1)
    .setPreference('network.proxy.http', '127.0.0.1')
    .setPreference('network.proxy.http_port', 9)
    .setPreference('network.proxy.ssl', '127.0.0.1')
    .setPreference('network.proxy.ssl_port', 9)
    .setPreference('network.proxy.no_proxies_on', localBackend ? '127.0.0.1' : '')
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options)
    .setFirefoxService(new firefox.ServiceBuilder().addArguments('--allow-system-access')).build()
  await driver.manage().setTimeouts({ pageLoad: 20000, script: 10000 })
  console.log('Isolated Firefox started')
  installedAddon = await driver.installAddon(extension, true)
  assert.equal(installedAddon, addonId)
  console.log('Temporary test-only add-on installed')
  await driver.setContext(firefox.Context.CHROME)
  const host = await driver.executeScript('return WebExtensionPolicy.getByID(arguments[0])?.mozExtensionHostname || null', addonId)
  assert.ok(host, 'Missing isolated extension hostname')
  await driver.setContext(firefox.Context.CONTENT)
  await driver.get(`moz-extension://${host}/options/index.html#privacy`)
  console.log('Opening test-only settings')
  await driver.wait(until.elementLocated(By.css('[data-settings-section="privacy"]')), 20000)
  assert.equal(await contentScript('return chrome.runtime.getManifest().name'), 'TEST ONLY - Firefox analytics consent')
  if (disabled) {
    const controls = await driver.findElements(By.xpath('//label[normalize-space(.)="Share anonymous product usage"]'))
    assert.equal(controls.length, 0, 'Disabled build must hide analytics control')
    const result = await contentScript('return chrome.runtime.sendMessage({ type: "SET_ANALYTICS_CONSENT", granted: true })')
    assert.deepEqual(result, { ok: false, error: 'analytics_disabled' })
    assert.equal(await storageValue(consentKey), null)
    const manifest = await contentScript('return chrome.runtime.getManifest()')
    assert.ok(!manifest.browser_specific_settings.gecko.data_collection_permissions.optional?.includes('technicalAndInteraction'))
    console.log(JSON.stringify({ ok: true, variant: 'disabled', controlHidden: true, grantRejected: true, optionalDeclarationAbsent: true }))
  } else {
    await contentScript('return chrome.permissions.remove({ data_collection: ["technicalAndInteraction"] })')
    const before = await contentScript('return chrome.permissions.getAll()')
    assert.ok(!before.data_collection?.includes('technicalAndInteraction'), 'Test requires permission initially absent')
    const toggle = await driver.findElement(By.xpath('//label[normalize-space(.)="Share anonymous product usage"]/../../input'))
    assert.equal(await toggle.isSelected(), false)
    await driver.wait(async () => toggle.isEnabled(), 10000, 'Grant preparation did not complete')
    const descriptionId = await toggle.getAttribute('aria-describedby')
    assert.ok(descriptionId, 'Analytics control needs an accessible description')
    const description = await driver.findElement(By.id(descriptionId)).getText()
    assert.match(description, /Pulse receives data without a reported error and when a panel rendering error is shown/)
    assert.match(description, /aggregate counts to PostHog/)
    assert.match(description, /stops new events from this browser/)
    assert.match(description, /Events already sent to StreamPulse may still be added to totals sent to PostHog; those totals remain until they expire/)
    await contentScript('return chrome.runtime.sendMessage({ type: "EMIT_EXTENSION_ANALYTICS", name: "pulse_load_completed" })')
    await new Promise(resolve => setTimeout(resolve, 250))
    if (localBackend) assert.deepEqual(await backendCounts(), { accepted: 0, attempted: 0 }, 'A backend request occurred before consent')
    else assert.equal(await storageValue(probeKey), null, 'An event was emitted before consent')
    let firstPage
    if (crossPage) {
      firstPage = await driver.getWindowHandle()
      await driver.switchTo().newWindow('tab')
      await driver.get(`moz-extension://${host}/options/index.html#privacy`)
      await driver.wait(until.elementLocated(By.css('[data-settings-section="privacy"]')), 20000)
      await contentScript(`
        void (async () => {
          for (let i = 0; i < 200; i++) {
            if ((await chrome.storage.local.get('__test_cross_page_go')).__test_cross_page_go) {
              const result = await chrome.runtime.sendMessage({ type: 'SET_ANALYTICS_CONSENT', granted: false })
              await chrome.storage.local.set({ __test_cross_page_result: result })
              return
            }
            await new Promise(resolve => setTimeout(resolve, 50))
          }
        })()
        return true
      `)
      await driver.switchTo().window(firstPage)
    }
    await toggle.click()
    const firstPrompt = await waitForPermissionPrompt()
    if (legacy) {
      assert.ok(!firstPrompt.ids.includes('addon-webext-permissions'), 'Legacy helper unexpectedly showed a permission prompt')
      await driver.wait(async () => !(await toggle.isSelected()), 10000, 'Legacy grant did not revert')
      assert.equal(await storageValue(consentKey), null)
      console.log(JSON.stringify({ ok: true, variant: 'legacy', promptShown: false, grantStored: false }))
    } else if (crossPage) {
      assert.ok(firstPrompt.ids.includes('addon-webext-permissions'), 'Expected Firefox permission prompt')
      await contentScript('await chrome.storage.local.set({ __test_cross_page_go: true })')
      await driver.wait(async () => (await storageValue('__test_cross_page_result')) !== null, 10000, 'Second settings page did not withdraw')
      const withdrawal = await storageValue('__test_cross_page_result')
      assert.deepEqual(withdrawal, { ok: true })
      assert.ok((await waitForPermissionPrompt()).ids.includes('addon-webext-permissions'), 'Expected the original prompt to remain open')
      const allowedButton = await decidePermission(true)
      await driver.wait(async () => !(await toggle.isSelected()) && await toggle.isEnabled(), 10000, 'Superseded grant did not revert')
      assert.equal(await storageValue(consentKey), null, 'Earlier prompt restored a withdrawn grant')
      await contentScript('return chrome.runtime.sendMessage({ type: "EMIT_EXTENSION_ANALYTICS", name: "pulse_load_completed" })')
      await new Promise(resolve => setTimeout(resolve, 250))
      assert.equal(await storageValue(probeKey), null, 'Superseded grant sent an event')
      await toggle.click()
      await driver.wait(async () => (await storageValue(consentKey))?.granted === true, 10000, 'A new grant after withdrawal failed')
      const capabilities = await driver.getCapabilities()
      console.log(JSON.stringify({ ok: true, variant: 'cross-page', browserVersion: capabilities.get('browserVersion'), allowedButton, withdrawalSupersededPrompt: true, noEventWithinMs: 250, newGrantSucceeded: true }))
    } else if (lifecycle) {
      assert.ok(firstPrompt.ids.includes('addon-webext-permissions'), 'Expected Firefox permission prompt')
      const allowedButton = await decidePermission(true)
      await driver.wait(async () => (await storageValue(consentKey))?.granted === true, 10000, 'Allowed grant was not stored')
      await toggle.click()
      await driver.wait(async () => (await storageValue(consentKey)) === null, 10000, 'Toggle withdrawal did not clear the grant')

      // Leave the Settings UI before preparing the lifecycle ticket, so it
      // cannot start additional grant flows when local consent changes.
      await driver.get(`moz-extension://${host}/consent-lifecycle-probe.html`)
      await driver.wait(until.titleIs('Test-only consent probe'), 10000)
      const probePage = await driver.getWindowHandle()
      const prepare = () => contentScript('return chrome.runtime.sendMessage({ type: "PREPARE_ANALYTICS_CONSENT_GRANT" })')
      const grant = ticket => contentScript('return chrome.runtime.sendMessage({ type: "SET_ANALYTICS_CONSENT", granted: true, grantTicket: arguments[0] })', ticket)
      const markBackground = () => contentScript('const bg = await browser.runtime.getBackgroundPage(); bg.__sp64_lifecycle_marker = true; return bg.__sp64_lifecycle_marker')
      const hasMarker = () => contentScript('const bg = await browser.runtime.getBackgroundPage(); return Object.hasOwn(bg, "__sp64_lifecycle_marker")')

      const first = await prepare()
      assert.equal(first.ok, true)
      assert.equal(await markBackground(), true)
      assert.equal(await hasMarker(), true, 'Background marker was not observable before termination')
      await driver.switchTo().newWindow('tab')
      const debugPage = await driver.getWindowHandle()
      await driver.get('about:debugging#/runtime/this-firefox')
      const terminate = By.css('.qa-temporary-extension-terminate-bgscript-button')
      const status = By.css('.qa-extension-backgroundscript-status')
      async function stopBackground() {
        await driver.switchTo().window(debugPage)
        try {
          await driver.wait(until.elementLocated(terminate), 20000, 'Firefox debug control missing')
        } catch (error) {
          const state = await driver.executeScript('return { href: location.href, title: document.title, text: document.body?.innerText?.slice(0, 4000), buttons: [...document.querySelectorAll("button")].map(b => ({ text: b.innerText, className: b.className })) }')
          console.error('Isolated Firefox debugging page:', JSON.stringify(state))
          throw error
        }
        const pageText = await driver.findElement(By.css('body')).getText()
        assert.ok(pageText.includes(addonId) && pageText.includes('TEST ONLY - Firefox analytics consent'), 'Wrong debug target')
        const buttons = await driver.findElements(terminate)
        assert.equal(buttons.length, 1, 'Expected exactly one temporary add-on background control')
        await driver.wait(async () => (await driver.findElement(status).getText()).trim().toLowerCase() === 'running', 10000, 'Firefox did not report the background page running')
        await buttons[0].click()
        await driver.wait(async () => (await driver.findElement(status).getText()).trim().toLowerCase() === 'stopped', 10000, 'Firefox did not report the background page stopped')
        await driver.switchTo().window(probePage)
      }
      await stopBackground()
      assert.equal((await grant(first.grantTicket)).ok, true, 'Ticket did not survive background termination')
      assert.equal(await hasMarker(), false, 'Background JavaScript state survived termination')
      assert.equal((await storageValue(consentKey))?.granted, true)

      const pending = await prepare()
      assert.equal(pending.ok, true)
      assert.deepEqual(await contentScript('return chrome.runtime.sendMessage({ type: "SET_ANALYTICS_CONSENT", granted: false })'), { ok: true })
      assert.equal(await markBackground(), true)
      assert.equal(await hasMarker(), true, 'Second background marker was not observable before termination')
      await stopBackground()
      assert.deepEqual(await grant(pending.grantTicket), { ok: false, error: 'analytics_consent_superseded' })
      assert.equal(await hasMarker(), false, 'Background JavaScript state survived the second termination')
      assert.equal(await storageValue(consentKey), null, 'Stale ticket restored consent')
      await contentScript('return chrome.runtime.sendMessage({ type: "EMIT_EXTENSION_ANALYTICS", name: "pulse_load_completed" })')
      await new Promise(resolve => setTimeout(resolve, 250))
      assert.equal(await storageValue(probeKey), null, 'Stale ticket permitted an event')
      const fresh = await prepare()
      assert.equal(fresh.ok, true)
      assert.equal((await grant(fresh.grantTicket)).ok, true, 'Fresh grant after withdrawal failed')
      const capabilities = await driver.getCapabilities()
      console.log(JSON.stringify({ ok: true, variant: 'lifecycle', browserVersion: capabilities.get('browserVersion'), allowedButton, backgroundStoppedTwice: true, grantSurvivedRestart: true, withdrawalRevokedOldGrant: true, noEventWithinMs: 250, freshGrantSucceeded: true }))
    } else {
      assert.ok(firstPrompt.ids.includes('addon-webext-permissions'), `Expected Firefox permission prompt: ${JSON.stringify(firstPrompt)}`)
      const deniedButton = await decidePermission(false)
      await driver.wait(async () => !(await toggle.isSelected()), 10000, 'Denied grant did not revert')
      assert.equal(await storageValue(consentKey), null)
      let permissions = await contentScript('return chrome.permissions.getAll()')
      assert.ok(!permissions.data_collection?.includes('technicalAndInteraction'))
      if (localBackend) {
        await contentScript('return chrome.runtime.sendMessage({ type: "EMIT_EXTENSION_ANALYTICS", name: "pulse_load_completed" })')
        await new Promise(resolve => setTimeout(resolve, 250))
        assert.deepEqual(await backendCounts(), { accepted: 0, attempted: 0 }, 'A backend request occurred after permission denial')
      }

      await driver.wait(async () => toggle.isEnabled(), 10000, 'Grant was not prepared after denial')
      await toggle.click()
      const secondPrompt = await waitForPermissionPrompt()
      assert.ok(secondPrompt.ids.includes('addon-webext-permissions'), 'Expected prompt on retry')
      const allowedButton = await decidePermission(true)
      await driver.wait(async () => (await storageValue(consentKey))?.granted === true, 10000, 'Allowed grant was not stored')
      permissions = await contentScript('return chrome.permissions.getAll()')
      assert.ok(permissions.data_collection?.includes('technicalAndInteraction'))
      if (localBackend) {
        await contentScript('return chrome.runtime.sendMessage({ type: "EMIT_EXTENSION_ANALYTICS", name: "pulse_load_completed" })')
        await driver.wait(async () => (await backendCounts()).accepted === 1, 10000, 'Consented event did not reach the local backend')
        assert.deepEqual(await backendCounts(), { accepted: 1, attempted: 1 })
        await toggle.click()
        await driver.wait(async () => (await storageValue(consentKey)) === null, 10000, 'Toggle withdrawal did not clear local grant')
        await contentScript('return chrome.runtime.sendMessage({ type: "EMIT_EXTENSION_ANALYTICS", name: "pulse_load_completed" })')
        await new Promise(resolve => setTimeout(resolve, 250))
        assert.deepEqual(await backendCounts(), { accepted: 1, attempted: 1 }, 'A backend request occurred after withdrawal')
        const capabilities = await driver.getCapabilities()
        console.log(JSON.stringify({ ok: true, variant: 'local-backend', browserVersion: capabilities.get('browserVersion'), promptShown: true, deniedButton, allowedButton, denialReverted: true, grantStored: true, requestsBeforeConsent: 0, requestsAfterDenial: 0, consentedRequests: 1, requestsAfterWithdrawalWithinMs: 0, observationMs: 250 }))
      } else {
        await contentScript('return chrome.runtime.sendMessage({ type: "EMIT_EXTENSION_ANALYTICS", name: "pulse_load_completed" })')
        await driver.wait(async () => (await storageValue(probeKey))?.calls?.length === 1, 10000, 'Consented mock event was not sent')
        assert.deepEqual((await storageValue(probeKey)).calls[0].body, { events: [{ name: 'pulse_load_completed' }] })

        // Turning off the separate StreamPulse toggle leaves the browser-level
        // permission alone, but cancels work and denies subsequent sends.
        await toggle.click()
        await driver.wait(async () => (await storageValue(consentKey)) === null, 10000, 'Toggle withdrawal did not clear local grant')
        await driver.wait(async () => (await storageValue(probeKey))?.calls?.[0]?.aborted === true, 10000, 'Toggle withdrawal did not cancel pending mock')
        permissions = await contentScript('return chrome.permissions.getAll()')
        assert.ok(permissions.data_collection?.includes('technicalAndInteraction'))
        await contentScript('return chrome.runtime.sendMessage({ type: "EMIT_EXTENSION_ANALYTICS", name: "pulse_load_completed" })')
        await new Promise(resolve => setTimeout(resolve, 250))
        assert.equal((await storageValue(probeKey)).calls.length, 1)

        // Firefox should grant the already-granted optional permission silently.
        await driver.wait(async () => toggle.isEnabled(), 10000, 'Grant was not prepared after withdrawal')
        await toggle.click()
        await driver.wait(async () => (await storageValue(consentKey))?.granted === true, 10000, 'Re-grant with existing browser permission failed')
        assert.ok(!(await notificationState()).ids.includes('addon-webext-permissions'), 'Already-granted permission unexpectedly prompted')
        await contentScript('return chrome.runtime.sendMessage({ type: "EMIT_EXTENSION_ANALYTICS", name: "pulse_load_completed" })')
        await driver.wait(async () => (await storageValue(probeKey))?.calls?.length === 2, 10000, 'Re-consented mock event was not sent')

        // Revoke the Firefox-owned permission; the real onRemoved listener must
        // deny and cancel the pending mock, and clear the separate local grant.
        const removed = await contentScript('return chrome.permissions.remove({ data_collection: ["technicalAndInteraction"] })')
        assert.equal(removed, true)
        await driver.wait(async () => (await storageValue(consentKey)) === null, 10000, 'Browser withdrawal did not clear local grant')
        await driver.wait(async () => (await storageValue(probeKey))?.calls?.[1]?.aborted === true, 10000, 'Browser withdrawal did not cancel pending mock')
        await driver.wait(async () => !(await toggle.isSelected()), 10000, 'Settings did not reflect browser withdrawal')
        await contentScript('return chrome.runtime.sendMessage({ type: "EMIT_EXTENSION_ANALYTICS", name: "pulse_load_completed" })')
        await new Promise(resolve => setTimeout(resolve, 250))
        assert.equal((await storageValue(probeKey)).calls.length, 2)
        const capabilities = await driver.getCapabilities()
        console.log(JSON.stringify({ ok: true, variant: 'current', browserVersion: capabilities.get('browserVersion'), promptShown: true, deniedButton, allowedButton, denialReverted: true, grantStored: true, toggleWithdrawalCancelled: true, alreadyGrantedReturnedWithoutPrompt: true, mockEvents: 2, permissionRemovalCancelled: true, noFurtherEventWithinMs: 250 }))
      }
    }
  }
} finally {
  if (driver) {
    if (installedAddon) { try { await driver.uninstallAddon(installedAddon) } catch {} }
    try { await driver.quit() } catch {}
  }
  await removeTestDirectory(directory)
}
