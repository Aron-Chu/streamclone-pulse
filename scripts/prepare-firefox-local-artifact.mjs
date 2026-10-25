/** Local harness ZIP only. Does not alter or satisfy the store release gate. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import yazl from 'yazl'
import yauzl from 'yauzl'
import { listPackableDistFiles } from './extension-package-lib.mjs'
import { inspectZipCentralDirectory } from './zip-byte-validate.mjs'
import { stageExtensionAttribution } from './stage-extension-attribution.mjs'
import { buildInputState } from './write-extension-build-provenance.mjs'
import { verifyBuildProvenance } from './lib/firefox-local-artifact.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const args = process.argv.slice(2)
if (args.length !== 2 || args[0] !== '--out') {
  throw new Error('Usage: node scripts/prepare-firefox-local-artifact.mjs --out <new local directory>')
}
const out = resolve(args[1])
if (existsSync(out)) throw new Error(`Refusing to overwrite existing evidence: ${out}`)
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const expectedManifest = JSON.parse(readFileSync(join(root, 'manifests/firefox.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'))
const metadata = JSON.parse(readFileSync(join(dist, 'extension-target.json'), 'utf8'))
assert.deepEqual(manifest, expectedManifest, 'dist is not the exact Firefox manifest')
assert.equal(metadata.target, 'firefox')
assert.equal(metadata.version, manifest.version)
assert.match(metadata.buildId, /^dev-[a-f0-9]{12}-(clean|dirty-[a-f0-9]{8})$/)
assert.equal(manifest.manifest_version, 3)
assert.deepEqual(manifest.permissions.slice().sort(), ['scripting', 'storage'])
assert.deepEqual(manifest.host_permissions.slice().sort(), ['https://*.twitch.tv/*', 'https://api.streampulse.stream/*'])
assert.deepEqual(manifest.background, { scripts: ['background/service-worker.js'], type: 'module' })
assert.equal(manifest.browser_specific_settings.gecko.id, 'streampulse@streampulse.stream')

const before = JSON.parse(readFileSync(join(root, '.artifacts/extension-build-provenance.json'), 'utf8'))
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
if (revision.status !== 0) throw new Error(revision.stderr || 'Cannot determine source revision')
function distHashes(dir = dist) {
  return Object.fromEntries(readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? Object.entries(distHashes(path)) : [[relative(dist, path).replaceAll('\\', '/'), digest(readFileSync(path))]]
  }))
}
verifyBuildProvenance({ metadata, provenance: before, head: revision.stdout.trim(), inputState: buildInputState(root), distHashes: distHashes() })

// Legal files are part of the tested bytes and must appear in provenance too.
stageExtensionAttribution(dist)
const provenanceRun = spawnSync(process.execPath, ['scripts/write-extension-build-provenance.mjs'], { cwd: root, encoding: 'utf8' })
if (provenanceRun.status !== 0) throw new Error(provenanceRun.stderr || provenanceRun.stdout)
const provenance = JSON.parse(readFileSync(join(root, '.artifacts/extension-build-provenance.json'), 'utf8'))
assert.equal(provenance.buildId, metadata.buildId)
assert.match(provenance.packageBuildCommit, /^[a-f0-9]{40}$/)
const zipPath = join(out, `streampulse-firefox-${manifest.version}-${provenance.packageBuildCommit.slice(0, 8)}-local-only.zip`)
// Store archives omit this local metadata; the local harness needs it inside the ZIP.
const names = [...new Set([...listPackableDistFiles(dist), 'extension-target.json'])].sort()
for (const required of ['manifest.json', 'extension-target.json', 'content/twitch.js', 'background/service-worker.js', 'content/moment-frames.js', 'LICENSE', 'NOTICE', 'third-party-notices.txt']) {
  assert.ok(names.includes(required), `Missing required file: ${required}`)
}
mkdirSync(out, { recursive: true })
const zip = new yazl.ZipFile()
for (const name of names) zip.addFile(join(dist, name), name)
const zipped = pipeline(zip.outputStream, createWriteStream(zipPath, { flags: 'wx' }))
zip.end()
await zipped

const inspected = await inspectZipCentralDirectory(zipPath)
assert.deepEqual(inspected.errors, [], 'ZIP byte inspection failed')
const packed = await new Promise((accept, reject) => {
  yauzl.open(zipPath, { lazyEntries: true }, (error, archive) => {
    if (error) return reject(error)
    const files = new Map()
    archive.on('error', reject)
    archive.on('end', () => accept(files))
    archive.on('entry', entry => {
      if (entry.fileName.endsWith('/')) return archive.readEntry()
      archive.openReadStream(entry, (streamError, stream) => {
        if (streamError) return reject(streamError)
        const chunks = []
        stream.on('error', reject)
        stream.on('data', chunk => chunks.push(chunk))
        stream.on('end', () => {
          files.set(entry.fileName, Buffer.concat(chunks))
          archive.readEntry()
        })
      })
    })
    archive.readEntry()
  })
})
assert.deepEqual([...packed.keys()].sort(), names)
assert.deepEqual(JSON.parse(packed.get('manifest.json')), expectedManifest)
assert.deepEqual(JSON.parse(packed.get('extension-target.json')), metadata)
for (const [name, bytes] of packed) {
  assert.equal(digest(bytes), provenance.files[name], `ZIP/provenance mismatch: ${name}`)
  assert.equal(digest(bytes), digest(readFileSync(join(dist, name))), `ZIP/dist mismatch: ${name}`)
}
const content = packed.get('content/twitch.js').toString('utf8')
assert.ok(content.includes(metadata.buildId), 'Runtime bundle lacks expected build marker')
assert.ok(content.includes('streampulseTarget="firefox"'), 'Runtime bundle lacks Firefox target marker')
const sha256 = digest(readFileSync(zipPath))
const proof = {
  schemaVersion: 1,
  localOnly: true,
  zipPath,
  sha256,
  buildId: metadata.buildId,
  target: metadata.target,
  version: metadata.version,
  addonId: manifest.browser_specific_settings.gecko.id,
  sourceRevision: provenance.packageBuildCommit,
  manifest,
  metadata,
  zipEntries: names,
  provenance,
  verification: { manifest: true, targetMetadata: true, bundleBuildId: true, provenance: true },
  storePackageValidation: 'NOT RUN: local harness artifact; unreleased store gate unchanged',
}
writeFileSync(join(out, 'artifact-verification.json'), `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx' })
writeFileSync(join(out, 'LOCAL-ONLY.txt'), 'Local Firefox harness artifact. Not a release package. Not for store upload.\n', { flag: 'wx' })
console.log(JSON.stringify({ ok: true, zipPath, sha256, files: names.length, buildId: metadata.buildId, proof: join(out, 'artifact-verification.json') }))
