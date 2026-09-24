import { useId, useState } from 'react'
import { allReleases, installedExtensionVersion, type ReleaseEntry } from '../shared/releaseManifest.ts'

type ChangelogCardProps =
  | { variant: 'preview'; limit?: number; maxHighlights?: number }
  | { variant: 'history' }

const CATEGORY_LABELS = {
  new: 'New',
  improved: 'Improved',
  fixed: 'Fixed',
  knownIssues: 'Known limitations',
} as const

function releaseHighlights(entry: ReleaseEntry, limit: number): string[] {
  const source = (entry.preview ?? []).filter(Boolean)
  if (source.length > 0) return source.slice(0, limit)
  return [
    ...(entry.new ?? []),
    ...(entry.improved ?? []),
    ...(entry.fixed ?? []),
    ...(entry.knownIssues ?? []),
  ].filter(Boolean).slice(0, limit)
}

function releaseDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function releaseLink(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (value.startsWith('/')) return `https://streampulse.stream${value}`
  return value.startsWith('https://streampulse.stream/') ? value : undefined
}

function ReleaseHeading({ entry, isInstalled }: { entry: ReleaseEntry; isInstalled: boolean }) {
  const lifecycle = isInstalled ? 'Installed' : entry.status === 'unreleased' ? 'Preview' : 'Released'
  const date = releaseDate(entry.releasedAt)
  return (
    <>
      <span className="pulse-changelog-badges">
        <span className="pulse-changelog-version">v{entry.version}</span>
        <span className="pulse-changelog-lifecycle" data-release-status={entry.status}>{lifecycle}</span>
      </span>
      <span className="pulse-changelog-heading-copy">
        <span className="pulse-changelog-title">{entry.title}</span>
        {date ? <time dateTime={entry.releasedAt ?? undefined}>{date}</time> : null}
      </span>
      <span className="pulse-changelog-chevron" aria-hidden="true">›</span>
    </>
  )
}

function PreviewBody({ entry, maxHighlights }: { entry: ReleaseEntry; maxHighlights: number }) {
  const highlights = releaseHighlights(entry, maxHighlights)
  return (
    <div className="pulse-changelog-body">
      {entry.summary ? <p className="pulse-changelog-summary-copy">{entry.summary}</p> : null}
      <ul className="pulse-changelog-list">
        {highlights.map((item, index) => <li key={index} data-changelog-preview-bullet="true">{item}</li>)}
      </ul>
    </div>
  )
}

function HistoryBody({ entry }: { entry: ReleaseEntry }) {
  const categories = (Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>)
    .map(key => ({ key, label: CATEGORY_LABELS[key], items: entry[key] ?? [] }))
    .filter(category => category.items.length > 0)
  const details = releaseLink(entry.links?.details)
  const support = releaseLink(entry.links?.support)

  return (
    <div className="pulse-changelog-body">
      {entry.summary ? <p className="pulse-changelog-summary-copy">{entry.summary}</p> : null}
      {categories.map(category => (
        <section key={category.key} className="pulse-changelog-category" data-release-category={category.key}>
          <h3>{category.label}</h3>
          <ul className="pulse-changelog-list">
            {category.items.map((item, index) => <li key={index}>{item}</li>)}
          </ul>
        </section>
      ))}
      {details || support ? (
        <div className="pulse-changelog-links">
          {details ? <a href={details} target="_blank" rel="noreferrer">Release details ↗</a> : null}
          {support ? <a href={support} target="_blank" rel="noreferrer">Support ↗</a> : null}
        </div>
      ) : null}
    </div>
  )
}

function ChangelogEntry({
  entry,
  isInstalled,
  initiallyOpen,
  variant,
  maxHighlights,
}: {
  entry: ReleaseEntry
  isInstalled: boolean
  initiallyOpen: boolean
  variant: 'preview' | 'history'
  maxHighlights: number
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const contentId = useId()
  return (
    <article
      className="pulse-changelog-release"
      data-changelog-open={open}
      data-changelog-preview={variant === 'preview' ? 'true' : undefined}
    >
      <button
        type="button"
        className="pulse-changelog-toggle"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen(current => !current)}
      >
        <ReleaseHeading entry={entry} isInstalled={isInstalled} />
      </button>
      <div
        id={contentId}
        className="pulse-changelog-reveal"
        aria-hidden={!open}
      >
        <div className="pulse-changelog-reveal-clip">
          {variant === 'history'
            ? <HistoryBody entry={entry} />
            : <PreviewBody entry={entry} maxHighlights={maxHighlights} />}
        </div>
      </div>
    </article>
  )
}

export function ChangelogCard(props: ChangelogCardProps) {
  const installed = installedExtensionVersion()
  const limit = props.variant === 'preview' ? Math.max(0, props.limit ?? 1) : undefined
  const releases = typeof limit === 'number' ? allReleases().slice(0, limit) : allReleases()
  const maxHighlights = props.variant === 'preview' ? Math.max(0, props.maxHighlights ?? 3) : 0
  if (releases.length === 0) return null

  return (
    <div className="pulse-changelog" data-changelog-variant={props.variant}>
      {releases.map((entry, index) => (
        <ChangelogEntry
          key={entry.version}
          entry={entry}
          isInstalled={entry.version === installed}
          initiallyOpen={entry.version === installed || (index === 0 && !releases.some(item => item.version === installed))}
          variant={props.variant}
          maxHighlights={maxHighlights}
        />
      ))}
    </div>
  )
}
