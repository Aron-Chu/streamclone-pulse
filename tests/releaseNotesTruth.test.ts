import { describe, expect, it } from 'vitest'
import releaseNotes from '../src/shared/release-notes.json'
import { evaluateReleaseNotesGate } from '../scripts/lib/release-notes-gate.mjs'
import { selectExtensionReleasePreview } from '../scripts/release-preview.ts'
import { releaseLifecycleLabel } from '../src/ui/ChangelogCard.tsx'

/**
 * Release review 2026-10-09 (A-4): the 0.2.6 notes describe what ships, the store packager accepts them, and the changelog labels say
 * which versions the Chrome Web Store published.
 */
type Entry = { version: string; status: string; releasedAt: string | null; title: string; summary: string; preview?: string[]; new?: string[]; changed?: string[]; improved?: string[]; fixed?: string[]; knownIssues?: string[] }
const releases = releaseNotes.releases as Entry[]
const entry = (version: string) => releases.find(release => release.version === version)!
const text = (release: Entry) => [release.title, release.summary, ...(release.preview ?? []), ...(release.new ?? []), ...(release.changed ?? []), ...(release.improved ?? []), ...(release.fixed ?? []), ...(release.knownIssues ?? [])].join('\n')

describe('0.2.6 release notes', () => {
  it('are released on the submission date and pass the store packaging gate', () => {
    expect(entry('0.2.6')).toMatchObject({ status: 'released', releasedAt: '2026-10-27' })
    const gate = evaluateReleaseNotesGate({ notes: releaseNotes, version: '0.2.6', storeTarget: true })
    expect(gate.failures).toEqual([])
    expect(gate.publishable).toBe(true)
  })

  it('describe what 0.2.6 shows: pictures of missed moments, Stream Recap, and no Catch me up block', () => {
    const notes = entry('0.2.6')
    expect(notes.new).toContain("Stream Recap: a past stream's summary, its chart, and its Top moments like on live.")
    expect(notes.new![0]).toContain("even for moments you missed, using the stream's Twitch VOD. Pictures are never uploaded.")
    expect(notes.new).toContain('Moment cards have a Bookmark button, and a saved moment keeps its picture in this browser.')
    expect(text(notes)).not.toMatch(/Catch me up|stay in the tab|needs a tab reload|sign-ups/i)
  })

  it('say where saves live the way My Moments does, with no account-linking aside', () => {
    expect(entry('0.2.6').knownIssues).toContain('Bookmarks, notes and watched history stay in the browser where you saved them.')
    // My Moments says accounts are coming; the notes must not offer linking one now.
    expect(text(entry('0.2.6'))).not.toMatch(/link an account/i)
    expect(entry('0.2.6').new).toContain('Bookmarks work without an account and stay in this browser.')
  })

  it('describe no sign-in, device code or account flow this build does not have', () => {
    const notes = text(entry('0.2.6'))
    for (const gone of [/device code/i, /website sign-in/i, /installation account/i, /credential/i, /recovery/i, /approve this extension/i, /fixed (place|card)/i, /thirty minutes/i, /Become a Supporter opens/i]) {
      expect(notes, String(gone)).not.toMatch(gone)
    }
    expect(entry('0.2.6').knownIssues).toContain("Accounts aren't open yet and Supporter isn't on sale yet. Accounts are coming with Continue with Twitch.")
  })

  it('describe the Supporter preview without claiming a free perk changed for store users', () => {
    const notes = entry('0.2.6')
    // Changed is for what moved under store users; no perk moved, so no Supporter line goes there.
    expect((notes.changed ?? []).join('\n')).not.toMatch(/Supporter|perk|emote rain|backdrop|paint|crest/i)
    expect(notes.summary).toContain('The 7TV header backdrop is a Supporter perk')
    expect(notes.preview).toContain('The 7TV header backdrop is a Supporter perk; Supporter is not on sale yet.')
    expect(text(notes)).not.toMatch(/moved from free|moved to Supporter|backdrop is now|backdrop you chose/i)
  })

  it('lead with the short 0.2.6 notes: title, summary and three highlights (2026-10-20 release copy, updated for 0.2.6 2026-10-27)', () => {
    // UP-1, owner decision 2026-10-13: emote rain stays a Supporter perk; store users never had it free.
    const notes = entry('0.2.6')
    expect(notes.title).toBe('Whole-stream charts and moment pictures')
    expect(notes.summary).toBe("Charts cover the whole stream, Top Moments shows pictures, even of moments you missed, and Stream Recap sums up a past stream. The 7TV header backdrop is a Supporter perk; accounts aren't open and Supporter isn't on sale yet.")
    expect(notes.preview).toEqual(['Charts cover the whole stream.', 'Top Moments shows a picture of what happened, even on past streams.', 'The 7TV header backdrop is a Supporter perk; Supporter is not on sale yet.'])
    expect(notes.fixed).toEqual(expect.arrayContaining([
      'Offline channels show as offline, not as live or "Not tracked".',
      'Watched moments on replays are remembered again.',
    ]))
  })

  it('name no Edge or Firefox store before its listing exists', () => {
    // M7, 2026-10-20: neither listing exists when the notes are frozen, and the
    // same notes ship inside the Edge and Firefox packages.
    expect(text(entry('0.2.6'))).not.toMatch(/Edge|Firefox/)
  })

  it('name no Help & Feedback section and promise no open private form', () => {
    const notes = text(entry('0.2.6'))
    expect(notes).not.toMatch(/Help & Feedback/)
    expect(notes).not.toMatch(/private feedback|only the (StreamPulse )?team reads/i)
    expect(entry('0.2.6').new).toContain('Join the Discord and Send feedback from quick settings and settings.')
  })

  it('name the Supporter perks from the one perk list', async () => {
    const perks = (await import('../src/shared/supporter-perks.json')).default
    const supporterLine = entry('0.2.6').new!.find(line => line.startsWith('A Supporter preview'))!
    for (const name of perks.names) expect(supporterLine.toLowerCase()).toContain(name.toLowerCase())
  })

  it('keep the quick-settings preview no larger than it was when numbered 0.2.2, for the content-script budget', () => {
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
