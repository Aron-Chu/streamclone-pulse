import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const manifestPath = resolve(repoRoot, 'streampulse-web/src/lib/release-notes.json')
const extensionPackagePath = resolve(repoRoot, 'package.json')
const portalPackagePath = resolve(repoRoot, 'streampulse-web/package.json')
const extensionManifestPath = resolve(repoRoot, 'manifest.json')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

const manifest = readJson(manifestPath)
const extensionPackage = readJson(extensionPackagePath)
const portalPackage = readJson(portalPackagePath)
const extensionManifest = readJson(extensionManifestPath)

if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.releases) || manifest.releases.length === 0) {
  throw new Error('release-notes.json must use schemaVersion 1 and contain at least one release')
}

const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const seen = new Set()
for (const release of manifest.releases) {
  if (!release || typeof release !== 'object' || !versionPattern.test(release.version)) {
    throw new Error(`Invalid release version: ${release?.version ?? '<missing>'}`)
  }
  if (seen.has(release.version)) throw new Error(`Duplicate release version: ${release.version}`)
  seen.add(release.version)
  if (!['released', 'unreleased'].includes(release.status)) {
    throw new Error(`Invalid release status for ${release.version}: ${release.status}`)
  }
  if (release.status === 'released' && !/^\d{4}-\d{2}-\d{2}$/.test(release.releasedAt ?? '')) {
    throw new Error(`Released entry ${release.version} needs an ISO releasedAt date`)
  }
  for (const field of ['new', 'improved', 'fixed', 'knownIssues']) {
    if (!Array.isArray(release[field])) throw new Error(`${release.version}.${field} must be an array`)
  }
}

const versions = [extensionPackage.version, portalPackage.version, extensionManifest.version]
if (versions.some(version => version !== manifest.currentVersion)) {
  throw new Error(`Release versions ${versions.join(', ')} do not match currentVersion ${manifest.currentVersion}`)
}
if (!seen.has(manifest.currentVersion)) {
  throw new Error(`No release entry matches currentVersion ${manifest.currentVersion}`)
}

console.log(`release notes valid: ${manifest.currentVersion} (${manifest.releases.length} entries)`)
