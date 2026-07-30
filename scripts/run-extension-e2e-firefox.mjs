import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { Builder, By, until } from 'selenium-webdriver'
import firefox from 'selenium-webdriver/firefox.js'

const ADDON_ID = 'streampulse@streampulse.stream'
const EXPECTED_TITLE = 'StreamPulse Settings'
const timeoutMs = 20_000

function parseZipArg(argv) {
  const index = argv.indexOf('--zip')
  if (index >= 0 && argv[index + 1]) return path.resolve(argv[index + 1])
  const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  return path.resolve(`streampulse-extension-firefox-${version}.zip`)
}

function resolveFirefoxBinary() {
  if (process.env.FIREFOX_BINARY) return process.env.FIREFOX_BINARY
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.PROGRAMFILES ?? '', 'Mozilla Firefox', 'firefox.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'Mozilla Firefox', 'firefox.exe'),
    ]
    return candidates.find(candidate => candidate && fs.existsSync(candidate))
  }
  return undefined
}

async function extensionHostname(driver) {
  await driver.setContext(firefox.Context.CHROME)
  try {
    return await driver.executeScript(
      `
      const id = arguments[0]
      const policy = WebExtensionPolicy.getByID(id)
      if (policy?.mozExtensionHostname) return policy.mozExtensionHostname
      const mapping = JSON.parse(Services.prefs.getStringPref('extensions.webextensions.uuids', '{}'))
      return mapping[id] || null
      `,
      ADDON_ID,
    )
  } finally {
    await driver.setContext(firefox.Context.CONTENT)
  }
}

async function runtimeMessage(driver, message) {
  return driver.executeAsyncScript(
    `
    const message = arguments[0]
    const done = arguments[arguments.length - 1]
    Promise.resolve(chrome.runtime.sendMessage(message)).then(done, error => {
      done({ error: String(error) })
    })
    `,
    message,
  )
}

const zipPath = parseZipArg(process.argv.slice(2))
if (!fs.existsSync(zipPath)) {
  throw new Error(`Firefox package not found: ${zipPath}`)
}

const options = new firefox.Options()
  .addArguments('-headless')
  .windowSize({ width: 1280, height: 900 })
  .setPreference('browser.shell.checkDefaultBrowser', false)
  .setPreference('browser.startup.page', 0)

const firefoxBinary = resolveFirefoxBinary()
if (firefoxBinary) options.setBinary(firefoxBinary)

let driver
let installedAddon
try {
  const service = new firefox.ServiceBuilder().addArguments('--allow-system-access')
  driver = await new Builder()
    .forBrowser('firefox')
    .setFirefoxOptions(options)
    .setFirefoxService(service)
    .build()
  installedAddon = await driver.installAddon(zipPath, true)
  if (installedAddon !== ADDON_ID) {
    throw new Error(`Installed add-on ID ${installedAddon} does not match ${ADDON_ID}`)
  }

  const hostname = await extensionHostname(driver)
  if (!hostname) throw new Error(`Could not resolve moz-extension hostname for ${ADDON_ID}`)

  await driver.get(`moz-extension://${hostname}/options/index.html`)
  await driver.wait(until.titleIs(EXPECTED_TITLE), timeoutMs)
  const consent = await driver.wait(
    until.elementLocated(By.css('[data-testid="analytics-consent-toggle"]')),
    timeoutMs,
  )
  if (await consent.isSelected()) {
    throw new Error('Analytics consent must be off in a fresh Firefox profile')
  }
  const optionsText = await driver.findElement(By.css('body')).getText()
  for (const expected of ['StreamPulse', 'Share anonymous product usage', 'Probe backend']) {
    if (!optionsText.includes(expected)) {
      throw new Error(`Firefox options page missing expected text: ${expected}`)
    }
  }

  const watchlist = await runtimeMessage(driver, { type: 'LIST_WATCHLIST' })
  if (
    !watchlist ||
    watchlist.type !== 'WATCHLIST' ||
    !Array.isArray(watchlist.channels) ||
    watchlist.channels.length !== 0
  ) {
    throw new Error(`Firefox background watchlist response invalid: ${JSON.stringify(watchlist)}`)
  }

  await driver.get(`moz-extension://${hostname}/popup/index.html`)
  await driver.wait(until.titleIs('StreamPulse'), timeoutMs)
  await driver.wait(
    async () => driver.executeScript(`return Boolean(document.querySelector('#root')?.firstElementChild)`),
    timeoutMs,
  )
  const popupText = await driver.executeScript(
    `return document.querySelector('#root')?.textContent || ''`,
  )
  if (!popupText.includes('StreamPulse')) {
    throw new Error('Firefox popup did not render StreamPulse')
  }

  const capabilities = await driver.getCapabilities()
  console.log(
    JSON.stringify({
      ok: true,
      browser: capabilities.get('browserName'),
      browserVersion: capabilities.get('browserVersion'),
      addonId: installedAddon,
      optionsRendered: true,
      popupRendered: true,
      backgroundMessage: watchlist.type,
      analyticsConsentDefault: false,
    }),
  )
} finally {
  if (driver) {
    if (installedAddon) {
      try {
        await driver.uninstallAddon(installedAddon)
      } catch {
        // Session cleanup still takes precedence.
      }
    }
    try {
      await driver.quit()
    } catch {
      // Firefox may already have terminated after a failed Marionette command.
    }
  }
}
