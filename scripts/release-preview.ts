import { readFileSync } from 'node:fs'

export interface ExtensionReleasePreview {
  version: string
  title: string
  bullets: [string, string, string]
}

interface ReleaseNotesSource {
  currentVersion?: unknown
  releases?: unknown
}

/** Select the compact content-script payload from the canonical release notes. */
export function selectExtensionReleasePreview(source: ReleaseNotesSource): ExtensionReleasePreview {
  const releases = Array.isArray(source.releases) ? source.releases : []
  const current = releases.find(entry => (
    typeof entry === 'object'
    && entry !== null
    && 'version' in entry
    && entry.version === source.currentVersion
  )) as { version?: unknown; title?: unknown; preview?: unknown } | undefined
  const bullets = Array.isArray(current?.preview)
    ? current.preview.map(value => String(value).trim()).filter(Boolean).slice(0, 3)
    : []
  const version = typeof current?.version === 'string' ? current.version.trim() : ''
  const title = typeof current?.title === 'string' ? current.title.trim() : ''
  if (!version || !title || bullets.length !== 3) {
    throw new Error('current release must provide a version, title, and exactly three preview bullets')
  }
  return {
    version,
    title,
    bullets: bullets as [string, string, string],
  }
}

export function loadExtensionReleasePreview(path: string): ExtensionReleasePreview {
  return selectExtensionReleasePreview(JSON.parse(readFileSync(path, 'utf8')) as ReleaseNotesSource)
}
