import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AcceptanceBlocked, REFRESH_TARGETS, parseAcceptanceArgs, validateAcceptanceUrl, isActualScenePicture,
  gradeRefreshSamples, classifyLookupLogs, gradeAcceptance, securityGate, runFirefoxAcceptance } from '../scripts/lib/firefox-live-acceptance.mjs'

const temporary: string[] = []
afterEach(() => {
  for (const dir of temporary.splice(0)) {
    expect(path.dirname(dir)).toBe(path.resolve(tmpdir()))
    expect(path.basename(dir).startsWith('sp-firefox-acceptance-')).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  }
})

function samples(values = [406, 123, 123, 370, 370, 350, 390]) {
  return REFRESH_TARGETS.map((targetSeconds, index) => ({ targetSeconds, elapsedSeconds: targetSeconds + 0.01, chatPerMin: values[index], focused: true, visibility: 'visible', live: true }))
}

const passingScreenshotAudit = () => ({ files: 1, assignments: 1, uniqueHashes: true, exactlyOnce: true, fullHashesMatch: true })
const screenshot = (value = 1) => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, value]).toString('base64')

describe('Finite Firefox acceptance grading', () => {
  it('does not pass a rate that changes early then stays unchanged through the final minute', () => {
    expect(gradeRefreshSamples(samples([10, 20, 30, 30, 30, 30, 30])).status).toBe('BLOCKED')
  })
  it('requires seven visible focused live observations with timely continued changes', () => {
    expect(gradeRefreshSamples(samples()).status).toBe('PASS')
    expect(gradeRefreshSamples(samples([123, 123, 123, 123, 123, 123, 123])).status).toBe('BLOCKED')
    expect(gradeRefreshSamples(samples().map((value, index) => ({ ...value, focused: index !== 2 }))).status).toBe('BLOCKED')
    expect(gradeRefreshSamples(samples().slice(0, 3)).status).toBe('BLOCKED')
  })

  it('distinguishes an expected permissions block from a real defect or cleanup failure', () => {
    expect(gradeAcceptance([{ status: 'PASS' }, { status: 'BLOCKED' }], {}, passingScreenshotAudit())).toEqual({ status: 'BLOCKED', exitCode: 2 })
    expect(gradeAcceptance([{ status: 'PASS' }], { driverQuit: { status: 'FAIL' } }, passingScreenshotAudit())).toEqual({ status: 'FAIL', exitCode: 1 })
    expect(gradeAcceptance([{ status: 'FAIL' }, { status: 'BLOCKED' }], {}, passingScreenshotAudit())).toEqual({ status: 'FAIL', exitCode: 1 })
    expect(gradeAcceptance([{ status: 'PASS' }], { driverQuit: { status: 'PASS' } }, passingScreenshotAudit())).toEqual({ status: 'PASS', exitCode: 0 })
  })

  it('makes every missing or failed screenshot audit override otherwise passing or blocked rows', () => {
    const rows = [{ status: 'PASS' }, { status: 'BLOCKED' }]
    for (const key of ['uniqueHashes', 'exactlyOnce', 'fullHashesMatch']) {
      expect(gradeAcceptance(rows, {}, { ...passingScreenshotAudit(), [key]: false })).toEqual({ status: 'FAIL', exitCode: 1 })
    }
    expect(gradeAcceptance(rows, {}, { ...passingScreenshotAudit(), files: 2 })).toEqual({ status: 'FAIL', exitCode: 1 })
    expect(gradeAcceptance(rows, {}, { ...passingScreenshotAudit(), errors: [{ error: 'Audit read failed' }] })).toEqual({ status: 'FAIL', exitCode: 1 })
    expect(gradeAcceptance(rows, {})).toEqual({ status: 'FAIL', exitCode: 1 })
  })

  it('does not count loaded game art/emotes or a captured-live chip as an exact VOD scene', () => {
    const image = { src: 'blob:https://www.twitch.tv/frame', complete: true, width: 640, height: 360, sourceLabel: 'Twitch VOD frame' }
    expect(isActualScenePicture(image, 'card')).toBe(true)
    for (const sourceLabel of ['VOD still recording · game art', 'No VOD · chat’s top emote', 'Captured while you watched']) {
      expect(isActualScenePicture({ ...image, sourceLabel }, 'card')).toBe(false)
    }
    expect(isActualScenePicture({ ...image, complete: false }, 'card')).toBe(false)
    expect(isActualScenePicture({ ...image, src: 'https://cdn.7tv.app/emote/x/2x.webp' })).toBe(false)
    expect(isActualScenePicture({ ...image, has: true, sourceLabel: '', src: 'https://d123.cloudfront.net/vod/storyboards/2902672687-high-0.jpg' })).toBe(true)
  })

  it('qualifies4000Kbps media substring matches while retaining real GQL/Client-ID errors', () => {
    const logs = [
      { level: 'error', text: 'Failed to load media https://video.twitch.tv/4000Kbps/segment.ts' },
      { level: 'error', text: 'POST https://gql.twitch.tv/gql HTTP400: The Client-ID header is invalid.' },
      { level: 'error', text: 'Request returned status401' },
    ]
    const result = classifyLookupLogs(logs)
    expect(result.rawMatches).toEqual([0, 1, 2])
    expect(result.identifiedErrors).toEqual([1, 2])
    expect(result.qualifiedMatches.map(item => item.index)).toEqual([0])
  })

  it('does not turn opaque source IDs or stack line numbers into HTTP errors', () => {
    const result = classifyLookupLogs([{ level: 'error', text: 'Unrelated player warning', source: { realm: 'abc-400-def' }, stackTrace: { callFrames: [{ lineNumber: 401 }] } }])
    expect(result.rawMatches).toEqual([])
    expect(result.identifiedErrors).toEqual([])
  })

  it('rejects internal/auth/foreign URLs and recognizes security gates without treating a normal Login header as a gate', () => {
    expect(validateAcceptanceUrl('https://www.twitch.tv/caedrel')).toContain('/caedrel')
    expect(validateAcceptanceUrl('https://www.twitch.tv/videos/2902672687', 'vod')).toContain('2902672687')
    for (const url of ['about:addons', 'moz-extension://uuid/options/index.html', 'https://www.twitch.tv/login', 'https://example.com/caedrel']) expect(() => validateAcceptanceUrl(url)).toThrow()
    expect(securityGate({ url: 'https://www.twitch.tv/caedrel', dialogText: '', loginFormVisible: false })).toBeNull()
    expect(securityGate({ url: 'https://www.twitch.tv/caedrel', challengeVisible: true })).toContain('no bypass')
    const args = ['--artifact', 'a.json', '--firefox', 'firefox.exe', '--evidence', 'new-evidence']
    expect(parseAcceptanceArgs(args).vodUrl).toContain('2902672687')
    expect(() => parseAcceptanceArgs([...args, '--headless', 'true'])).toThrow()
    expect(() => parseAcceptanceArgs([...args, '--mode', 'setup'])).toThrow()
  })
})

