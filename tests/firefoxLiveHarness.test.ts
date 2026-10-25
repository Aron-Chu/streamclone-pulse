import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { FIREFOX_ADDON_ID, parseHarnessArgs, verifyFirefoxArtifact, runFirefoxLiveHarness, createFirefoxDriver } from '../scripts/lib/firefox-live-harness.mjs'

const temporary: string[] = []
const manifest = JSON.parse(readFileSync(new URL('../manifests/firefox.json', import.meta.url), 'utf8'))
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

it('requires Node 24 at the real browser boundary before loading Selenium or launching Firefox', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process.versions, 'node')!
  vi.stubEnv('MOZ_REMOTE_ALLOW_SYSTEM_ACCESS', '0')
  try {
    Object.defineProperty(process.versions, 'node', { ...descriptor, value: '22.0.0' })
    await expect(createFirefoxDriver({ firefoxPath: 'not-launched.exe' })).rejects.toThrow('Node 24 or newer for a real Firefox session')
  } finally {
    Object.defineProperty(process.versions, 'node', descriptor)
    vi.unstubAllEnvs()
  }
})

it('refuses an inherited privileged Firefox environment before launching a browser', async () => {
  vi.stubEnv('MOZ_REMOTE_ALLOW_SYSTEM_ACCESS', '1')
  try {
    await expect(createFirefoxDriver({ firefoxPath: 'not-launched.exe' })).rejects.toThrow('system-access environment')
  } finally {
    vi.unstubAllEnvs()
  }
})
afterEach(() => {
  for (const dir of temporary.splice(0)) {
    expect(path.dirname(dir)).toBe(path.resolve(tmpdir()))
    expect(path.basename(dir).startsWith('sp-firefox-harness-test-')).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  }
})

function artifactFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'sp-firefox-harness-test-'))
  temporary.push(dir)
  const zipPath = path.join(dir, 'firefox-local.zip')
  // A fake driver consumes these bytes; full ZIP-content proof belongs to the artifact-preparation helper.
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])
  writeFileSync(zipPath, zip)
  const artifact = { schemaVersion: 1, localOnly: true, zipPath, sha256: createHash('sha256').update(zip).digest('hex'),
    buildId: 'dev-2e374f22f95b-clean', target: 'firefox', version: '0.2.2', addonId: FIREFOX_ADDON_ID,
    sourceRevision: '2e374f22f95b83041095e621c3462238b48cc522', manifest: structuredClone(manifest),
    zipEntries: ['manifest.json', 'extension-target.json', 'content/twitch.js', 'content/shadow.css', 'background/service-worker.js'],
    verification: { manifest: true, targetMetadata: true, bundleBuildId: true, provenance: true } }
  const artifactPath = path.join(dir, 'verified.json')
  writeFileSync(artifactPath, JSON.stringify(artifact))
  const firefoxPath = path.join(dir, 'firefox.exe')
  writeFileSync(firefoxPath, 'not launched by unit tests')
  return { dir, artifact, artifactPath, config: { artifactPath, firefoxPath, evidenceDir: path.join(dir, 'evidence'), mode: 'setup' } }
}

function fakeBrowser(options: { uninstallFails?: boolean; quitFails?: boolean; shadowUnsupported?: boolean; returnedId?: string } = {}) {
  const calls: string[] = []
  let onLog: (entry: unknown) => void = () => undefined
  let token = ''
  const child = { getText: async () => 'Closed shadow ready', isDisplayed: async () => true }
  const host = { getShadowRoot: async () => {
    if (options.shadowUnsupported) throw Object.assign(new Error('Closed roots not supported'), { name: 'UnsupportedOperationError' })
    return { findElement: async () => child }
  } }
  const caps = new Map([['browserName', 'firefox'], ['browserVersion', '158.0.1'], ['platformName', 'windows'],
    ['moz:profile', path.join(tmpdir(), 'rust_mozprofile-harness-fake')], ['moz:geckodriverVersion', '0.36.0'], ['moz:headless', false]])
  const driver = {
    manage: () => ({ setTimeouts: async () => undefined }), getCapabilities: async () => caps,
    installAddon: vi.fn(async (_zip: string, temporary: boolean) => { calls.push(`install:${temporary}`); return options.returnedId ?? FIREFOX_ADDON_ID }),
    uninstallAddon: vi.fn(async (id: string) => { calls.push(`remove:${id}`); if (options.uninstallFails) throw new Error('removal failed') }),
    quit: vi.fn(async () => { calls.push('quit'); if (options.quitFails) throw new Error('quit failed') }),
    get: vi.fn(async (url: string) => { calls.push(`navigate:${url}`); onLog({ text: token, type: 'console', level: 'info', timeStamp: 123, source: { browsingContextId: 'fixture', realmId: 'page' } }) }),
    wait: async (check: () => unknown) => { if (!await check()) throw new Error('condition not met') },
    findElement: async () => host, executeScript: async () => true, takeScreenshot: async () => png.toString('base64'),
  }
  const deps = {
    createDriver: vi.fn(async () => { calls.push('driver'); return driver }),
    subscribeLogs: async (_driver: unknown, listener: typeof onLog) => {
      calls.push('logs'); onLog = listener
      return { removeListener: async () => { calls.push('listener-closed') }, closeInspector: async () => { calls.push('subscription-closed') }, closeBidi: async () => { calls.push('socket-closed') } }
    },
    startFixture: async (value: string) => { token = value; return { url: 'http://127.0.0.1:12345/local-fixture', close: async () => { calls.push('fixture-closed') } } },
  }
  return { calls, driver, deps }
}

