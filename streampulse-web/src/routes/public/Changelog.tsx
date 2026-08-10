import { Link } from 'react-router-dom'
import releaseManifest from '../../lib/release-notes.json'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { ROADMAP_URL } from '../../lib/externalLinks'

type ReleaseEntry = (typeof releaseManifest.releases)[number]

function ReleaseSection({ version, title, items }: { version: string; title: string; items: readonly string[] }) {
  if (items.length === 0) return null
  const id = `release-${version.replace(/[^a-z0-9]+/gi, '-')}-${title.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <section aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      <ul>
        {items.map(item => <li key={item}>{item}</li>)}
      </ul>
    </section>
  )
}

function ReleaseCard({ release }: { release: ReleaseEntry }) {
  const statusLabel = release.status === 'released' && release.releasedAt
    ? new Date(`${release.releasedAt}T00:00:00Z`).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'Not released yet'

  return (
    <article className="changelog-entry" data-testid={`release-${release.version}`}>
      <div className="changelog-entry__header">
        <div>
          <div className="changelog-entry__meta">
            <p className="muted changelog-entry__version">v{release.version}</p>
            <span className={`changelog-status changelog-status--${release.status}`}>
              {release.status === 'released' ? 'Released' : 'Preview'}
            </span>
          </div>
          <h2>{release.title}</h2>
        </div>
        <span className="changelog-entry__date">{statusLabel}</span>
      </div>
      <p>{release.summary}</p>
      <ReleaseSection version={release.version} title="New" items={release.new} />
      <ReleaseSection version={release.version} title="Improved" items={release.improved} />
      <ReleaseSection version={release.version} title="Fixed" items={release.fixed} />
      <ReleaseSection version={release.version} title="Known issues" items={release.knownIssues} />
    </article>
  )
}

export default function Changelog() {
  const current = releaseManifest.releases.find(release => release.version === releaseManifest.currentVersion)
  const shipped = releaseManifest.releases.filter(release => release.status === 'released')
  const previews = releaseManifest.releases.filter(release => release.status !== 'released')
  return (
    <PublicLayout>
      <article className="panel public-document" data-testid="changelog-page">
        <p className="muted public-document__back"><Link to="/">← StreamPulse</Link></p>
        <header className="changelog-hero">
          <div>
            <p className="eyebrow">Product updates</p>
            <h1>Changelog</h1>
            <p className="changelog-hero__summary">
              A plain-language record of what changed in the extension and public analytics. Preview entries are visible
              to testers but are not promises of a production release.
            </p>
          </div>
          {current ? (
            <div className="changelog-current" aria-label={`Current version ${current.version}`}>
              <span className={`changelog-status changelog-status--${current.status}`}>
                {current.status === 'released' ? 'Current release' : 'Current preview'}
              </span>
              <strong>v{current.version}</strong>
              <span>{current.status === 'released' && current.releasedAt ? current.releasedAt : 'Not released yet'}</span>
            </div>
          ) : null}
        </header>
        <div className="changelog-callout" role="note">
          <strong>Release discipline:</strong> a version is marked released only after its artifact and hosted surfaces
          have been explicitly published. Local builds may include a dirty package cohort and should be treated as test
          previews.
        </div>
        <section className="changelog-group" aria-labelledby="changelog-shipped">
          <h2 id="changelog-shipped" className="changelog-group__title">Shipped</h2>
          {shipped.length === 0 ? (
            <div className="changelog-empty">
              <p className="changelog-empty__lead">No shipped releases yet.</p>
              <p>
                Nothing has cleared the release bar, so there is nothing to report here. Everything below is a preview
                build. Follow the{' '}
                <a href={ROADMAP_URL} target="_blank" rel="noreferrer noopener">roadmap on GitHub</a> to see what is
                being worked on next.
              </p>
            </div>
          ) : (
            <div className="changelog-list" aria-label="Shipped releases">
              {shipped.map(release => <ReleaseCard key={release.version} release={release} />)}
            </div>
          )}
        </section>
        {previews.length > 0 ? (
          <section className="changelog-group" aria-labelledby="changelog-previews">
            <h2 id="changelog-previews" className="changelog-group__title">In preview</h2>
            <p className="changelog-group__note muted">
              Visible to testers. These are not promises of a production release and may change or be withdrawn.
            </p>
            <div className="changelog-list" aria-label="Preview releases">
              {previews.map(release => <ReleaseCard key={release.version} release={release} />)}
            </div>
          </section>
        ) : null}
        <p className="changelog-footer-note">
          Have a question about a preview? <Link to="/support">Contact support</Link> or review the <Link to="/docs">installation notes</Link>.
        </p>
      </article>
    </PublicLayout>
  )
}