function fakeRun(options: { removeFailure?: boolean; quitFailure?: boolean; securityStop?: boolean } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'sp-firefox-acceptance-')); temporary.push(dir)
  const calls: string[] = []; let now = 0
  const addonId = 'streampulse@streampulse.stream'
  const caps = new Map([['browserName', 'firefox'], ['browserVersion', '158.0.1'], ['moz:headless', false], ['moz:profile', path.join(dir, 'rust_mozprofile-fake')]])
  const driver = { manage: () => ({ setTimeouts: async () => undefined }), getCapabilities: async () => caps,
    installAddon: async () => { calls.push('install'); return addonId },
    uninstallAddon: vi.fn(async id => { calls.push(`remove:${id}`); if (options.removeFailure) throw Error('Uninstall failed') }),
    quit: vi.fn(async () => { calls.push('quit'); if (options.quitFailure) throw Error('Quit failed') }),
    takeScreenshot: vi.fn(async () => screenshot()) }
  const dependencies = { createDriver: async () => driver,
    verifyArtifact: async () => ({ zipPath: path.join(dir, 'local.zip'), actualSha256: 'a'.repeat(64), addonId, buildId: 'dev-2e374f22f95b-clean', target: 'firefox', manifest: { permissions: ['storage', 'scripting'], host_permissions: ['https://*.twitch.tv/*'] } }),
    subscribeLogs: async () => { calls.push('logs'); return { removeListener: async () => calls.push('listener'), closeInspector: async () => calls.push('subscription'), closeBidi: async () => calls.push('socket') } },
    clock: { now: () => now, sleep: vi.fn(async ms => { now += ms }) }, profileExists: async () => false,
    exercise: async ctx => {
      if (options.securityStop) throw new AcceptanceBlocked('CAPTCHA; stopped without bypass', true)
      for (const id of ['C-build-id', 'C-refresh-0-90-180', 'C-clip', 'pictures-live-row', 'pictures-vod']) await ctx.phase(id, async () => ({ status: 'PASS', reason: 'Fake-driver lifecycle fixture' }))
      await ctx.capture('pictures-live-row', 'unit-lifecycle')
    } }
  return { dir, calls, driver, dependencies, config: { artifactPath: path.join(dir, 'artifact.json'), firefoxPath: 'not-launched-by-tests', evidenceDir: path.join(dir, 'evidence'), url: 'https://www.twitch.tv/caedrel', vodUrl: 'https://www.twitch.tv/videos/2902672687' } }
}

