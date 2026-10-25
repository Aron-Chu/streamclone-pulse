import { createHash, randomUUID } from 'node:crypto'
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

export const FIREFOX_ADDON_ID = 'streampulse@streampulse.stream'
export const HARNESS_USAGE = 'node scripts/run-extension-live-firefox.mjs --artifact <verified.json> --firefox <installed firefox.exe> --evidence <new directory> [--mode setup|live] [--url https://www.twitch.tv/<channel>]\nDefault: headed setup on a local ephemeral fixture; live mode is limited identity/shadow scaffolding.'
const TIMEOUT_MS = 25_000
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const message = error => error instanceof Error ? `${error.name}: ${error.message}` : String(error)
const require = createRequire(import.meta.url)
const sameSet = (actual, expected) => Array.isArray(actual) && actual.length === expected.length && [...actual].sort().join('\n') === [...expected].sort().join('\n')
const ensure = (condition, text) => { if (!condition) throw new Error(text) }

function liveUrl(value) {
  const url = new URL(value)
  const login = url.pathname.replace(/^\//, '').replace(/\/$/, '')
  const reserved = new Set(['browse', 'directory', 'videos', 'settings', 'login', 'signup', 'subscriptions', 'inventory'])
  ensure(url.protocol === 'https:' && url.hostname === 'www.twitch.tv' && !url.port && !url.username && !url.password
    && !url.search && !url.hash && /^[a-z0-9_]{3,25}$/i.test(login) && !reserved.has(login.toLowerCase()), 'Live URL must be a direct https://www.twitch.tv/<channel> URL')
  return url.href
}

export function parseHarnessArgs(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true }
  const names = new Map([['--artifact', 'artifactPath'], ['--firefox', 'firefoxPath'], ['--evidence', 'evidenceDir'], ['--mode', 'mode'], ['--url', 'url']])
  const parsed = { mode: 'setup' }
  const seen = new Set()
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]
    ensure(names.has(flag), `Unsupported option ${flag}; profiles, headless mode and privileged browser access are not supported`)
    ensure(!seen.has(flag) && typeof argv[i + 1] === 'string' && !argv[i + 1].startsWith('--'), `Missing or duplicate value for ${flag}`)
    seen.add(flag)
    parsed[names.get(flag)] = argv[i + 1]
  }
  for (const name of ['artifactPath', 'firefoxPath', 'evidenceDir']) {
    ensure(parsed[name], `Missing required ${name}`)
    parsed[name] = path.resolve(parsed[name])
  }
  ensure(parsed.mode === 'setup' || parsed.mode === 'live', 'Mode must be setup or live')
  ensure(parsed.mode === 'live' || !parsed.url, '--url requires --mode live; setup never visits Twitch')
  if (parsed.mode === 'live') parsed.url = liveUrl(parsed.url ?? 'https://www.twitch.tv/caedrel')
  return parsed
}

