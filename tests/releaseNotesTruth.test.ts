import { describe, expect, it } from 'vitest'
import releaseNotes from '../src/shared/release-notes.json'
import { evaluateReleaseNotesGate } from '../scripts/lib/release-notes-gate.mjs'
import { selectExtensionReleasePreview } from '../scripts/release-preview.ts'
import { releaseLifecycleLabel } from '../src/ui/ChangelogCard.tsx'

/**
 * Release review 2026-10-09 (A-4): the 0.2.2 notes describe what ships, the
 * store packager accepts them, and the changelog labels say which versions the
 * Chrome Web Store published.
 */
type Entry = { version: string; status: string; releasedAt: string | null; title: string; summary: string; preview?: string[]; new?: string[]; changed?: string[]; improved?: string[]; fixed?: string[]; knownIssues?: string[] }
const releases = releaseNotes.releases as Entry[]
const entry = (version: string) => releases.find(release => release.version === version)!
const text = (release: Entry) => [release.title, release.summary, ...(release.preview ?? []), ...(release.new ?? []), ...(release.changed ?? []), ...(release.improved ?? []), ...(release.fixed ?? []), ...(release.knownIssues ?? [])].join('\n')

describe('0.2.2 release notes', () => {
  it('pass the store packaging gate', () => {
    const gate = evaluateReleaseNotesGate({ notes: releaseNotes, version: '0.2.2', storeTarget: true })
    expect(gate.failures).toEqual([])
    expect(gate.publishable).toBe(true)
    expect(entry('0.2.2')).toMatchObject({ status: 'released', releasedAt: '2026-10-14' })
  })

  it('describe no sign-in, device code or account flow this build does not have', () => {
    const notes = text(entry('0.2.2'))
    for (const gone of [/device code/i, /website sign-in/i, /installation account/i, /credential/i, /recovery/i, /approve this extension/i, /fixed (place|card)/i, /thirty minutes/i, /Become a Supporter opens/i]) {
      expect(notes, String(gone)).not.toMatch(gone)
    }
    expect(entry('0.2.2').knownIssues).toContain('Accounts and Supporter sign-ups are not open yet. Accounts are coming with Continue with Twitch.')
  })

  it('say plainly that the 7TV header backdrop moved to Supporter', () => {
    expect(entry('0.2.2').changed?.[0]).toMatch(/^The 7TV header backdrop \(emote rain: Still or Rain behind the panel header\) moved from free to Supporter\./)
    expect(entry('0.2.2').summary).toContain('The 7TV header backdrop is now a Supporter perk')
    expect(entry('0.2.2').preview).toContain('The 7TV header backdrop moved to Supporter (not open yet).')
  })

  it('name the Supporter perks from the one perk list', async () => {
    const perks = (await import('../src/shared/supporter-perks.json')).default
    const supporterLine = entry('0.2.2').new!.find(line => line.startsWith('A Supporter preview'))!
    for (const name of perks.names) expect(supporterLine.toLowerCase()).toContain(name.toLowerCase())
  })

  it('keep the quick-settings preview no larger than 0.2.2 shipped before, for the content-script budget', () => {
    const preview = selectExtensionReleasePreview(releaseNotes)
    expect([preview.title, ...preview.bullets].join('').length).toBeLessThanOrEqual(271)
  })
})

describe('changelog labels', () => {
  it('marks 0.2.1, the version on the Chrome Web Store since Aug 31, released', () => {
    expect(entry('0.2.1')).toMatchObject({ status: 'released', releasedAt: '2026-08-31' })
  })

  it('says Installed, Released or Not published, never Preview', () => {
    expect(releaseLifecycleLabel({ status: 'released' }, true)).toBe('Installed')
    expect(releaseLifecycleLabel({ status: 'released' }, false)).toBe('Released')
    expect(releaseLifecycleLabel({ status: 'unreleased' }, false)).toBe('Not published')
    expect(releases.filter(release => release.status !== 'released').map(release => release.version)).toEqual(['0.1.0'])
  })
})
