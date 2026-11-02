import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test, expect, chromium, type BrowserContext } from '@playwright/test'
import { build, loadConfigFromFile, type Plugin } from 'vite'

// Opt in with PULSE_CONSENT_BROWSER_E2E=1; requires installed Chrome and Edge.
// Each run uses a disposable profile and blocks DNS; no user profile is loaded.
const root = process.cwd()
const consentKey = 'pulse-analytics-consent-v1'
const probeKey = '__test_analytics_probe'

/** Copy the normal development build and replace only its entry/chunk graph
 * with a test-only in-memory Vite build. Nothing writes to the release dist. */
async function makeEnabledTestExtension(destination: string, options?: { localBackend?: boolean }): Promise<string> {
  await fs.cp(path.join(root, 'dist'), destination, { recursive: true })
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(root, 'vite.config.ts'))
  if (!loaded) throw new Error('Missing extension Vite configuration')
  let switched = false
  const testSwitch: Plugin = {
    name: 'test-enable-analytics-in-memory',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/shared/extensionAnalytics.ts')) return
      const original = 'export const EXTENSION_ANALYTICS_INGEST_ENABLED = false'
      if (!code.includes(original)) throw new Error('Expected disabled analytics switch')
      switched = true
      const enabled = code.replace(original, 'export const EXTENSION_ANALYTICS_INGEST_ENABLED = true')
      if (options?.localBackend) return enabled
      const start = enabled.indexOf('async function defaultTransport(')
      const end = enabled.indexOf('/**\n * Emit allowlisted', start)
      if (start < 0 || end < 0) throw new Error('Expected analytics transport boundary')
      const localTransport = `
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
      return enabled.slice(0, start) + localTransport + enabled.slice(end)
    },
  }
  const config = loaded.config
  const configuredPlugins = (config.plugins ?? []) as unknown[]
  const plugins = configuredPlugins.flat(Infinity).filter(plugin =>
    plugin && typeof plugin === 'object' && 'name' in plugin && plugin.name !== 'streamclone-pulse-extension',
  ) as Plugin[]
  const output = await build({
    ...config, root, configFile: false, logLevel: 'silent',
    plugins: [testSwitch, ...plugins],
    build: { ...config.build, write: false, emptyOutDir: false },
  })
  if (!switched) throw new Error('Test-only switch transform did not run')
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
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>
  manifest.name = 'TEST ONLY - StreamPulse analytics consent'
  if (options?.localBackend) {
    // This fixture can reach only the explicitly supplied loopback service.
    manifest.host_permissions = ['http://127.0.0.1/*']
    manifest.optional_host_permissions = []
  }
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  // A quiet extension-owned page can send worker messages without a settings
  // component opening a new grant flow during lifecycle tests.
  await fs.writeFile(path.join(destination, 'consent-lifecycle-probe.html'), '<!doctype html><title>Test-only consent probe</title>')
  return destination
}

async function removeTestDirectory(directory: string): Promise<void> {
  const base = await fs.realpath(os.tmpdir())
  const target = await fs.realpath(directory)
  const normalized = (value: string) => process.platform === 'win32' ? path.normalize(value).toLowerCase() : path.normalize(value)
  if (normalized(path.dirname(target)) !== normalized(base) || !path.basename(target).startsWith('sp64-consent-')) {
    throw new Error('Refusing to remove a directory outside the isolated test root')
  }
  await fs.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

async function launchTestExtension(channel: 'chrome' | 'msedge', extensionPath: string, profile: string): Promise<{ context: BrowserContext; id: string }> {
  const context = await chromium.launchPersistentContext(profile, {
    channel,
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--enable-unsafe-extension-debugging',
      '--disable-background-networking',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    ],
  })
  try {
    const browser = context.browser()
    if (!browser) throw new Error('Missing isolated browser handle')
    console.log(`Isolated ${channel} version ${browser.version()}`)
    const session = await browser.newBrowserCDPSession()
    let id: string
    try {
      const loaded = await session.send('Extensions.loadUnpacked', { path: extensionPath.split(path.sep).join('/') }) as { id?: string }
      if (!loaded.id) throw new Error('Browser did not return the test extension ID')
      id = loaded.id
    } finally {
      await session.detach()
    }
    return { context, id }
  } catch (error) {
    await context.close()
    throw error
  }
}

test('local-backend: real extension transport reaches only the disposable backend', async () => {
  const backend = process.env.PULSE_ANALYTICS_LOCAL_E2E_URL
  test.skip(!backend, 'Requires the opt-in loopback backend integration harness')
  const url = new URL(backend!)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Integration backend must be an explicit loopback HTTP origin')
  }
  const channel = process.env.PULSE_ANALYTICS_LOCAL_E2E_BROWSER
  if (channel !== 'chrome' && channel !== 'msedge') throw new Error('Select chrome or msedge for the isolated test')
  const nonce = process.env.PULSE_ANALYTICS_LOCAL_E2E_NONCE
  if (!nonce || !/^[0-9a-f-]{36}$/i.test(nonce)) throw new Error('Missing loopback fixture nonce')
  const counts = async () => {
    const response = await fetch(new URL('/__test/accepted', url))
    if (!response.ok) throw new Error(`Loopback test status ${response.status}`)
    const state = await response.json() as { accepted: number; attempted: number; fixture: string; nonce: string }
    if (state.fixture !== 'streampulse-analytics-local-e2e' || state.nonce !== nonce) throw new Error('Wrong loopback fixture')
    return { accepted: state.accepted, attempted: state.attempted }
  }
  expect(await counts()).toEqual({ accepted: 0, attempted: 0 })
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sp64-consent-'))
  let context: BrowserContext | undefined
  try {
    const extensionPath = await makeEnabledTestExtension(path.join(directory, 'TEST-ONLY-extension'), { localBackend: true })
    const launched = await launchTestExtension(channel, extensionPath, path.join(directory, 'profile'))
    context = launched.context
    const page = await context.newPage()
    await page.goto(`chrome-extension://${launched.id}/options/index.html#privacy`)
    expect(await page.evaluate(() => chrome.runtime.getManifest().name)).toBe('TEST ONLY - StreamPulse analytics consent')
    await page.evaluate(async origin => chrome.storage.sync.set({ backendUrl: origin, localBackendOptIn: true }), url.origin)
    expect(await page.evaluate(async () => (await chrome.storage.sync.get('backendUrl')).backendUrl)).toBe(url.origin)
    const toggle = page.getByRole('checkbox', { name: 'Share anonymous product usage' })
    await expect(toggle).not.toBeChecked()
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'EMIT_EXTENSION_ANALYTICS', name: 'pulse_load_completed' }))
    await page.waitForTimeout(250)
    expect(await counts()).toEqual({ accepted: 0, attempted: 0 })
    await toggle.check()
    await expect.poll(() => page.evaluate(async key => (await chrome.storage.local.get(key))[key]?.granted, consentKey)).toBe(true)
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'EMIT_EXTENSION_ANALYTICS', name: 'pulse_load_completed' }))
    await expect.poll(counts).toEqual({ accepted: 1, attempted: 1 })
    await toggle.uncheck()
    await expect.poll(() => page.evaluate(async key => (await chrome.storage.local.get(key))[key] ?? null, consentKey)).toBeNull()
    await page.evaluate(() => chrome.runtime.sendMessage({ type: 'EMIT_EXTENSION_ANALYTICS', name: 'pulse_load_completed' }))
    await page.waitForTimeout(250)
    expect(await counts()).toEqual({ accepted: 1, attempted: 1 })
  } finally {
    try { await context?.close() } finally { await removeTestDirectory(directory) }
  }
})