/** The local artifact-preparation helper verifies ZIP contents; this rechecks its proof and immutable ZIP bytes before launching. */
export async function verifyFirefoxArtifact(artifactPath) {
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8'))
  ensure(artifact.schemaVersion === 1 && artifact.localOnly === true, 'Artifact must be schemaVersion 1 and explicitly localOnly')
  ensure(artifact.target === 'firefox' && artifact.version === '0.2.2' && artifact.addonId === FIREFOX_ADDON_ID, 'Wrong artifact target, version or add-on ID')
  ensure(/^[a-f0-9]{40}$/i.test(artifact.sourceRevision ?? '') && typeof artifact.buildId === 'string'
    && artifact.buildId.startsWith(`dev-${artifact.sourceRevision.slice(0, 12)}-`), 'Artifact build ID/source revision mismatch')
  ensure(['manifest', 'targetMetadata', 'bundleBuildId', 'provenance'].every(key => artifact.verification?.[key] === true), 'Artifact is missing required ZIP verification proof')
  const manifest = artifact.manifest
  ensure(manifest?.manifest_version === 3 && manifest.version === artifact.version
    && manifest.browser_specific_settings?.gecko?.id === FIREFOX_ADDON_ID, 'Firefox manifest identity mismatch')
  ensure(manifest.background?.type === 'module' && sameSet(manifest.background.scripts, ['background/service-worker.js'])
    && !('service_worker' in manifest.background), 'Firefox artifact must use its module background.scripts target')
  ensure(sameSet(manifest.permissions, ['storage', 'scripting'])
    && sameSet(manifest.host_permissions, ['https://api.streampulse.stream/*', 'https://*.twitch.tv/*']), 'Unexpected Firefox declared permissions or hosts')
  ensure(manifest.content_scripts?.length === 1 && sameSet(manifest.content_scripts[0].matches, ['https://*.twitch.tv/*'])
    && sameSet(manifest.content_scripts[0].js, ['content/twitch.js']), 'Unexpected Firefox content-script target')
  ensure(sameSet(manifest.browser_specific_settings.gecko.data_collection_permissions?.required, ['browsingActivity']), 'Missing Firefox data-collection declaration')
  const entries = artifact.zipEntries
  ensure(Array.isArray(entries) && new Set(entries).size === entries.length && entries.every(entry => typeof entry === 'string'
    && !entry.includes('\\') && !entry.startsWith('/') && !entry.split('/').some(part => part === '..' || part === '')), 'Unsafe or missing ZIP entry inventory')
  ensure(['manifest.json', 'extension-target.json', 'content/twitch.js', 'content/shadow.css', 'background/service-worker.js'].every(entry => entries.includes(entry)), 'Required Firefox ZIP entries missing')
  if (artifact.metadata) ensure(artifact.metadata.target === 'firefox' && artifact.metadata.version === artifact.version && artifact.metadata.buildId === artifact.buildId, 'Target metadata identity mismatch')
  if (artifact.provenance) ensure(artifact.provenance.packageBuildCommit === artifact.sourceRevision && artifact.provenance.buildId === artifact.buildId, 'Provenance identity mismatch')
  ensure(typeof artifact.zipPath === 'string' && path.isAbsolute(artifact.zipPath) && artifact.zipPath.endsWith('.zip'), 'ZIP path must be an absolute .zip path')
  ensure(/^[a-f0-9]{64}$/i.test(artifact.sha256 ?? ''), 'Missing full ZIP SHA-256')
  ensure((await stat(artifact.zipPath)).isFile(), 'Artifact ZIP is not a regular file')
  const bytes = await readFile(artifact.zipPath)
  ensure(bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), 'Artifact is not a ZIP local-file stream')
  const actualSha256 = hash(bytes)
  ensure(actualSha256 === artifact.sha256.toLowerCase(), 'Artifact ZIP SHA-256 mismatch; prepare/verify it again before testing')
  return { ...artifact, actualSha256 }
}

export async function createFirefoxDriver(config) {
  ensure(!process.env.MOZ_REMOTE_ALLOW_SYSTEM_ACCESS || process.env.MOZ_REMOTE_ALLOW_SYSTEM_ACCESS === '0', 'Privileged Firefox system-access environment is not supported by this harness')
  process.env.SE_AVOID_STATS = 'true'
  process.env.SE_AVOID_BROWSER_DOWNLOAD = 'true'
  const [{ Builder }, { default: firefox }] = await Promise.all([import('selenium-webdriver'), import('selenium-webdriver/firefox.js')])
  const options = new firefox.Options().setBinary(config.firefoxPath).enableBidi().windowSize({ width: 1440, height: 1000 })
  const service = process.env.GECKODRIVER_BINARY ? new firefox.ServiceBuilder(path.resolve(process.env.GECKODRIVER_BINARY)) : new firefox.ServiceBuilder()
  // No supplied profile, browser preferences, headless arguments or privileged context.
  return new Builder().disableEnvironmentOverrides().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build()
}

