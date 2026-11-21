import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contentScriptModules } from './helpers/contentGraph.ts'

/**
 * The Supporter card's stage (the design lab port) must never ship in the
 * size-gated Twitch content script: it lives in content/supporter-card.js,
 * which the worker injects only when the card is shown.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const contentBundle = resolve(root, 'dist/content/twitch.js')
const cardBundle = resolve(root, 'dist/content/supporter-card.js')
// Quick settings, which shows the card, is itself injected (tests/quickSettings.test.ts).
const viewBundle = resolve(root, 'dist/content/quick-settings.js')

describe('Supporter card stays out of the Twitch content script', () => {
  it('the content script reaches no lab-port module at run time, only the card contract’s types', () => {
    const graph = contentScriptModules()
    expect(graph).toContain('src/content/bridge.ts')
    const lab = graph.filter(file => file.startsWith('src/supporter/') || file === 'src/content/supporterCard.ts')
    expect(lab).toEqual([])
  })

  it('in a build, quick-settings.js carries only the loader and content/supporter-card.js carries the stage', () => {
    // Unit tests run before `npm run build` in CI; with no build there is nothing to inspect.
    if (!existsSync(contentBundle)) {
      expect(existsSync(contentBundle)).toBe(false)
      return
    }
    expect(existsSync(cardBundle), 'dist/content/supporter-card.js is missing from a build that has twitch.js').toBe(true)
    const content = readFileSync(contentBundle, 'utf8')
    const card = readFileSync(cardBundle, 'utf8')
    const view = readFileSync(viewBundle, 'utf8')
    // The stage's own code and data: class names, emote IDs, canned lines, labels, crest stage names.
    for (const marker of ['spk-chat', '01J7VZYB08000E8DPG2XYMKQYR', '01HMM8VG3R0007GXBD883VP2YY', 'that peak was mine', 'Year-one crest', 'only you see this']) {
      expect(content.includes(marker), `twitch.js must not contain ${marker}`).toBe(false)
      expect(view.includes(marker), `quick-settings.js must not contain ${marker}`).toBe(false)
      expect(card.includes(marker), `supporter-card.js must contain ${marker}`).toBe(true)
    }
    // Quick settings' side: the stage slot and the one message that loads the card script.
    expect(view).toContain('pulse-supporter-stage')
    expect(view).toContain('SUPPORTER_CARD_SCRIPT')
    expect(view).toContain('__pulseSupporterCard')
    expect(card).toContain('__pulseSupporterCard')
    // The dropped signature perk: no script reads its old storage key.
    for (const script of [content, view, card]) expect(script.includes('supporterSignatureEmote')).toBe(false)
    // Self-contained: no imports or chunk loads, nothing exposed to pages.
    expect(card).not.toMatch(/\bimport\s*\(|\bfrom\s*['"]|chunks\//)
    const manifest = JSON.parse(readFileSync(resolve(root, 'dist/manifest.json'), 'utf8')) as { web_accessible_resources?: Array<{ resources: string[] }> }
    expect(manifest.web_accessible_resources?.flatMap(entry => entry.resources)).toEqual(['content/shadow.css'])
  })
})
