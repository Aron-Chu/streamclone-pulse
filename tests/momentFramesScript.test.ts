import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { MESSAGE_SENDER_SCOPE } from '../src/background/pulseBroadcastTargets.ts'
import { MOMENT_FRAMES_SCRIPT_FILE, injectMomentFrames } from '../src/background/momentFramesScript.ts'
import { parseBackgroundRequest } from '../src/shared/parseBackgroundRequest.ts'
import { contentScriptModules } from './helpers/contentGraph.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tab = { id: 42 } as chrome.tabs.Tab

/**
 * Moment pictures: the worker injects one fixed script into the asking Twitch
 * frame, only while the setting is on. Capture and drawing live there, never
 * in the size-gated content script.
 */
describe('Moment pictures script', () => {
  it('injects the fixed script into the sender’s tab and frame, in the isolated world', async () => {
    const executeScript = vi.fn().mockResolvedValue([])
    expect(await injectMomentFrames({ executeScript }, { id: 'ext', frameId: 0, tab }, async () => true)).toBe(true)
    expect(executeScript).toHaveBeenCalledWith({ target: { tabId: 42, frameIds: [0] }, world: 'ISOLATED', files: ['content/moment-frames.js'] })
    expect(MOMENT_FRAMES_SCRIPT_FILE).toBe('content/moment-frames.js')
  })

  it('injects nothing while Moment pictures is off, or when the setting cannot be read', async () => {
    const executeScript = vi.fn().mockResolvedValue([])
    expect(await injectMomentFrames({ executeScript }, { id: 'ext', frameId: 0, tab }, async () => false)).toBe(false)
    expect(await injectMomentFrames({ executeScript }, { id: 'ext', frameId: 0, tab }, () => Promise.reject(new Error('storage')))).toBe(false)
    expect(await injectMomentFrames({ executeScript }, { id: 'ext' }, async () => true)).toBe(false)
    expect(executeScript).not.toHaveBeenCalled()
  })

  it('reports a failed injection instead of throwing', async () => {
    const executeScript = vi.fn().mockRejectedValue(new Error('Cannot access contents of the page'))
    expect(await injectMomentFrames({ executeScript }, { id: 'ext', frameId: 0, tab }, async () => true)).toBe(false)
  })

  it('takes no file, tab or frame from the caller', () => {
    expect(parseBackgroundRequest({ type: 'MOMENT_FRAMES_SCRIPT' })).toEqual({ type: 'MOMENT_FRAMES_SCRIPT' })
    for (const extra of [{ files: ['evil.js'] }, { tabId: 1 }, { frameId: 3 }, { world: 'MAIN' }]) {
      expect(parseBackgroundRequest({ type: 'MOMENT_FRAMES_SCRIPT', ...extra })).toBeNull()
    }
    expect(MESSAGE_SENDER_SCOPE.MOMENT_FRAMES_SCRIPT).toBe('twitch-any')
  })

  it('the content script reaches capture and drawing only through the injected script', () => {
    const graph = contentScriptModules()
    expect(graph).toContain('src/ui/momentPicture.ts')
    expect(graph.filter(file => file === 'src/content/momentFrames.ts' || file === 'src/content/momentFrameStore.ts')).toEqual([])
  })

  it('in a build, the frames script is self-contained and twitch.js carries only the slots', () => {
    const contentBundle = resolve(root, 'dist/content/twitch.js')
    // Unit tests run before `npm run build` in CI; with no build there is nothing to inspect.
    if (!existsSync(contentBundle)) return
    const framesBundle = resolve(root, 'dist/content/moment-frames.js')
    expect(existsSync(framesBundle), 'dist/content/moment-frames.js is missing from a build that has twitch.js').toBe(true)
    const content = readFileSync(contentBundle, 'utf8')
    const frames = readFileSync(framesBundle, 'utf8')
    for (const marker of ['Captured while you watched', 'video-ad-label', 'toBlob']) {
      expect(content.includes(marker), `twitch.js must not contain ${marker}`).toBe(false)
      expect(frames.includes(marker), `moment-frames.js must contain ${marker}`).toBe(true)
    }
    expect(content).toContain('MOMENT_FRAMES_SCRIPT')
    expect(content).toContain('pmf-thumb')
    expect(frames).not.toMatch(/\bimport\s*\(|\bfrom\s*['"]|chunks\//)
  })
})