function logRecord(entry) {
  return { receivedUtc: new Date().toISOString(), type: entry.type ?? null, level: entry.level ?? null, text: entry.text ?? '',
    timestamp: entry.timeStamp ?? null, browsingContext: entry.source?.browsingContextId ?? null, realm: entry.source?.realmId ?? null,
    stackTrace: entry.stackTrace ?? null }
}

export async function subscribeLogs(driver, onLog) {
  const { default: LogInspector } = await import('selenium-webdriver/bidi/logInspector.js')
  const bidi = await driver.getBidi()
  let inspector
  try {
    inspector = await LogInspector(driver)
    const callback = await inspector.onLog(onLog)
    return { removeListener: () => inspector.removeCallback(callback), closeInspector: () => inspector.close(), closeBidi: () => bidi.close() }
  } catch (error) {
    if (inspector) await inspector.close().catch(() => undefined)
    await bidi.close().catch(() => undefined)
    throw error
  }
}

async function startFixture(token) {
  const route = `/setup-${randomUUID()}`
  const html = `<!doctype html><meta charset="utf-8"><title>Firefox harness local setup</title><style>body{font:20px system-ui;background:#14141c;color:#eee;padding:48px}#closed-root-probe{display:block;padding:24px;border:2px solid #a78bfa}</style><h1>Firefox harness local setup</h1><p>This is a local closed-shadow and BiDi-log fixture, not StreamPulse.</p><div id="closed-root-probe"></div><script>document.getElementById('closed-root-probe').attachShadow({mode:'closed'}).innerHTML='<span id="probe-text">Closed shadow ready</span>'; console.log(${JSON.stringify(token)});</script>`
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== route) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(html)
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { url: `http://127.0.0.1:${server.address().port}${route}`, close: () => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  }) }
}

async function setupProbe(driver, logs, token) {
  const { By } = await import('selenium-webdriver')
  await driver.wait(() => logs.some(entry => entry.text.includes(token)), TIMEOUT_MS, 'BiDi did not record the local fixture console message')
  const logCapture = { status: 'PASS', token, matchedEntries: logs.filter(entry => entry.text.includes(token)).length }
  const host = await driver.findElement(By.id('closed-root-probe'))
  ensure(await driver.executeScript("return document.getElementById('closed-root-probe').shadowRoot === null"), 'Fixture is not a closed shadow root')
  try {
    const shadow = await host.getShadowRoot()
    const child = await shadow.findElement(By.id('probe-text'))
    ensure(await child.getText() === 'Closed shadow ready' && await child.isDisplayed(), 'Closed-shadow child is not rendered correctly')
    return { logCapture, closedShadow: { status: 'PASS', method: 'WebElement.getShadowRoot', text: await child.getText() } }
  } catch (error) {
    if (/NoSuchShadowRoot|UnsupportedOperation|unsupported operation|not supported/i.test(message(error))) {
      return { logCapture, closedShadow: { status: 'UNSUPPORTED', method: 'WebElement.getShadowRoot', error: message(error) } }
    }
    throw error
  }
}

async function liveProbe(driver, artifact) {
  const { By } = await import('selenium-webdriver')
  const host = await driver.wait(async () => {
    const hosts = await driver.findElements(By.id('streamclone-pulse-root'))
    for (const node of hosts) {
      if (await node.getAttribute('data-streampulse-build') === artifact.buildId
        && await node.getAttribute('data-streampulse-target') === 'firefox'
        && await node.getAttribute('data-streampulse-owner') === artifact.addonId
        && await node.getAttribute('data-streampulse-styles') === 'loaded' && await node.isDisplayed()) return node
    }
    return false
  }, TIMEOUT_MS, 'Visible styled Pulse host with verified Firefox build/owner did not appear')
  const identity = { status: 'PASS', buildId: await host.getAttribute('data-streampulse-build'), target: await host.getAttribute('data-streampulse-target'),
    owner: await host.getAttribute('data-streampulse-owner'), styles: await host.getAttribute('data-streampulse-styles'), displayed: await host.isDisplayed() }
  try {
    const shadow = await host.getShadowRoot()
    const children = await shadow.findElements(By.css('*'))
    ensure(children.length > 0, 'Pulse closed shadow root has no children')
    return { identity, closedShadow: { status: 'PASS', method: 'WebElement.getShadowRoot', descendants: children.length } }
  } catch (error) {
    return { identity, closedShadow: { status: 'UNSUPPORTED_OR_FAILED', method: 'WebElement.getShadowRoot', error: message(error) } }
  }
}

