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

describe('Supporter card stays out of the Twitch content script', () => {
  it('the content script reaches no lab-port module at run time, only the card contract’s types', () => {
    const graph = contentScriptModules()
    expect(graph).toContain('src/ui/PulseSettingsPanel.tsx')
    expect(graph).toContain('src/content/bridge.ts')
    const lab = graph.filter(file => file.startsWith('src/supporter/') || file === 'src/content/supporterCard.ts')
    expect(lab).toEqual([])
  })

  it('in a build, twitch.js carries only the loader and content/supporter-card.js carries the stage', () => {
    // Unit tests run before `npm run build` in CI; with no build there is nothing to inspect.
    if (!existsSync(contentBundle)) {
      expect(existsSync(contentBundle)).toBe(false)
      return
    }
    expect(existsSync(cardBundle), 'dist/content/supporter-card.js is missing from a build that has twitch.js').toBe(true)
    const content = readFileSync(contentBundle, 'utf8')
    const card = readFileSync(cardBundle, 'utf8')
    // The stage's own code and data: the Crown pile's class names and emote IDs.
    for (const marker of ['spk-body', 'spk-tag', 'spk-you', '01J7VZYB08000E8DPG2XYMKQYR', '01HMM8VG3R0007GXBD883VP2YY']) {
      expect(content.includes(marker), `twitch.js must not contain ${marker}`).toBe(false)
      expect(card.includes(marker), `supporter-card.js must contain ${marker}`).toBe(true)
    }
    // The content script's side: the stage slot and the one message that loads the card script.
    expect(content).toContain('pulse-supporter-stage')
    expect(content).toContain('SUPPORTER_CARD_SCRIPT')
    expect(content).toContain('__pulseSupporterCard')
    expect(card).toContain('__pulseSupporterCard')
    // The card draws no chat column: the old "Your Line" chat stack is gone from both scripts.
    for (const gone of ['spk-chat', 'spk-cl', 'that peak was mine']) {
      expect(content.includes(gone), `twitch.js must not contain ${gone}`).toBe(false)
      expect(card.includes(gone), `supporter-card.js must not contain ${gone}`).toBe(false)
    }
    // The dropped signature perk: neither script reads its old storage key.
    expect(content.includes('supporterSignatureEmote')).toBe(false)
    expect(card.includes('supporterSignatureEmote')).toBe(false)
    // Self-contained: no imports or chunk loads, nothing exposed to pages.
    expect(card).not.toMatch(/\bimport\s*\(|\bfrom\s*['"]|chunks\//)
    const manifest = JSON.parse(readFileSync(resolve(root, 'dist/manifest.json'), 'utf8')) as { web_accessible_resources?: Array<{ resources: string[] }> }
    expect(manifest.web_accessible_resources?.flatMap(entry => entry.resources)).toEqual(['content/shadow.css'])
  })
})
