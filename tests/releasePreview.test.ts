import releaseNotes from '../src/shared/release-notes.json'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { selectExtensionReleasePreview } from '../scripts/release-preview.ts'

describe('extension release preview', () => {
  it('selects exactly three non-empty bullets from the canonical current release', () => {
    const preview = selectExtensionReleasePreview(releaseNotes)
    expect(preview.version).toBe(releaseNotes.currentVersion)
    expect(preview.title).toBeTruthy()
    expect(preview.bullets).toHaveLength(3)
    expect(preview.bullets.every(Boolean)).toBe(true)
  })

  it('caps an oversized preview and fails closed when fewer than three bullets exist', () => {
    expect(selectExtensionReleasePreview({
      currentVersion: '1.0.0',
      releases: [{ version: '1.0.0', title: 'Current', preview: ['One', 'Two', 'Three', 'Four'] }],
    }).bullets).toEqual(['One', 'Two', 'Three'])
    expect(() => selectExtensionReleasePreview({
      currentVersion: '1.0.0',
      releases: [{ version: '1.0.0', title: 'Current', preview: ['One', 'Two'] }],
    })).toThrow(/exactly three preview bullets/)
  })

  it('keeps the complete changelog and its component out of the Twitch panel source', () => {
    const source = readFileSync(new URL('../src/ui/PulseSettingsPanel.tsx', import.meta.url), 'utf8')
    expect(source).not.toMatch(/release-notes\.json|releaseManifest|ChangelogCard/)
  })
})
