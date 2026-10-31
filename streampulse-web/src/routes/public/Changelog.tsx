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
  preview?: string[]
  new?: string[]
  changed?: string[]
  improved?: string[]
  fixed?: string[]
  knownIssues?: string[]
}

const NOTES = releaseNotes as { currentVersion: string; releases: ReleaseNote[] }

// Only released versions are shown, so the page starts with the latest release.
// An unreleased entry (the version in development) gets no placeholder section:
// its notes can still change before it ships.
const RELEASED: ReadonlyArray<ReleaseNote> = NOTES.releases.filter((release) => release.status === 'released')
// The latest release leads with a short card: its title and up to three highlights.
const LATEST: ReleaseNote | null = (RELEASED[0]?.preview?.length ?? 0) > 0 ? RELEASED[0] : null

// Same headings, in the same order, as the extension's changelog card.
const CATEGORIES = [
  ['new', 'New'],
  ['changed', 'Changed'],
  ['improved', 'Improved'],
  ['fixed', 'Fixed'],
  ['knownIssues', 'Known limitations'],
] as const

// Each group folds to its count, except Changed and Known limitations: a
// feature that moved (for example to Supporter) and what isn't open yet are
// never hidden behind a click.
const OPEN_CATEGORIES: ReadonlySet<string> = new Set(['changed', 'knownIssues'])

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
        {/* No rule of its own: each version's section draws the one rule above it. */}
        <header className="pb-2">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-violet-300">StreamPulse extension</p>
          <h1 className="text-3xl font-black tracking-tight text-white lg:text-4xl">Release notes</h1>
          <p className="mt-2 text-base text-zinc-400">What changed in each version of the StreamPulse extension.</p>
        </header>

        {RELEASED.length === 0 ? <p className="mt-8 text-zinc-400">No version has been released yet.</p> : null}

        {RELEASED.map((release) => {
          const date = releaseDate(release.releasedAt)
          const dateLabel = date ? <> · <time dateTime={release.releasedAt ?? undefined}>{date}</time></> : null
          const titleId = `v${release.version}-title`
          const changesId = `v${release.version}-changes`
          const latest = release === LATEST
          return (
            <section key={release.version} id={`v${release.version}`} aria-labelledby={titleId} className="mt-8 border-t border-white/[0.08] pt-6">
              {latest ? (
                <div data-testid="changelog-whats-new" className="mb-6 rounded-2xl border border-violet-400/25 bg-violet-500/[0.07] px-6 py-5">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-violet-300">
                    What&rsquo;s new in v{release.version}{dateLabel}
                  </p>
                  <h2 id={titleId} className="!mb-3 !mt-1">{release.title}</h2>
                  <ul className="!my-0">
                    {release.preview!.slice(0, 3).map((item, index) => <li key={index}>{item}</li>)}
                  </ul>
                  <a href={`#${changesId}`} className="mt-4 inline-block text-sm font-semibold text-violet-300 hover:underline">See all changes ↓</a>
                </div>
              ) : (
                <>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-violet-300">
                    v{release.version} · Released{dateLabel}
                  </p>
                  <h2 id={titleId} className="!mt-0">{release.title}</h2>
                </>
              )}
              {/* scroll-mt keeps "See all changes" from landing under the sticky site header. */}
              {latest ? <p id={changesId} className="!mb-2 scroll-mt-20 text-xs font-bold uppercase tracking-[0.14em] text-zinc-400">All changes</p> : null}
              <p className="text-zinc-300">{release.summary}</p>
              {CATEGORIES.map(([key, label]) => {
                const items = release[key] ?? []
                return items.length > 0 ? (
                  <details key={key} open={OPEN_CATEGORIES.has(key)} data-category={key} className="group mt-3 border-t border-white/[0.06]">
                    <summary className="flex cursor-pointer list-none items-center gap-2 py-3 [&::-webkit-details-marker]:hidden">
                      <h3 className={`!my-0 ${key === 'knownIssues' ? '!text-amber-300' : ''}`}>{label}</h3>
                      <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-xs font-bold text-zinc-400" aria-label={`${items.length} ${items.length === 1 ? 'item' : 'items'}`}>{items.length}</span>
                      <span aria-hidden="true" className="ml-auto inline-block text-xl leading-none text-zinc-400 transition-transform group-open:[transform:rotate(90deg)]">›</span>
                    </summary>
                    <ul className="!mb-0 !mt-1 pb-3">
                      {items.map((item, index) => <li key={index}>{item}</li>)}
                    </ul>
                  </details>
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