async function saveScreenshot(driver, evidenceDir, mode) {
  const bytes = Buffer.from(await driver.takeScreenshot(), 'base64')
  ensure(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'WebDriver did not return a PNG screenshot')
  const name = `01-${mode}.png`
  await writeFile(path.join(evidenceDir, name), bytes, { flag: 'wx' })
  return { name, sha256: hash(bytes), localOnly: true, source: 'WebDriver native viewport screenshot' }
}

/** Dependency injection is for deterministic lifecycle tests; the CLI always uses the real headed Firefox implementation. */
export async function runFirefoxLiveHarness(config, dependencies = {}) {
  const deps = { createDriver: createFirefoxDriver, subscribeLogs, startFixture, ...dependencies }
  const evidenceDir = path.resolve(config.evidenceDir)
  await mkdir(path.dirname(evidenceDir), { recursive: true })
  await mkdir(evidenceDir) // An existing evidence directory is never overwritten.
  const result = { schemaVersion: 1, mode: config.mode, status: 'RUNNING', startedUtc: new Date().toISOString(), localOnly: true,
    events: [], checks: {}, cleanup: {}, logs: [], screenshots: [], limitations: [
      'BiDi collection covers observed page/content realms only; it does not establish extension/background-log coverage.',
      'Runtime granted permissions/consent are not inspected by ordinary page JavaScript; no privileged Firefox context is used.',
      'Historical run7 and D1 results are not modified.',
    ], configuration: { firefoxBinary: config.firefoxPath, headedOnly: true, profile: 'No profile supplied; geckodriver anonymous temporary default',
      seleniumManager: { avoidStats: true, avoidBrowserDownload: true }, geckodriverBinary: process.env.GECKODRIVER_BINARY ? path.resolve(process.env.GECKODRIVER_BINARY) : null } }
  const event = phase => result.events.push({ phase, utc: new Date().toISOString() })
  let driver, logSession, fixture, installedId, installAttempted = false
  let failed = false
  try {
    ensure(config.mode === 'setup' || config.mode === 'live', 'Mode must be setup or live')
    ensure(Number(process.versions.node.split('.')[0]) >= 24, 'This harness requires Node 24 or newer')
    ensure((await stat(config.firefoxPath)).isFile(), 'Installed Firefox binary is not a file')
    const artifact = await verifyFirefoxArtifact(config.artifactPath)
    result.artifact = { verificationPath: path.resolve(config.artifactPath), zipPath: artifact.zipPath, sha256: artifact.actualSha256,
      buildId: artifact.buildId, target: artifact.target, version: artifact.version, addonId: artifact.addonId, sourceRevision: artifact.sourceRevision,
      verification: artifact.verification, declaredPermissions: artifact.manifest.permissions, declaredHosts: artifact.manifest.host_permissions }
    event('artifact-reverified')
    driver = await deps.createDriver(config)
    event('driver-created')
    await driver.manage().setTimeouts({ implicit: 0, pageLoad: 30_000, script: 10_000 })
    const caps = await driver.getCapabilities()
    result.runtime = { nodeVersion: process.versions.node, seleniumVersion: require('selenium-webdriver/package.json').version,
      browserName: caps.get('browserName') ?? null, browserVersion: caps.get('browserVersion') ?? null, platformName: caps.get('platformName') ?? null,
      geckodriverVersion: caps.get('moz:geckodriverVersion') ?? null, profile: caps.get('moz:profile') ?? null,
      headless: caps.get('moz:headless') ?? null, webSocketUrl: caps.get('webSocketUrl') ?? null }
    ensure(result.runtime.browserName === 'firefox' && result.runtime.headless !== true, 'Session must use headed Firefox')
    ensure(result.runtime.profile, 'Firefox did not report its actual temporary profile path')
    logSession = await deps.subscribeLogs(driver, entry => result.logs.push(logRecord(entry)))
    event('bidi-logs-attached')
    installAttempted = true
    event('temporary-install-started')
    installedId = await driver.installAddon(artifact.zipPath, true)
    result.checks.temporaryInstall = { status: installedId === artifact.addonId ? 'PASS' : 'FAIL', expectedId: artifact.addonId, returnedId: installedId, temporaryRequested: true }
    ensure(installedId === artifact.addonId, 'Temporary installation returned an unexpected add-on ID')
    event('temporary-addon-installed')
    if (config.mode === 'setup') {
      const token = `streampulse-firefox-setup-log-${randomUUID()}`
      fixture = await deps.startFixture(token)
      result.visitedUrl = fixture.url
      await driver.get(fixture.url)
      Object.assign(result.checks, await setupProbe(driver, result.logs, token))
      result.status = result.checks.closedShadow.status === 'PASS' ? 'PASS' : 'INCOMPLETE'
    } else {
      result.visitedUrl = liveUrl(config.url ?? 'https://www.twitch.tv/caedrel')
      await driver.get(result.visitedUrl)
      Object.assign(result.checks, await liveProbe(driver, artifact))
      result.status = 'PARTIAL'
      result.limitations.push('Live mode is identity/shadow scaffolding only. Timed CHAT/MIN, clip return, picture/cache handoff, actual grants and background errors remain unexercised.')
    }
    result.screenshots.push(await saveScreenshot(driver, evidenceDir, config.mode))
  } catch (error) {
    failed = true
    result.status = 'FAIL'
    result.error = message(error)
    if (driver && result.screenshots.length === 0) {
      try { result.screenshots.push(await saveScreenshot(driver, evidenceDir, `${config.mode}-failure`)) }
      catch (captureError) { result.screenshotError = message(captureError) }
    }
  } finally {
    const clean = async (name, action) => {
      try { await action(); result.cleanup[name] = { status: 'PASS' } }
      catch (error) { failed = true; result.cleanup[name] = { status: 'FAIL', error: message(error) } }
    }
    if (driver && typeof installedId === 'string' && installedId) {
      await clean('addonRemoval', () => driver.uninstallAddon(installedId))
      result.cleanup.addonRemoval.addonId = installedId
      result.cleanup.addonRemoval.method = 'uninstallAddon API acknowledgement; no privileged enumeration'
    } else result.cleanup.addonRemoval = { status: installAttempted ? 'UNCONFIRMED' : 'NOT_INSTALLED', note: installAttempted ? 'Installation did not return an ID; removal is not claimed' : 'Install not attempted' }
    if (logSession) {
      await clean('logListener', () => logSession.removeListener())
      await clean('logSubscription', () => logSession.closeInspector())
      await clean('bidiSocket', () => logSession.closeBidi())
    }
    if (driver) await clean('driverQuit', () => driver.quit())
    if (fixture) await clean('fixtureClosed', () => fixture.close())
  }
  if (failed) result.status = 'FAIL'
  result.finishedUtc = new Date().toISOString()
  const evidencePath = path.join(evidenceDir, 'evidence.json')
  await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' })
  return { exitCode: failed ? 1 : result.status === 'PASS' ? 0 : 2, result, evidencePath }
}
