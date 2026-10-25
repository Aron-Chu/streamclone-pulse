import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, readdir, access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { By } from 'selenium-webdriver'
import { createFirefoxDriver as createDriver, subscribeLogs, verifyFirefoxArtifact, parseHarnessArgs } from './firefox-live-harness.mjs'

export const ACCEPTANCE_USAGE = 'node scripts/run-extension-acceptance-firefox.mjs --artifact <verified.json> --firefox <exe> --evidence <newdir> [--url https://www.twitch.tv/caedrel] [--vod-url https://www.twitch.tv/videos/2902672687]\nHeaded anonymous temporary profile; finite180-second pass, clip/picture checks, exact-ID cleanup. Actual grants remain BLOCKED without a supported extension context.'
export const REFRESH_TARGETS = Object.freeze([0, 30, 60, 90, 120, 150, 180])
const CORE = ['C-load', 'C-permissions', 'C-build-id', 'C-refresh-0-90-180', 'C-clip', 'C-remove']
const EXTRA = ['pictures-live-row', 'pictures-vod', 'page-lookup-errors']
const require = createRequire(import.meta.url)
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const describeError = error => error instanceof Error ? `${error.name}: ${error.message}` : String(error)
const ensure = (test, text) => { if (!test) throw new Error(text) }
const nativeClock = { now: () => performance.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) }
export class AcceptanceBlocked extends Error {
  constructor(message, fatal = false) { super(message); this.name = 'AcceptanceBlocked'; this.fatal = fatal }
}

export function validateAcceptanceUrl(value, kind = 'live') {
  const url = new URL(value)
  ensure(url.protocol === 'https:' && url.hostname === 'www.twitch.tv' && !url.port && !url.username && !url.password && !url.hash,
    'Acceptance navigation requires a public https://www.twitch.tv URL')
  if (kind === 'vod') ensure(/^\/videos\/\d{5,20}\/?$/.test(url.pathname) && !url.search, 'VOD URL must be a direct /videos/<id> URL')
  else if (kind === 'clip') ensure(/^\/[a-z0-9_]{3,25}\/clip\/[a-z0-9_-]+\/?$/i.test(url.pathname), 'Expected an observed shared channel clip URL')
  else {
    const login = url.pathname.replace(/^\//, '').replace(/\/$/, '')
    ensure(/^[a-z0-9_]{3,25}$/i.test(login) && !['login', 'signup', 'directory', 'settings', 'videos', 'browse', 'subscriptions'].includes(login.toLowerCase()) && !url.search,
      'Live URL must be a direct public channel URL')
  }
  return url.href
}

export function parseAcceptanceArgs(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true }
  const base = []; let vodUrl
  for (let i = 0; i < argv.length; i += 2) {
    ensure(argv[i] !== '--mode', 'Acceptance always uses the full finite live sequence')
    if (argv[i] === '--vod-url') {
      ensure(!vodUrl && argv[i + 1] && !argv[i + 1].startsWith('--'), 'Missing or duplicate --vod-url')
      vodUrl = argv[i + 1]
    } else base.push(argv[i], argv[i + 1])
  }
  const config = parseHarnessArgs([...base, '--mode', 'live'])
  return { ...config, mode: 'acceptance', url: validateAcceptanceUrl(config.url), vodUrl: validateAcceptanceUrl(vodUrl ?? 'https://www.twitch.tv/videos/2902672687', 'vod') }
}

export function securityGate(state) {
  if (/\/(login|signup|passport|challenge)(?:\/|\?|$)/i.test(state.url ?? '')) return 'Authentication/security navigation requires human action'
  if (state.challengeVisible || state.loginFormVisible || /verify (?:that )?you are (?:a )?human|captcha|security check|log in to continue|sign in to continue|subscriber.only|subscribers only/i.test(state.dialogText ?? '')) return 'Visible authentication, security, CAPTCHA or access gate; no bypass attempted'
  return null
}