for (const channel of ['chrome', 'msedge'] as const) {
  test(`${channel}: grant tickets survive worker termination but a withdrawal revokes them`, async () => {
    test.skip(process.env.PULSE_CONSENT_BROWSER_E2E !== '1', 'Opt in to isolated branded-browser consent checks')
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sp64-consent-'))
    let context: BrowserContext | undefined
    try {
      const extensionPath = await makeEnabledTestExtension(path.join(directory, 'TEST-ONLY-extension'))
      const launched = await launchTestExtension(channel, extensionPath, path.join(directory, 'profile'))
      context = launched.context
      const browser = context.browser()
      if (!browser) throw new Error('Missing isolated browser handle')
      const page = await context.newPage()
      await page.goto(`chrome-extension://${launched.id}/consent-lifecycle-probe.html`)
      expect(await page.evaluate(() => chrome.runtime.getManifest().name)).toBe('TEST ONLY - StreamPulse analytics consent')
      const session = await browser.newBrowserCDPSession()
      try {
        const workerId = async () => {
          const { targetInfos } = await session.send('Target.getTargets')
          return targetInfos.find(target => target.type === 'service_worker' && target.url.startsWith(`chrome-extension://${launched.id}/`))?.targetId
        }
        const runningWorker = async () => {
          await expect.poll(() => context!.serviceWorkers().some(worker => worker.url().startsWith(`chrome-extension://${launched.id}/`))).toBe(true)
          const worker = context!.serviceWorkers().find(candidate => candidate.url().startsWith(`chrome-extension://${launched.id}/`))
          if (!worker) throw new Error('Test extension worker disappeared')
          return worker
        }
        const stopWorker = async () => {
          const worker = await runningWorker()
          await worker.evaluate(() => { Reflect.set(globalThis, '__sp64_lifecycle_marker', true) })
          await expect.poll(workerId).toBeTruthy()
          const id = await workerId()
          if (!id) throw new Error('Test extension worker target disappeared')
          expect((await session.send('Target.closeTarget', { targetId: id })).success).toBe(true)
          await expect.poll(workerId).toBeUndefined()
        }
        const prepare = () => page.evaluate(() => chrome.runtime.sendMessage({ type: 'PREPARE_ANALYTICS_CONSENT_GRANT' }))
        const grant = (grantTicket: string) => page.evaluate(ticket => chrome.runtime.sendMessage({ type: 'SET_ANALYTICS_CONSENT', granted: true, grantTicket: ticket }), grantTicket)
        const first = await prepare()
        expect(first.ok).toBe(true)
        expect(typeof first.grantTicket).toBe('string')
        await stopWorker()
        expect((await grant(first.grantTicket)).ok).toBe(true)
        await expect.poll(workerId).toBeTruthy()
        expect(await (await runningWorker()).evaluate(() => Reflect.has(globalThis, '__sp64_lifecycle_marker'))).toBe(false)
        expect((await page.evaluate(async key => (await chrome.storage.local.get(key))[key], consentKey))?.granted).toBe(true)

        const pending = await prepare()
        expect(pending.ok).toBe(true)
        expect((await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SET_ANALYTICS_CONSENT', granted: false }))).ok).toBe(true)
        await stopWorker()
        expect(await grant(pending.grantTicket)).toEqual({ ok: false, error: 'analytics_consent_superseded' })
        await expect.poll(workerId).toBeTruthy()
        expect(await (await runningWorker()).evaluate(() => Reflect.has(globalThis, '__sp64_lifecycle_marker'))).toBe(false)
        expect(await page.evaluate(async key => (await chrome.storage.local.get(key))[key] ?? null, consentKey)).toBeNull()

        const fresh = await prepare()
        expect(fresh.ok).toBe(true)
        expect((await grant(fresh.grantTicket)).ok).toBe(true)
      } finally {
        await session.detach()
      }
    } finally {
      try { await context?.close() } finally { await removeTestDirectory(directory) }
    }
  })

  test(`${channel}: withdrawal cancels a pending analytics request and updates another settings page`, async () => {
    test.skip(process.env.PULSE_CONSENT_BROWSER_E2E !== '1', 'Opt in to isolated branded-browser consent checks')
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sp64-consent-'))
    let context: BrowserContext | undefined
    try {
      const extensionPath = await makeEnabledTestExtension(path.join(directory, 'TEST-ONLY-extension'))
      console.log('Test-only extension built')
      const profile = path.join(directory, 'profile')
      const launched = await launchTestExtension(channel, extensionPath, profile)
      context = launched.context
      const id = launched.id
      console.log('Isolated browser loaded the test extension')
      const first = await context.newPage()
      first.on('pageerror', error => console.log(`Test settings error: ${error.message}`))
      await first.goto(`chrome-extension://${id}/options/index.html#privacy`)
      console.log('First settings page opened')
      expect(await first.evaluate(() => chrome.runtime.getManifest().name)).toBe('TEST ONLY - StreamPulse analytics consent')
      console.log('Test extension identity verified')
      const second = await context.newPage()
      await second.goto(`chrome-extension://${id}/options/index.html#privacy`)
      console.log('Settings pages opened')
      const firstToggle = first.getByRole('checkbox', { name: 'Share anonymous product usage' })
      const secondToggle = second.getByRole('checkbox', { name: 'Share anonymous product usage' })
      await expect(firstToggle).not.toBeChecked()
      await firstToggle.check()
      console.log('Consent selected in first settings page')
      await expect(secondToggle).toBeChecked()
      await expect.poll(() => first.evaluate(async key => (await chrome.storage.local.get(key))[key]?.granted, consentKey)).toBe(true)

      await first.evaluate(() => chrome.runtime.sendMessage({ type: 'EMIT_EXTENSION_ANALYTICS', name: 'pulse_load_completed' }))
      console.log('Synthetic analytics message dispatched')
      await expect.poll(() => first.evaluate(async key => (await chrome.storage.local.get(key))[key]?.calls?.length, probeKey)).toBe(1)
      expect(await first.evaluate(async key => (await chrome.storage.local.get(key))[key]?.calls?.[0]?.body, probeKey))
        .toEqual({ events: [{ name: 'pulse_load_completed' }] })

      await secondToggle.uncheck()
      console.log('Consent withdrawn in second settings page')
      await expect(firstToggle).not.toBeChecked()
      await expect.poll(() => first.evaluate(async key => (await chrome.storage.local.get(key))[key]?.calls?.[0]?.aborted, probeKey)).toBe(true)
      await expect.poll(() => first.evaluate(async key => (await chrome.storage.local.get(key))[key] ?? null, consentKey)).toBeNull()
      await first.evaluate(() => chrome.runtime.sendMessage({ type: 'EMIT_EXTENSION_ANALYTICS', name: 'pulse_load_completed' }))
      await first.waitForTimeout(250)
      expect(await first.evaluate(async key => (await chrome.storage.local.get(key))[key]?.calls?.length, probeKey)).toBe(1)
      await first.reload()
      await expect(first.getByRole('checkbox', { name: 'Share anonymous product usage' })).not.toBeChecked()
      await context.close()
      const restarted = await launchTestExtension(channel, extensionPath, profile)
      context = restarted.context
      const afterRestart = await context.newPage()
      await afterRestart.goto(`chrome-extension://${restarted.id}/options/index.html#privacy`)
      await expect(afterRestart.getByRole('checkbox', { name: 'Share anonymous product usage' })).not.toBeChecked()
      expect(await afterRestart.evaluate(async key => (await chrome.storage.local.get(key))[key] ?? null, consentKey)).toBeNull()
      console.log('Withdrawal persisted after isolated browser restart')
    } finally {
      try { await context?.close() } finally { await removeTestDirectory(directory) }
    }
  })

  test(`${channel}: the normal disabled build refuses a consent grant`, async () => {
    test.skip(process.env.PULSE_CONSENT_BROWSER_E2E !== '1', 'Opt in to isolated branded-browser consent checks')
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sp64-consent-'))
    let context: BrowserContext | undefined
    try {
      const extensionPath = path.join(directory, 'TEST-ONLY-default-extension')
      await fs.cp(path.join(root, 'dist'), extensionPath, { recursive: true })
      const manifestPath = path.join(extensionPath, 'manifest.json')
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>
      manifest.name = 'TEST ONLY - StreamPulse default-off consent'
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
      const launched = await launchTestExtension(channel, extensionPath, path.join(directory, 'profile'))
      context = launched.context
      const page = await context.newPage()
      await page.goto(`chrome-extension://${launched.id}/options/index.html#privacy`)
      await expect(page.getByRole('checkbox', { name: 'Share anonymous product usage' })).toHaveCount(0)
      const response = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'SET_ANALYTICS_CONSENT', granted: true }))
      expect(response).toEqual({ ok: false, error: 'analytics_disabled' })
      expect(await page.evaluate(async key => (await chrome.storage.local.get(key))[key] ?? null, consentKey)).toBeNull()
    } finally {
      try { await context?.close() } finally { await removeTestDirectory(directory) }
    }
  })
}
