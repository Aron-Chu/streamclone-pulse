import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
// The extension's own release notes: its "Release details" links open this page,
// so both surfaces read the one file instead of keeping a second copy in step.
import releaseNotes from '../../../../src/shared/release-notes.json'

interface ReleaseNote {
  version: string
  status: string
  releasedAt: string | null
  title: string
  summary: string
  new?: string[]
  improved?: string[]
  fixed?: string[]
  knownIssues?: string[]
}

const NOTES = releaseNotes as { currentVersion: string; releases: ReleaseNote[] }

// Only released versions are described. The version in development is named with
// an honest label, without its notes, which can still change before it ships.
const RELEASED: ReadonlyArray<ReleaseNote> = NOTES.releases.filter((release) => release.status === 'released')
const IN_DEVELOPMENT = RELEASED.some((release) => release.version === NOTES.currentVersion) ? null : NOTES.currentVersion

// Same headings, in the same order, as the extension's changelog card.
const CATEGORIES = [
  ['new', 'New'],
  ['improved', 'Improved'],
  ['fixed', 'Fixed'],
  ['knownIssues', 'Known limitations'],
] as const

function releaseDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date)
}

export default function Changelog() {
  return (
    <PublicLayout>
      <article className="panel public-document" data-testid="changelog-page">
        <header className="mb-6 border-b border-white/[0.08] pb-6">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-violet-300">StreamPulse extension</p>
          <h1 className="text-3xl font-black tracking-tight text-white lg:text-4xl">Release notes</h1>
          <p className="mt-2 text-base text-zinc-400">What changed in each version of the StreamPulse Chrome extension.</p>
        </header>

        {IN_DEVELOPMENT ? (
          <section id={`v${IN_DEVELOPMENT}`} aria-labelledby="in-development-title" className="mt-8 border-t border-white/[0.08] pt-6">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-violet-300">v{IN_DEVELOPMENT} · In development</p>
            <h2 id="in-development-title" className="!mt-0">Next version</h2>
            <p className="text-zinc-400">v{IN_DEVELOPMENT} has not been released yet. Its notes appear here once it is.</p>
          </section>
        ) : null}

        {RELEASED.length === 0 ? <p className="mt-8 text-zinc-400">No version has been released yet.</p> : null}

        {RELEASED.map((release) => {
          const date = releaseDate(release.releasedAt)
          const titleId = `v${release.version}-title`
          return (
            <section key={release.version} id={`v${release.version}`} aria-labelledby={titleId} className="mt-8 border-t border-white/[0.08] pt-6">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-violet-300">
                v{release.version} · Released
                {date ? <> · <time dateTime={release.releasedAt ?? undefined}>{date}</time></> : null}
              </p>
              <h2 id={titleId} className="!mt-0">{release.title}</h2>
              <p className="text-zinc-300">{release.summary}</p>
              {CATEGORIES.map(([key, label]) => {
                const items = release[key] ?? []
                return items.length > 0 ? (
                  <div key={key}>
                    <h3>{label}</h3>
                    <ul>
                      {items.map((item, index) => <li key={index}>{item}</li>)}
                    </ul>
                  </div>
                ) : null
              })}
            </section>
          )
        })}

        <section id="help" aria-labelledby="help-title" className="mt-8 border-t border-white/[0.08] pt-6">
          <h2 id="help-title">Need help?</h2>
          <p className="text-zinc-400">
            Visit <Link to="/support" className="text-violet-400 hover:underline">StreamPulse Support</Link> or read
            the <Link to="/docs" className="text-violet-400 hover:underline">setup guide</Link>.
          </p>
        </section>
      </article>
    </PublicLayout>
  )
}
