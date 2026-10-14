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
  it('stay unreleased, with no date, until the packaging commit sets the real submission date', () => {
    // Owner decision 2026-10-09: 0.2.2 waits for the private feedback form, so
    // its date is not known yet. The date is built into the package and the
    // website shows a released version's notes, so neither may claim a date early.
    expect(entry('0.2.2')).toMatchObject({ status: 'unreleased', releasedAt: null })
    const gate = evaluateReleaseNotesGate({ notes: releaseNotes, version: '0.2.2', storeTarget: true })
    expect(gate.publishable).toBe(false)
    expect(gate.failures.join(' ')).toMatch(/still status="unreleased"/)
  })

  it('pass the store packaging gate once the packaging commit marks them released with a date', () => {
    const packaged = {
      ...releaseNotes,
      releases: releaseNotes.releases.map(release => release.version === '0.2.2' ? { ...release, status: 'released', releasedAt: '2026-10-26' } : release),
    }
    const gate = evaluateReleaseNotesGate({ notes: packaged, version: '0.2.2', storeTarget: true })
    expect(gate.failures).toEqual([])
    expect(gate.publishable).toBe(true)
  })

  it('say where saves live the way My Moments does, with no account-linking aside', () => {
    expect(entry('0.2.2').knownIssues).toContain('Bookmarks, notes and watched history stay in the browser where you saved them.')
    // My Moments says accounts are coming; the notes must not offer linking one now.
    expect(text(entry('0.2.2'))).not.toMatch(/link an account/i)
    expect(entry('0.2.2').new).toContain('Bookmarks work without an account. Without one, they stay in this browser and are never uploaded.')
  })

  it('describe no sign-in, device code or account flow this build does not have', () => {
    const notes = text(entry('0.2.2'))
    for (const gone of [/device code/i, /website sign-in/i, /installation account/i, /credential/i, /recovery/i, /approve this extension/i, /fixed (place|card)/i, /thirty minutes/i, /Become a Supporter opens/i]) {
      expect(notes, String(gone)).not.toMatch(gone)
    }
    expect(entry('0.2.2').knownIssues).toContain('Accounts and Supporter sign-ups are not open yet. Accounts are coming with Continue with Twitch.')
  })

  it('describe the Supporter preview without claiming a free perk changed for store users', () => {
    const notes = entry('0.2.2')
    expect(notes.changed ?? []).toEqual([])
    expect(notes.summary).toContain('The 7TV header backdrop is a Supporter perk')
    expect(notes.preview).toContain('The 7TV header backdrop is a Supporter perk; sign-ups are not open yet.')
    expect(text(notes)).not.toMatch(/moved from free|moved to Supporter|backdrop is now|backdrop you chose/i)
  })

  it('lead with the short 0.2.2 draft: title, summary and three highlights (2026-10-11 polish)', () => {
    // UP-1, owner decision 2026-10-13: emote rain stays a Supporter perk; store users never had it free.
    const notes = entry('0.2.2')
    expect(notes.title).toBe('Whole-stream charts, calmer Top Moments')
    expect(notes.summary).toBe("Charts cover the whole stream, Top Moments opens a card only when you pick one, bookmarks work without an account, and the popup is redesigned. Also built for Edge and Firefox. The 7TV header backdrop is a Supporter perk, and accounts and Supporter sign-ups aren't open yet.")
    expect(notes.preview).toEqual(['Charts cover the whole stream.', 'Top Moments opens a card only when you pick one.', 'The 7TV header backdrop is a Supporter perk; sign-ups are not open yet.'])
    expect(notes.fixed).toEqual(expect.arrayContaining([
      'Watched moments on VODs are remembered again.',
      "Replays show their own stream's chart.",
      'A restarted stream moves the panel to the new stream.',
      'The popup says when a page has no chat for the panel.',
    ]))
  })

  it('say Edge and Firefox are built for, never that a store has them', () => {
    const notes = text(entry('0.2.2'))
    expect(entry('0.2.2').new).toContain('Built for Microsoft Edge and Firefox as well as Chrome and Brave.')
    expect(notes).not.toMatch(/(Edge|Firefox)[^.]*(store|add-ons|Add-ons|available|listed|published)/i)
  })

  it('name no Help & Feedback section and promise no open private form', () => {
    const notes = text(entry('0.2.2'))
    expect(notes).not.toMatch(/Help & Feedback/)
    expect(notes).not.toMatch(/private feedback|only the (StreamPulse )?team reads/i)
    expect(entry('0.2.2').new).toContain('Send feedback and Discord links are in settings.')
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
    expect(releases.filter(release => release.status !== 'released').map(release => release.version)).toEqual(['0.2.2', '0.1.0'])
  })
})