describe('Firefox harness input boundary', () => {
  it('defaults to setup and rejects personal profile, headless and privileged switches', () => {
    const args = ['--artifact', 'verified.json', '--firefox', 'firefox.exe', '--evidence', 'new-evidence']
    expect(parseHarnessArgs(args).mode).toBe('setup')
    for (const flag of ['--profile', '--profile-path', '--headless', '--allow-system-access', '--context', '--preference']) {
      expect(() => parseHarnessArgs([...args, flag, 'anything'])).toThrow(/Unsupported option/)
    }
    expect(() => parseHarnessArgs([...args, '--url', 'https://www.twitch.tv/caedrel'])).toThrow(/requires --mode live/)
    for (const url of ['https://www.twitch.tv/settings', 'https://example.com/caedrel']) {
      expect(() => parseHarnessArgs([...args, '--mode', 'live', '--url', url])).toThrow(/direct/)
    }
  })

  it('requires Firefox target, ID, local-only declaration and every proof', async () => {
    const f = artifactFixture()
    await expect(verifyFirefoxArtifact(f.artifactPath)).resolves.toMatchObject({ actualSha256: f.artifact.sha256 })
    for (const change of [{ target: 'chrome' }, { addonId: 'another@example.com' }, { localOnly: false },
      { verification: { ...f.artifact.verification, provenance: false } }, { manifest: { ...f.artifact.manifest, background: { service_worker: 'background/service-worker.js' } } }]) {
      writeFileSync(f.artifactPath, JSON.stringify({ ...f.artifact, ...change }))
      await expect(verifyFirefoxArtifact(f.artifactPath)).rejects.toThrow()
    }
  })

  it('rehashes ZIP bytes before creating a browser and records a mismatch', async () => {
    const f = artifactFixture()
    writeFileSync(f.artifact.zipPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 9]))
    const fake = fakeBrowser()
    const run = await runFirefoxLiveHarness(f.config, fake.deps)
    expect(run.exitCode).toBe(1)
    expect(run.result.error).toContain('SHA-256 mismatch')
    expect(fake.deps.createDriver).not.toHaveBeenCalled()
    expect(run.result.cleanup.addonRemoval.status).toBe('NOT_INSTALLED')
  })
})

describe('Firefox harness setup and cleanup evidence', () => {
  it('subscribes before temporary install, visits only its fixture, hashes PNG and removes exact ID', async () => {
    const f = artifactFixture(); const fake = fakeBrowser()
    const run = await runFirefoxLiveHarness(f.config, fake.deps)
    expect(run.exitCode).toBe(0)
    expect(run.result.status).toBe('PASS')
    expect(fake.calls.indexOf('logs')).toBeLessThan(fake.calls.indexOf('install:true'))
    expect(fake.driver.get).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:12345/local-fixture')
    expect(fake.driver.uninstallAddon).toHaveBeenCalledExactlyOnceWith(FIREFOX_ADDON_ID)
    expect(run.result.checks.closedShadow.status).toBe('PASS')
    expect(run.result.checks.logCapture.matchedEntries).toBe(1)
    expect(run.result.runtime).toMatchObject({ browserVersion: '158.0.1', geckodriverVersion: '0.36.0', headless: false })
    expect(run.result.screenshots[0].sha256).toBe(createHash('sha256').update(png).digest('hex'))
    expect(JSON.parse(readFileSync(run.evidencePath, 'utf8')).cleanup.driverQuit.status).toBe('PASS')
    expect(run.result.limitations.join(' ')).toContain('background-log coverage')
    expect(fake.calls).toContain('fixture-closed')
  })

  it('records unsupported closed shadow as incomplete and still cleans up', async () => {
    const f = artifactFixture(); const fake = fakeBrowser({ shadowUnsupported: true })
    const run = await runFirefoxLiveHarness(f.config, fake.deps)
    expect(run.exitCode).toBe(2)
    expect(run.result.status).toBe('INCOMPLETE')
    expect(run.result.checks.closedShadow.status).toBe('UNSUPPORTED')
    expect(fake.driver.uninstallAddon).toHaveBeenCalledOnce()
    expect(fake.driver.quit).toHaveBeenCalledOnce()
  })

  it('records removal/quit failures and attempts every remaining cleanup action', async () => {
    const f = artifactFixture(); const fake = fakeBrowser({ uninstallFails: true, quitFails: true })
    const run = await runFirefoxLiveHarness(f.config, fake.deps)
    expect(run.exitCode).toBe(1)
    expect(run.result.status).toBe('FAIL')
    expect(run.result.cleanup.addonRemoval).toMatchObject({ status: 'FAIL', addonId: FIREFOX_ADDON_ID })
    expect(run.result.cleanup.driverQuit.status).toBe('FAIL')
    expect(run.result.cleanup.logSubscription.status).toBe('PASS')
    expect(fake.calls).toContain('fixture-closed')
    expect(JSON.parse(readFileSync(run.evidencePath, 'utf8')).cleanup.addonRemoval.error).toContain('removal failed')
  })

  it('rejects an unexpected install ID but cleans only the returned installation', async () => {
    const f = artifactFixture(); const fake = fakeBrowser({ returnedId: 'unexpected-local-addon@example.com' })
    const run = await runFirefoxLiveHarness(f.config, fake.deps)
    expect(run.exitCode).toBe(1)
    expect(run.result.checks.temporaryInstall.status).toBe('FAIL')
    expect(fake.driver.uninstallAddon).toHaveBeenCalledExactlyOnceWith('unexpected-local-addon@example.com')
    expect(fake.driver.quit).toHaveBeenCalledOnce()
  })
})