describe('Finite Firefox acceptance cleanup', () => {
  it('returns expected partial code2, writes evidence, and uninstalls/quits without stdin or a manual checkpoint', async () => {
    const f = fakeRun(); const run = await runFirefoxAcceptance(f.config, f.dependencies)
    expect(run.exitCode).toBe(2)
    expect(run.result.rows.find(row => row.id === 'C-permissions').status).toBe('BLOCKED')
    expect(run.result.rows.find(row => row.id === 'C-remove').status).toBe('PASS')
    expect(f.calls.indexOf('logs')).toBeLessThan(f.calls.indexOf('install'))
    expect(f.driver.uninstallAddon).toHaveBeenCalledExactlyOnceWith('streampulse@streampulse.stream')
    expect(f.driver.quit).toHaveBeenCalledOnce()
    expect(run.result.screenshotAudit).toMatchObject({ files: 1, assignments: 1, uniqueHashes: true, exactlyOnce: true, fullHashesMatch: true })
    expect(JSON.parse(readFileSync(run.evidencePath, 'utf8')).cleanup.profileRemoved.status).toBe('PASS')
  })

  it('preserves cleanup failures as exit1 and attempts all remaining cleanup', async () => {
    const f = fakeRun({ removeFailure: true, quitFailure: true }); const run = await runFirefoxAcceptance(f.config, f.dependencies)
    expect(run.exitCode).toBe(1)
    expect(run.result.cleanup.addonRemoval.status).toBe('FAIL')
    expect(run.result.cleanup.driverQuit.status).toBe('FAIL')
    expect(f.calls).toContain('subscription')
    expect(f.calls).toContain('socket')
    expect(f.driver.quit).toHaveBeenCalledOnce()
  })

  it('stops on a security gate, leaves unexercised checks blocked and still removes only its installation', async () => {
    const f = fakeRun({ securityStop: true }); const run = await runFirefoxAcceptance(f.config, f.dependencies)
    expect(run.exitCode).toBe(2)
    expect(run.result.error).toContain('CAPTCHA')
    expect(run.result.rows.find(row => row.id === 'C-clip').status).toBe('BLOCKED')
    expect(f.driver.uninstallAddon).toHaveBeenCalledExactlyOnceWith('streampulse@streampulse.stream')
    expect(f.driver.quit).toHaveBeenCalledOnce()
  })
})