export function isActualScenePicture(image, kind = 'row') {
  if (!image || !image.complete || !(image.width >= 80) || !(image.height >= 40)) return false
  if (kind === 'row' && image.has !== true) return false
  const label = image.sourceLabel ?? ''
  if (kind === 'card' && label !== 'Twitch VOD frame') return false
  if (/game art|top emote|No VOD|still recording/i.test(label)) return false
  const src = image.src ?? ''
  if (/ttv-boxart|\/emote\/|\/emoticons\//i.test(src)) return false
  return /^blob:https:\/\/www\.twitch\.tv\//.test(src) || /^data:image\/jpeg;base64,/.test(src)
    || /^https:\/\/[^/]+\.(?:cloudfront\.net|twitch\.tv)\/.*\/storyboards\//.test(src)
    || /^https:\/\/api\.streampulse\.stream\/v1\/analytics\/moments\/picture\?/.test(src)
}

export function gradeRefreshSamples(samples) {
  if (samples.length !== REFRESH_TARGETS.length || samples.some((sample, index) => sample.targetSeconds !== REFRESH_TARGETS[index])) return { status: 'BLOCKED', reason: 'Incomplete0-180-second sample sequence' }
  if (samples.some(sample => !sample.focused || sample.visibility !== 'visible' || !sample.live || !Number.isFinite(sample.chatPerMin))) return { status: 'BLOCKED', reason: 'Visible focused live readings not established at every checkpoint' }
  const changes = samples.filter((sample, index) => index > 0 && sample.chatPerMin !== samples[index - 1].chatPerMin)
  if (changes.length < 2 || changes[0].elapsedSeconds > 65) return { status: 'BLOCKED', reason: 'Rounded samples do not establish timely continued changes; equal rates alone do not prove freezing', changes: changes.length }
  if (!changes.some(sample => sample.targetSeconds >= 120)) return { status: 'BLOCKED', reason: 'Early changes alone do not establish updates during the final minute', changes: changes.length }
  if (samples.some(sample => Math.abs(sample.elapsedSeconds - sample.targetSeconds) > 8)) return { status: 'BLOCKED', reason: 'Checkpoint timing exceeds recorded sampling tolerance', changes: changes.length }
  return { status: 'PASS', reason: 'CHAT/MIN changed within about60seconds and continued changing through180seconds', changes: changes.length }
}

export function classifyLookupLogs(logs) {
  const rawMatches = [], identifiedErrors = [], qualifiedMatches = []
  logs.forEach((entry, index) => {
    // Console filtering concerns message text, not opaque realm IDs or stack
    // line numbers that may coincidentally contain 400/401.
    const text = entry.text ?? ''
    if (!/gql\.twitch\.tv|client[- ]id|400|401/i.test(text)) return
    rawMatches.push(index)
    const specific = /gql\.twitch\.tv|client[- ]id|\b(?:400|401)\b|\b(?:http|status)[_ :=-]*(?:400|401)\b/i.test(text)
    if (specific && (entry.level === 'error' || /failed|error|invalid|rejected|http[_ :]+(?:400|401)\b/i.test(text))) identifiedErrors.push(index)
    else qualifiedMatches.push({ index, reason: specific ? 'No lookup failure signal' : 'Substring-only match such as4000Kbps; no standalone400/401 or lookup identifier' })
  })
  return { rawMatches, identifiedErrors, qualifiedMatches, scope: 'BiDi page/content logs only; background coverage unverified' }
}

export function gradeAcceptance(rows, cleanup) {
  if (rows.some(row => row.status === 'FAIL') || Object.values(cleanup).some(item => item?.status === 'FAIL')) return { status: 'FAIL', exitCode: 1 }
  if (rows.some(row => row.status !== 'PASS')) return { status: 'BLOCKED', exitCode: 2 }
  return { status: 'PASS', exitCode: 0 }
}

async function checkPublicState(ctx) {
  const state = await ctx.driver.executeScript(`const visible=n=>!!n&&n.getBoundingClientRect().width>0&&n.getBoundingClientRect().height>0;
    return {url:location.href,visibility:document.visibilityState,focused:document.hasFocus(),
      challengeVisible:[...document.querySelectorAll('iframe[src*="captcha"],iframe[src*="challenge"],#challenge-running,[data-a-target="captcha"]')].some(visible),
      loginFormVisible:[...document.querySelectorAll('[data-a-target="login-form"],form[action*="passport"]')].some(visible),
      dialogText:[...document.querySelectorAll('[role="dialog"],dialog')].filter(visible).map(n=>n.textContent).join(' ').slice(0,6000)};`)
  const gate = securityGate(state)
  if (gate) throw new AcceptanceBlocked(gate, true)
  return state
}

async function poll(ctx, action, label, timeoutMs = 45_000, defect = false) {
  const start = ctx.clock.now()
  while (ctx.clock.now() - start < timeoutMs) {
    await checkPublicState(ctx)
    try { const found = await action(); if (found) return found }
    catch (error) { if (!/NoSuchElement|StaleElementReference/i.test(describeError(error))) throw error }
    await ctx.clock.sleep(300)
  }
  if (defect) throw new Error(label)
  throw new AcceptanceBlocked(`${label}; required public data/state unavailable within${timeoutMs / 1000}s`)
}

async function scrollTo(ctx, element) { await ctx.driver.executeScript("arguments[0].scrollIntoView({block:'center',inline:'nearest'})", element) }
async function exists(file) { try { await access(file); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error } }

export async function runFirefoxAcceptance(config, dependencies = {}) {
  const deps = { createDriver, subscribeLogs, verifyArtifact: verifyFirefoxArtifact, exercise: exerciseAcceptance, clock: nativeClock, profileExists: exists, ...dependencies }
  const evidenceDir = path.resolve(config.evidenceDir)
  await mkdir(path.dirname(evidenceDir), { recursive: true }); await mkdir(evidenceDir)
  const result = { schemaVersion: 1, mode: 'acceptance', status: 'RUNNING', startedUtc: new Date().toISOString(), localOnly: true,
    rows: [...CORE, ...EXTRA].map(id => ({ id, status: 'BLOCKED', evidence: 'Not yet exercised', screenshots: [] })),
    events: [], logs: [], cleanup: {}, visitedUrls: [], limitations: [
      'Actual granted permissions/consent remain BLOCKED without a supported extension context; no denied-page retry or privileged flags.',
      'BiDi page/content observations do not establish complete extension/background logs.',
      'Scene sources and labels are checked; subject/frame timing still require local visual review.',
      'No account, Track, watchlist, chat, feedback, follow, subscription or product-source changes. Run7 and D1 stay untouched.' ] }
  const row = id => result.rows.find(item => item.id === id)
  row('C-permissions').evidence = 'Declared ZIP permissions verified; actual Firefox grants/consent unavailable in ordinary page context. No privileged/internal-page retry.'
  let driver, logs, addonId, profile, installAttempted = false
  const persist = async () => {
    result.updatedUtc = new Date().toISOString()
    await writeFile(path.join(evidenceDir, 'progress.json.tmp'), `${JSON.stringify(result, null, 2)}\n`)
    await rename(path.join(evidenceDir, 'progress.json.tmp'), path.join(evidenceDir, 'progress.json'))
  }
  const capture = async (id, label) => {
    const bytes = Buffer.from(await driver.takeScreenshot(), 'base64')
    ensure(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Screenshot is not PNG')
    const assigned = result.rows.flatMap(item => item.screenshots), digest = sha256(bytes)
    if (assigned.some(item => item.sha256 === digest)) { result.events.push({ phase: 'duplicate-capture-skipped', row: id, label }); await persist(); return null }
    const image = { name: `${String(assigned.length + 1).padStart(2, '0')}-${label}.png`, sha256: digest }
    await writeFile(path.join(evidenceDir, image.name), bytes, { flag: 'wx' }); row(id).screenshots.push(image); await persist(); return image
  }
  const phase = async (id, action) => {
    try { const data = await action(); Object.assign(row(id), { status: data.status, evidence: data.reason, data }) }
    catch (error) {
      Object.assign(row(id), { status: error instanceof AcceptanceBlocked ? 'BLOCKED' : 'FAIL', evidence: describeError(error) })
      if (driver) try { await capture(id, `${id.replaceAll(/[^a-z0-9-]/gi, '-')}-failure-state`) } catch (captureError) { row(id).screenshotError = describeError(captureError) }
      if (error instanceof AcceptanceBlocked && error.fatal) { await persist(); throw error }
    }
    await persist()
  }
  await persist()
  try {
    config.url = validateAcceptanceUrl(config.url ?? 'https://www.twitch.tv/caedrel')
    config.vodUrl = validateAcceptanceUrl(config.vodUrl ?? 'https://www.twitch.tv/videos/2902672687', 'vod')
    ensure(Number(process.versions.node.split('.')[0]) >= 24, 'Node24 or newer is required')
    const artifact = await deps.verifyArtifact(config.artifactPath)
    result.artifact = { zipPath: artifact.zipPath, sha256: artifact.actualSha256, buildId: artifact.buildId, target: artifact.target,
      addonId: artifact.addonId, sourceRevision: artifact.sourceRevision, declaredPermissions: artifact.manifest.permissions, declaredHosts: artifact.manifest.host_permissions }
    driver = await deps.createDriver(config)
    await driver.manage().setTimeouts({ implicit: 0, pageLoad: 30_000, script: 10_000 })
    const caps = await driver.getCapabilities(); profile = caps.get('moz:profile')
    result.runtime = { nodeVersion: process.versions.node, seleniumVersion: require('selenium-webdriver/package.json').version, firefoxBinary: config.firefoxPath,
      geckodriverBinary: process.env.GECKODRIVER_BINARY ?? null, browserName: caps.get('browserName'), browserVersion: caps.get('browserVersion'),
      geckodriverVersion: caps.get('moz:geckodriverVersion'), profile, headless: caps.get('moz:headless'), requestedProfile: 'Anonymous geckodriver default' }
    ensure(result.runtime.browserName === 'firefox' && result.runtime.headless !== true && profile, 'Expected headed Firefox with reported temporary profile')
    logs = await deps.subscribeLogs(driver, entry => result.logs.push({ receivedUtc: new Date().toISOString(), level: entry.level, type: entry.type,
      text: entry.text ?? '', timestamp: entry.timeStamp, source: entry.source, stackTrace: entry.stackTrace }))
    result.events.push({ phase: 'bidi-attached-before-install', utc: new Date().toISOString() })
    installAttempted = true; addonId = await driver.installAddon(artifact.zipPath, true)
    ensure(addonId === artifact.addonId, 'Installed add-on ID differs from artifact')
    Object.assign(row('C-load'), { status: 'PASS', evidence: 'Verified ZIP temporarily installed; exact returned Gecko ID matches', data: { addonId, temporaryRequested: true } })
    await persist()
    const ctx = { driver, artifact, config, result, row, persist, capture, phase, clock: deps.clock,
      navigate: async url => { await driver.get(url); result.visitedUrls.push({ url, utc: new Date().toISOString() }); await checkPublicState({ driver }); await persist() } }
    await deps.exercise(ctx)
  } catch (error) {
    result.error = describeError(error); result.events.push({ phase: 'sequence-stopped', status: error instanceof AcceptanceBlocked ? 'BLOCKED' : 'FAIL', error: result.error })
    if (!(error instanceof AcceptanceBlocked)) { const target = row('C-load').status === 'PASS' ? row('C-build-id') : row('C-load'); target.status = 'FAIL'; target.evidence = result.error }
    await persist()
  } finally {
    const clean = async (name, action) => {
      try { await action(); result.cleanup[name] = { status: 'PASS' } } catch (error) { result.cleanup[name] = { status: 'FAIL', error: describeError(error) } }
      try { await persist() } catch (error) { result.cleanup.progressWrite = { status: 'FAIL', error: describeError(error) } }
    }
    if (driver && typeof addonId === 'string' && addonId) { await clean('addonRemoval', () => driver.uninstallAddon(addonId)); result.cleanup.addonRemoval.addonId = addonId }
    else result.cleanup.addonRemoval = { status: installAttempted ? 'BLOCKED' : 'NOT_INSTALLED', evidence: 'No returned installed ID; removal not claimed' }
    if (logs) { await clean('logListener', () => logs.removeListener()); await clean('logSubscription', () => logs.closeInspector()); await clean('bidiSocket', () => logs.closeBidi()) }
    if (driver) await clean('driverQuit', () => driver.quit())
    if (profile) await clean('profileRemoved', async () => {
      const start = deps.clock.now()
      while (await deps.profileExists(profile)) { if (deps.clock.now() - start >= 10_000) throw new Error('Temporary profile still exists after quit; harness did not delete it'); await deps.clock.sleep(100) }
    })
    if (addonId) Object.assign(row('C-remove'), { status: ['addonRemoval', 'driverQuit', 'profileRemoved'].every(name => result.cleanup[name]?.status === 'PASS') ? 'PASS' : 'FAIL', evidence: 'Exact-ID uninstall, quit and profile disappearance recorded individually', data: { addonId } })
  }
  result.lookupSummary = classifyLookupLogs(result.logs)
  Object.assign(row('page-lookup-errors'), { status: result.lookupSummary.identifiedErrors.length ? 'FAIL' : result.visitedUrls.length && logs ? 'PASS' : 'BLOCKED', evidence: `${result.lookupSummary.identifiedErrors.length} identified lookup errors; ${result.lookupSummary.qualifiedMatches.length} qualified raw matches. Page/content scope only.`, data: result.lookupSummary })
  const images = result.rows.flatMap(item => item.screenshots), files = (await readdir(evidenceDir)).filter(name => name.endsWith('.png'))
  const matches = await Promise.all(images.map(async image => sha256(await readFile(path.join(evidenceDir, image.name))) === image.sha256))
  result.screenshotAudit = { files: files.length, assignments: images.length, uniqueHashes: new Set(images.map(image => image.sha256)).size === images.length,
    exactlyOnce: files.every(name => images.filter(image => image.name === name).length === 1) && images.length === files.length, fullHashesMatch: matches.every(Boolean), localOnly: true }
  const graded = gradeAcceptance(result.rows, result.cleanup); result.status = graded.status; result.finishedUtc = new Date().toISOString(); await persist()
  await writeFile(path.join(evidenceDir, 'page-logs.json'), `${JSON.stringify(result.logs, null, 2)}\n`, { flag: 'wx' })
  const report = `# Firefox finite acceptance: ${result.status}\n\nBuild: ${result.artifact?.buildId ?? 'unverified'}. Historical run7/D1 unchanged.\n\n| Check | Status | Evidence | Screenshots |\n| --- | --- | --- | --- |\n${result.rows.map(item => `| ${item.id} | ${item.status} | ${item.evidence.replaceAll('|', '\\|')} | ${item.screenshots.map(image => image.name).join(', ')} |`).join('\n')}\n\nCleanup and full image assignments/hashes: progress.json. Images/logs remain local. Actual grants and full background logs remain unverified; no privileged workaround. Scene subject/frame timing requires local visual review.\n`
  await writeFile(path.join(evidenceDir, 'REPORT.md'), report, { flag: 'wx' })
  return { exitCode: graded.exitCode, result, evidencePath: path.join(evidenceDir, 'progress.json') }
}

async function panel(ctx) {
  const identity = async host => {
    const value = { id: await host.getAttribute('id'), buildId: await host.getAttribute('data-streampulse-build'), target: await host.getAttribute('data-streampulse-target'), owner: await host.getAttribute('data-streampulse-owner'), styles: await host.getAttribute('data-streampulse-styles'), displayed: await host.isDisplayed() }
    ensure(value.buildId === ctx.artifact.buildId && value.target === 'firefox' && value.owner === ctx.artifact.addonId, 'Runtime host differs from verified Firefox artifact')
    return value
  }
  return poll(ctx, async () => {
    const tabs = await ctx.driver.findElements(By.id('streamclone-pulse-tabs'))
    if (!tabs.length) return false
    const tabsIdentity = await identity(tabs[0]); if (!tabsIdentity.displayed || tabsIdentity.styles !== 'loaded') return false
    const tabsRoot = await tabs[0].getShadowRoot()
    for (const button of await tabsRoot.findElements(By.css('button[role="tab"]'))) if ((await button.getText()).trim().toUpperCase() === 'PULSE' && await button.getAttribute('aria-selected') !== 'true') await button.click()
    const hosts = await ctx.driver.findElements(By.id('streamclone-pulse-root')); if (!hosts.length) return false
    const panelIdentity = await identity(hosts[0]); if (!panelIdentity.displayed || panelIdentity.styles !== 'loaded') return false
    return { host: hosts[0], shadow: await hosts[0].getShadowRoot(), identity: panelIdentity, tabsIdentity }
  }, 'Visible styled Firefox Pulse hosts did not appear')
}

async function imageState(ctx, element, selector, card = false) {
  return ctx.driver.executeScript(`const root=arguments[0],img=root.querySelector(arguments[1]);return{src:img?.currentSrc||img?.src||'',complete:!!img?.complete,width:img?.naturalWidth||0,height:img?.naturalHeight||0,sourceLabel:arguments[2]?root.querySelector('.pmf-chip')?.textContent?.trim()||'':'',has:root.querySelector('.pmf-thumb')?.hasAttribute('data-has')||false,connected:root.isConnected};`, element, selector, card)
}
async function rowTime(row) { return (await (await row.findElement(By.css('.pulse-mr-offset'))).getText()).trim() }
async function showMore(shadow) {
  for (const button of await shadow.findElements(By.css('button.pulse-moment-more'))) if (/^Show \d+ more moments/.test((await button.getText()).trim())) { await button.click(); return true }
  return false
}

async function sampleRate(ctx, currentPanel) {
  let label
  for (const span of await currentPanel.shadow.findElements(By.css('span'))) if ((await span.getText()).trim().toLowerCase() === 'chat / min') { label = span; break }
  if (!label) throw new AcceptanceBlocked('Live CHAT/MIN label unavailable')
  const rawValue = (await ctx.driver.executeScript('return arguments[0].nextElementSibling?.textContent||""', label)).trim()
  const value = rawValue.replaceAll(',', '').match(/[0-9]+(?:\.[0-9]+)?[KMB]?/i)?.[0], suffix = value?.match(/[KMB]$/i)?.[0]?.toUpperCase()
  const chatPerMin = value ? Number.parseFloat(value) * ({ K: 1e3, M: 1e6, B: 1e9 }[suffix] ?? 1) : NaN
  const state = await ctx.driver.executeScript(`const v=document.querySelector('video');return{focused:document.hasFocus(),visibility:document.visibilityState,url:location.href,viewers:document.querySelector('[data-a-target="animated-channel-viewers-count"]')?.textContent||'',live:!!document.querySelector('[data-a-target="animated-channel-viewers-count"]')&&!!v&&v.readyState>=2&&!v.paused,media:v?{readyState:v.readyState,paused:v.paused,duration:String(v.duration)}:null};`)
  return { ...state, chatPerMin, rawValue }
}

async function refreshPass(ctx, currentPanel) {
  // A styled host can appear before the first public data response. Start the
  // observation clock only once a real visible live reading is available.
  await poll(ctx, async () => {
    try {
      const sample = await sampleRate(ctx, currentPanel)
      return sample.focused && sample.visibility === 'visible' && sample.live && Number.isFinite(sample.chatPerMin)
    } catch (error) {
      if (error instanceof AcceptanceBlocked && !error.fatal) return false
      throw error
    }
  }, 'Readable focused live CHAT/MIN did not become ready')
  const start = ctx.clock.now(), samples = []
  for (const targetSeconds of REFRESH_TARGETS) {
    while (ctx.clock.now() - start < targetSeconds * 1000) { await checkPublicState(ctx); await ctx.clock.sleep(Math.min(1000, targetSeconds * 1000 - (ctx.clock.now() - start))) }
    const reading = await sampleRate(ctx, currentPanel)
    const sample = { ...reading, targetSeconds, elapsedSeconds: (ctx.clock.now() - start) / 1000, utc: new Date().toISOString() }
    samples.push(sample); ctx.row('C-refresh-0-90-180').data = { samples }
    if ([0, 90, 180].includes(targetSeconds)) await ctx.capture('C-refresh-0-90-180', `refresh-${targetSeconds}s`)
    await ctx.persist()
  }
  return { ...gradeRefreshSamples(samples), samples }
}

async function livePicturePass(ctx, currentPanel) {
  let rows = await currentPanel.shadow.findElements(By.css('button.pulse-moment-row-button'))
  if (rows.length <= 3 && await showMore(currentPanel.shadow)) rows = await currentPanel.shadow.findElements(By.css('button.pulse-moment-row-button'))
  const candidates = []
  for (let index = 3; index < rows.length; index++) {
    const before = await imageState(ctx, rows[index], '.pmf-thumb img')
    if (!isActualScenePicture(before)) candidates.push({ row: rows[index], index, time: await rowTime(rows[index]), before })
  }
  const chosen = candidates.find(candidate => candidate.time === '02:39') ?? candidates[0]
  if (!chosen) throw new AcceptanceBlocked('No initially blank ordinary row beyond top3; cache scenario unexercised')
  const elementId = await chosen.row.getId()
  await scrollTo(ctx, chosen.row); ctx.row('pictures-live-row').data = { time: chosen.time, initialIndex: chosen.index, elementId, before: chosen.before }
  await ctx.capture('pictures-live-row', 'ordinary-row-before'); await chosen.row.click()
  const card = await poll(ctx, async () => {
    for (const card of await currentPanel.shadow.findElements(By.css('[data-selected-moment-card="true"]'))) {
      const clock = (await (await card.findElement(By.css('[data-moment-inspector-clock]'))).getText()).replace(/[~\s]/g, '')
      if (clock === chosen.time.replace(/[~\s]/g, '') && isActualScenePicture(await imageState(ctx, card, '.pmf-pic img', true), 'card')) return card
    }
    return false
  }, 'Live card did not obtain a real Twitch VOD frame', 70_000)
  const source = await imageState(ctx, card, '.pmf-pic img', true)
  const pictured = await poll(ctx, async () => { const image = await imageState(ctx, chosen.row, '.pmf-thumb img'); return isActualScenePicture(image) && image.src === source.src ? image : false }, 'Exact card frame loaded but the same mounted row never consumed it', 10_000, true)
  ensure(await chosen.row.getId() === elementId, 'Row element ID changed during handoff')
  await scrollTo(ctx, card); await ctx.capture('pictures-live-row', 'card-and-same-row')
  await (await card.findElement(By.css('button[aria-label="Clear selected moment"]'))).click()
  await poll(ctx, async () => (await currentPanel.shadow.findElements(By.css('[data-top-moment-card],[data-selected-moment-card]'))).length === 0, 'Card did not fully leave DOM', 10_000, true)
  const retained = await imageState(ctx, chosen.row, '.pmf-thumb img')
  ensure(isActualScenePicture(retained) && retained.src === source.src && await chosen.row.getAttribute('aria-pressed') === 'false', 'Same row lost exact picture after card DOM exit')
  await scrollTo(ctx, chosen.row); await ctx.capture('pictures-live-row', 'row-retained-after-card-exit')
  return { status: 'PASS', reason: 'Initially blank ordinary row acquired exact card source without remount and retained it after full card DOM exit', time: chosen.time, elementId, before: chosen.before, pictured, source, retained, cardPresentAfterClose: false }
}

async function clipPass(ctx, currentPanel) {
  const link = await poll(ctx, async () => (await currentPanel.shadow.findElements(By.css('a[data-clip-spike-card]')))[0] ?? false, 'No current Top clip link')
  const observed = { href: await link.getAttribute('href'), title: await link.getAttribute('aria-label') }
  validateAcceptanceUrl(observed.href, 'clip'); await ctx.navigate(observed.href)
  const clipState = await poll(ctx, async () => {
    const state = await ctx.driver.executeScript(`return{url:location.href,title:document.title,hosts:[...document.querySelectorAll('#streamclone-pulse-root,#streamclone-pulse-tabs')].map(n=>n.id),videos:[...document.querySelectorAll('video')].map(v=>({duration:v.duration,readyState:v.readyState}))};`)
    return /\/clip\//.test(state.url) && state.hosts.length === 0 && state.title !== 'Twitch' && state.videos.some(v => v.readyState >= 2 && v.duration > 0 && v.duration < 3600) ? state : false
  }, 'Shared clip did not settle with media/title and no Pulse hosts')
  await ctx.capture('C-clip', 'shared-clip-no-pulse')
  const watchLive = await poll(ctx, async () => {
    for (const control of await ctx.driver.findElements(By.xpath("//*[self::a or self::button][translate(normalize-space(.),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')='watch live']"))) if (await control.isDisplayed()) return control
    return false
  }, 'Observed Watch live control unavailable')
  const returnControl = { text: await watchLive.getText(), href: await watchLive.getAttribute('href') }
  if (returnControl.href) { validateAcceptanceUrl(returnControl.href); ensure(returnControl.href.replace(/\/$/, '') === ctx.config.url.replace(/\/$/, ''), 'Watch live target differs from requested channel') }
  await watchLive.click(); await poll(ctx, async () => (await ctx.driver.getCurrentUrl()).replace(/\/$/, '') === ctx.config.url.replace(/\/$/, ''), 'Watch live did not return to channel')
  const returned = await panel(ctx); await ctx.capture('C-clip', 'live-panel-returned')
  return { status: 'PASS', reason: 'Observed clip href navigated in same tab; no Pulse on real clip, actual Watch live returns both verified hosts', observed, navigationMethod: 'driver.get observed href in same tab', clipState, returnControl, returned: { panel: returned.identity, tabs: returned.tabsIdentity } }
}

async function vodPicturePass(ctx) {
  await ctx.navigate(ctx.config.vodUrl)
  const currentPanel = await panel(ctx), wanted = ['00:19', '06:32', '03:41', '00:42', '06:49']
  await poll(ctx, async () => (await currentPanel.shadow.findElements(By.css('button.pulse-moment-row-button'))).length > 0, 'No indexed VOD moments')
  await showMore(currentPanel.shadow)
  const selected = await poll(ctx, async () => {
    const found = []
    for (const row of await currentPanel.shadow.findElements(By.css('button.pulse-moment-row-button'))) {
      const time = await rowTime(row); if (wanted.includes(time)) found.push({ time, row, image: await imageState(ctx, row, '.pmf-thumb img') })
    }
    return wanted.every(time => found.some(item => item.time === time && isActualScenePicture(item.image))) ? found : false
  }, 'Five original VOD moments did not all obtain scene thumbnails', 70_000)
  await scrollTo(ctx, selected.find(item => item.time === '06:49').row); await ctx.capture('pictures-vod', 'vod-five-scene-pictures')
  await selected.find(item => item.time === '00:19').row.click()
  const card = await poll(ctx, async () => {
    for (const card of await currentPanel.shadow.findElements(By.css('[data-selected-moment-card="true"]'))) if (isActualScenePicture(await imageState(ctx, card, '.pmf-pic img', true), 'card')) return card
    return false
  }, 'VOD card did not obtain a real Twitch VOD frame', 70_000)
  const expanded = await imageState(ctx, card, '.pmf-pic img', true)
  await scrollTo(ctx, card); await ctx.capture('pictures-vod', 'vod-selected-exact-frame')
  return { status: 'PASS', reason: 'Five original VOD moments have scene thumbnails, and an expanded card has exact Twitch VOD frame', url: ctx.config.vodUrl, identity: currentPanel.identity, pictures: selected.map(({ time, image }) => ({ time, ...image })), expanded }
}

async function exerciseAcceptance(ctx) {
  await ctx.navigate(ctx.config.url)
  let currentPanel
  await ctx.phase('C-build-id', async () => { currentPanel = await panel(ctx); return { status: 'PASS', reason: 'Both visible styled hosts match verified Firefox build, owner and target', identity: currentPanel.identity, tabs: currentPanel.tabsIdentity } })
  if (currentPanel) {
    await ctx.phase('C-refresh-0-90-180', () => refreshPass(ctx, currentPanel))
    await ctx.phase('pictures-live-row', () => livePicturePass(ctx, currentPanel))
    await ctx.phase('C-clip', () => clipPass(ctx, currentPanel))
  }
  await ctx.phase('pictures-vod', () => vodPicturePass(ctx))
}