describe('Firefox screenshot evidence integrity', () => {
  it('retries a duplicate capture and passes its phase only after saving a unique replacement', async () => {
    const f = fakeRun()
    f.driver.takeScreenshot.mockResolvedValueOnce(screenshot(1)).mockResolvedValueOnce(screenshot(1)).mockResolvedValueOnce(screenshot(2))
    f.dependencies.exercise = async ctx => {
      await ctx.phase('C-refresh-0-90-180', async () => {
        await ctx.capture('C-refresh-0-90-180', 'refresh-0s')
        await ctx.capture('C-refresh-0-90-180', 'refresh-90s')
        return { status: 'PASS', reason: 'Both required unique screenshots saved' }
      })
    }
    const run = await runFirefoxAcceptance(f.config, f.dependencies)
    const row = run.result.rows.find(item => item.id === 'C-refresh-0-90-180')
    expect(row.status).toBe('PASS')
    expect(row.screenshots).toHaveLength(2)
    expect(f.driver.takeScreenshot).toHaveBeenCalledTimes(3)
    expect(f.dependencies.clock.sleep).toHaveBeenCalledExactlyOnceWith(250)
    expect(run.result.events).toContainEqual(expect.objectContaining({ phase: 'duplicate-capture-retry', attempt: 1 }))
    expect(run.result.screenshotAudit).toMatchObject({ files: 2, assignments: 2, uniqueHashes: true, exactlyOnce: true, fullHashesMatch: true })
    expect(run.result.rows.find(item => item.id === 'C-permissions').status).toBe('BLOCKED')
  })

  it('blocks the affected phase after bounded duplicate retries without silently dropping its required image', async () => {
    const f = fakeRun()
    f.dependencies.exercise = async ctx => {
      await ctx.phase('C-refresh-0-90-180', async () => {
        await ctx.capture('C-refresh-0-90-180', 'refresh-0s')
        await ctx.capture('C-refresh-0-90-180', 'refresh-90s')
        return { status: 'PASS', reason: 'Must not be reached after capture exhaustion' }
      })
    }
    const run = await runFirefoxAcceptance(f.config, f.dependencies)
    const row = run.result.rows.find(item => item.id === 'C-refresh-0-90-180')
    expect(row.status).toBe('BLOCKED')
    expect(row.evidence).toContain('unique screenshot')
    expect(row.evidence).toContain('3 attempts')
    expect(row.screenshots).toHaveLength(1)
    expect(f.driver.takeScreenshot).toHaveBeenCalledTimes(4)
    expect(f.dependencies.clock.sleep).toHaveBeenCalledTimes(2)
    expect(run.exitCode).toBe(2)
    expect(f.driver.uninstallAddon).toHaveBeenCalledExactlyOnceWith('streampulse@streampulse.stream')
    expect(readFileSync(path.join(f.config.evidenceDir, 'REPORT.md'), 'utf8')).toContain('C-refresh-0-90-180 | BLOCKED')
  })

  it.each(['tampered', 'missing', 'unlisted'] as const)('persists a failed final report when a screenshot is %s', async failure => {
    const f = fakeRun()
    f.dependencies.exercise = async ctx => {
      const image = await ctx.capture('pictures-live-row', 'unit-integrity')
      await ctx.phase('pictures-live-row', async () => ({ status: 'PASS', reason: 'Browser observation completed before evidence changed' }))
      const saved = path.join(f.config.evidenceDir, image.name)
      if (failure === 'tampered') writeFileSync(saved, 'altered image bytes')
      else if (failure === 'missing') unlinkSync(saved)
      else writeFileSync(path.join(f.config.evidenceDir, 'unlisted.png'), Buffer.from(screenshot(2), 'base64'))
    }
    const run = await runFirefoxAcceptance(f.config, f.dependencies)
    expect(run.exitCode).toBe(1)
    expect(run.result.status).toBe('FAIL')
    expect(run.result.screenshotAudit.status).toBe('FAIL')
    if (failure === 'unlisted') expect(run.result.screenshotAudit.exactlyOnce).toBe(false)
    else {
      expect(run.result.screenshotAudit.fullHashesMatch).toBe(false)
      expect(run.result.screenshotAudit.errors).toContainEqual(expect.objectContaining({ name: '01-unit-integrity.png' }))
    }
    expect(JSON.parse(readFileSync(run.evidencePath, 'utf8')).screenshotAudit.status).toBe('FAIL')
    const report = readFileSync(path.join(f.config.evidenceDir, 'REPORT.md'), 'utf8')
    expect(report).toContain('# Firefox finite acceptance: FAIL')
    expect(report).toContain('Screenshot audit: FAIL')
    expect(run.result.cleanup.driverQuit.status).toBe('PASS')
    expect(run.result.rows.find(item => item.id === 'C-permissions').status).toBe('BLOCKED')
  })

  it('fails final grading when a saved image is assigned to two rows', async () => {
    const f = fakeRun()
    f.dependencies.exercise = async ctx => {
      const image = await ctx.capture('pictures-live-row', 'unit-assignment')
      ctx.row('pictures-vod').screenshots.push({ ...image })
    }
    const run = await runFirefoxAcceptance(f.config, f.dependencies)
    expect(run.exitCode).toBe(1)
    expect(run.result.screenshotAudit).toMatchObject({ status: 'FAIL', files: 1, assignments: 2, uniqueHashes: false, exactlyOnce: false })
    expect(JSON.parse(readFileSync(run.evidencePath, 'utf8')).status).toBe('FAIL')
  })
})
