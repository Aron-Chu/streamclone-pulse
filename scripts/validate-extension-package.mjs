/**
 * Validate a built extension dist/ and target ZIP for packaging gates.
 * Store targets REQUIRE the ZIP and validate extracted archive bytes via yauzl.
 *
 * Usage:
 *   node scripts/validate-extension-package.mjs --target=development|cws|edge
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import {
  compareZipEntriesToExpected,
  listPackableDistFiles,
  listZipEntries,
  targetArtifactNames,
  validateChecksumAgainstZip,
  validateIconPngFiles,
} from './extension-package-lib.mjs'
import {
  assertExactStringList,
  permissionAllowlistForTarget,
} from './extension-permission-allowlists.mjs'
import { isStoreTarget, loadManifestForTarget, resolveExtensionTarget } from './extension-target.mjs'
import { REMOTE_CODE_SCAN_NOTE } from './remote-code-scan.mjs'
import { scanArchiveEntryBytes } from './archive-byte-scan.mjs'
import {
  cleanupExtractDir,
  compareExtractedToDist,
  extractZipToTemp,
} from './zip-byte-validate.mjs'
import { findSiblingFileDependencies } from './check-public-source-readiness.mjs'

const root = process.cwd()
const dist = join(root, 'dist')

const DEV_FORBIDDEN_CONTENT = [
  /localhost:\d+/i,
  /127\.0\.0\.1/i,
  /\[::1\]/i,
  /laptopworker/i,
  /file:\.\.\//i,
  /streampulse-backend/i,
]

function parseTargetArg(argv = process.argv.slice(2)) {
  const idx = argv.findIndex((a) => a === '--target' || a.startsWith('--target='))
  if (idx < 0) return resolveExtensionTarget(process.env.EXTENSION_TARGET)
  const raw = argv[idx].startsWith('--target=') ? argv[idx].slice('--target='.length) : argv[idx + 1]
  return resolveExtensionTarget(raw)
}

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exitCode = 1
}

function ok(message) {
  console.log(`OK: ${message}`)
}

function note(message) {
  console.log(`NOTE: ${message}`)
}

function listAllDistFiles(dir, base = dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listAllDistFiles(full, base))
    else out.push(relative(base, full).split(sep).join('/'))
  }
  return out.sort((a, b) => a.localeCompare(b))
}

function validateManifest(manifest, target) {
  if (manifest.manifest_version !== 3) {
    fail(`manifest_version must be 3, got ${manifest.manifest_version}`)
  } else {
    ok('REQUIRED: manifest_version is 3')
  }

  if (manifest.name !== 'StreamPulse') {
    fail(`manifest name must be StreamPulse, got ${JSON.stringify(manifest.name)}`)
  } else {
    ok('REQUIRED: manifest name is StreamPulse')
  }

  const expected = loadManifestForTarget(target)
  if (manifest.version !== expected.version) {
    fail(`manifest.version ${JSON.stringify(manifest.version)} != target ${target} version ${expected.version}`)
  } else {
    ok(`REQUIRED: version matches target ${target} (${manifest.version})`)
  }

  const allow = permissionAllowlistForTarget(target)
  for (const err of assertExactStringList(manifest.permissions ?? [], allow.permissions, 'permissions')) {
    fail(err)
  }
  for (const err of assertExactStringList(
    manifest.host_permissions ?? [],
    allow.host_permissions,
    'host_permissions',
  )) {
    fail(err)
  }
  for (const err of assertExactStringList(
    manifest.optional_host_permissions ?? [],
    allow.optional_host_permissions,
    'optional_host_permissions',
  )) {
    fail(err)
  }
  ok(`REQUIRED: exact permission allowlist for ${target}`)

  const sw = manifest.background?.service_worker
  if (!sw || typeof sw !== 'string') {
    fail('background.service_worker missing')
  } else if (!existsSync(join(dist, sw))) {
    fail(`service worker missing from dist: ${sw}`)
  } else {
    ok(`REQUIRED: service worker present: ${sw}`)
  }

  const contentMatches = manifest.content_scripts?.[0]?.matches ?? []
  if (contentMatches.length !== 1 || contentMatches[0] !== 'https://*.twitch.tv/*') {
    fail(`content_scripts matches must be https://*.twitch.tv/* only, got ${JSON.stringify(contentMatches)}`)
  } else {
    ok('REQUIRED: content_scripts match HTTPS Twitch only')
  }

  const contentJs = manifest.content_scripts?.[0]?.js?.[0]
  if (!contentJs || !existsSync(join(dist, contentJs))) {
    fail(`content script missing from dist: ${contentJs ?? '(none)'}`)
  } else {
    ok(`REQUIRED: content script present: ${contentJs}`)
  }

  const popup = manifest.action?.default_popup
  if (!popup || !existsSync(join(dist, popup))) {
    fail(`default_popup missing from dist: ${popup ?? '(none)'}`)
  } else {
    ok(`REQUIRED: popup present: ${popup}`)
  }

  const options = manifest.options_page
  if (!options || !existsSync(join(dist, options))) {
    fail(`options_page missing from dist: ${options ?? '(none)'}`)
  } else {
    ok(`REQUIRED: options present: ${options}`)
  }

  for (const [size, iconPath] of Object.entries(manifest.icons ?? {})) {
    if (!existsSync(join(dist, iconPath))) fail(`icon ${size} missing: ${iconPath}`)
  }
  const iconCheck = validateIconPngFiles(dist)
  if (!iconCheck.ok) {
    for (const error of iconCheck.errors) fail(`REQUIRED: icon PNG gate: ${error}`)
  } else {
    ok('REQUIRED: icons present with PNG signature + exact 16/48/128 dimensions')
  }

  const expectedIconMap = {
    '16': 'icons/icon16.png',
    '48': 'icons/icon48.png',
    '128': 'icons/icon128.png',
  }
  for (const [size, path] of Object.entries(expectedIconMap)) {
    if (manifest.icons?.[size] !== path) {
      fail(`manifest.icons[${size}] must be ${path}, got ${JSON.stringify(manifest.icons?.[size])}`)
    }
  }
}

function reportArchiveHits(rel, hits) {
  for (const hit of hits) {
    if (hit.ruleId === 'private-key-header') fail(`private key material in ${rel}`)
    else if (hit.ruleId === 'absolute-machine-path') fail(`absolute machine path leak in ${rel}`)
    else if (hit.ruleId === 'sibling-private-path') fail(`sibling/private path reference in ${rel}`)
    else if (hit.ruleId === 'sourcemap-file') fail(`source map present: ${rel}`)
    else if (hit.ruleId === 'env-file') fail(`env file packaged: ${rel}`)
    else if (hit.ruleId.startsWith('remote-code:')) {
      fail(`remote-code ${hit.ruleId.slice('remote-code:'.length)} in ${rel}`)
    } else {
      fail(`archive canary ${hit.ruleId} in ${rel}`)
    }
  }
}

function scanTextArtifact(rel, contents, store) {
  const result = scanArchiveEntryBytes(rel, Buffer.from(String(contents ?? ''), 'utf8'), { store })
  reportArchiveHits(rel, result.hits)
  if (store) {
    for (const re of DEV_FORBIDDEN_CONTENT) {
      if (re.test(contents)) fail(`store artifact contains development string in ${rel}: ${re}`)
    }
  }
}

function scanArchivedBuffer(rel, buf, store) {
  const result = scanArchiveEntryBytes(rel, buf, { store })
  reportArchiveHits(rel, result.hits)
  if (store) {
    const asText = buf.toString('utf8')
    for (const re of DEV_FORBIDDEN_CONTENT) {
      if (re.test(asText)) fail(`store artifact contains development string in ${rel}: ${re}`)
    }
  }
}

function validateDistContents(store) {
  const packable = listPackableDistFiles(dist).filter((f) => f !== 'extension-target.json')
  const all = listAllDistFiles(dist)
  const mapsInDist = all.filter((f) => f.toLowerCase().endsWith('.map'))
  if (mapsInDist.length) {
    note(`dist contains ${mapsInDist.length} .map file(s); must be excluded from zip`)
  }

  let sawJs = false
  for (const rel of packable) {
    if (!/\.(js|mjs|html|css|json)$/i.test(rel)) continue
    const contents = readFileSync(join(dist, rel), 'utf8')
    scanTextArtifact(rel, contents, store)
    if (/\.js$/i.test(rel)) sawJs = true
  }
  if (!sawJs) fail('no JavaScript bundles found in packable dist set')
  else {
    ok(`scanned ${packable.length} packable text files`)
    note(REMOTE_CODE_SCAN_NOTE)
  }

  let foundHosted = false
  for (const rel of packable.filter((f) => f.endsWith('.js'))) {
    if (readFileSync(join(dist, rel), 'utf8').includes('https://api.streampulse.stream')) {
      foundHosted = true
      break
    }
  }
  if (!foundHosted) fail('hosted API default https://api.streampulse.stream not found in bundles')
  else ok('REQUIRED: hosted API default present in bundles')

  return packable
}

async function validateZipBytes(target, packable, version) {
  const names = targetArtifactNames(target, version)
  const zipPath = join(root, names.zipName)
  const checksumPath = join(root, names.checksumName)
  const store = isStoreTarget(target)

  if (!existsSync(zipPath)) {
    if (store) {
      fail(`REQUIRED: store zip missing: ${names.zipName}`)
      return
    }
    note(`${names.zipName} not present — zip gates skipped for development`)
    return
  }

  let entries
  let method
  try {
    ;({ entries, method } = await listZipEntries(zipPath))
  } catch (err) {
    fail(`REQUIRED: zip rejected: ${err instanceof Error ? err.message : err}`)
    return
  }

  const comparison = compareZipEntriesToExpected(entries, packable)
  if (!comparison.ok) {
    for (const error of comparison.errors) fail(`REQUIRED: ${error}`)
  } else {
    ok(`REQUIRED: zip entries match filtered dist set (${comparison.actual.length} via ${method})`)
  }

  const { extractDir, files, errors } = await extractZipToTemp(zipPath)
  try {
    if (errors.length) {
      for (const error of errors) fail(`REQUIRED: zip inspect: ${error}`)
      return
    }
    const byteCompare = compareExtractedToDist(files, dist)
    // extension-target.json is dist-only metadata — exclude from zip/dist byte compare
    const filteredErrors = byteCompare.errors.filter(
      (e) => !e.includes('extension-target.json'),
    )
    // Packable set may exclude extension-target; rebuild expected from packable
    const packableSet = new Set(packable)
    const fileKeys = Object.keys(files).filter((n) => !n.endsWith('/'))
    for (const rel of packable) {
      if (!files[rel]) fail(`extracted zip missing ${rel}`)
      else {
        const distBuf = readFileSync(join(dist, rel))
        if (!distBuf.equals(files[rel])) {
          fail(`extracted byte mismatch: ${rel}`)
        }
      }
    }
    for (const rel of fileKeys) {
      if (!packableSet.has(rel)) fail(`extracted unexpected entry: ${rel}`)
    }
    ok('REQUIRED: extracted ZIP bytes match selected-target dist packable set')

    if (!files['manifest.json']) {
      fail('REQUIRED: archived manifest.json missing')
      return
    }
    let archivedManifest
    try {
      archivedManifest = JSON.parse(files['manifest.json'].toString('utf8'))
    } catch (err) {
      fail(`REQUIRED: archived manifest.json unreadable: ${err instanceof Error ? err.message : err}`)
      return
    }
    const expectedManifest = loadManifestForTarget(target)
    if (JSON.stringify(archivedManifest) !== JSON.stringify(expectedManifest)) {
      fail('archived manifest.json does not exactly match target manifest source')
    } else {
      ok(`REQUIRED: archived manifest matches ${target}`)
    }

    for (const [rel, buf] of Object.entries(files)) {
      if (rel.endsWith('/')) continue
      scanArchivedBuffer(rel, buf, store)
    }
    ok('REQUIRED: scanned all extracted archive entry bytes')
  } finally {
    cleanupExtractDir(extractDir)
  }

  if (process.exitCode) {
    note(`skipping validation report ${names.reportName} after prior failures`)
    return
  }

  try {
    const checksum = validateChecksumAgainstZip(zipPath, checksumPath, names.zipName)
    ok(
      `REQUIRED: checksum matches zip (${checksum.digest}, ${checksum.bytes} bytes, name=${checksum.filename})`,
    )
  } catch (err) {
    fail(`REQUIRED: checksum validation failed: ${err instanceof Error ? err.message : err}`)
    return
  }

  if (process.exitCode) {
    note(`skipping validation report ${names.reportName} after checksum failure`)
    return
  }

  const report = {
    target,
    zipName: names.zipName,
    version,
    validatedAt: new Date().toISOString(),
    note: 'not uploaded',
  }
  writeFileSync(join(root, names.reportName), JSON.stringify(report, null, 2))
  ok(`wrote validation report ${names.reportName}`)
}

async function main() {
  const target = parseTargetArg()
  if (!existsSync(join(dist, 'manifest.json'))) {
    fail('dist/manifest.json missing — run npm run build / package:* first')
    process.exit(process.exitCode ?? 1)
  }

  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'))
  const targetMetaPath = join(dist, 'extension-target.json')
  if (existsSync(targetMetaPath)) {
    const meta = JSON.parse(readFileSync(targetMetaPath, 'utf8'))
    if (meta.target !== target) {
      fail(`dist/extension-target.json target=${JSON.stringify(meta.target)} != --target=${target}`)
    } else {
      ok(`REQUIRED: dist target metadata matches ${target}`)
    }
  } else if (isStoreTarget(target)) {
    fail('store packages require dist/extension-target.json from a target-aware build')
  }

  validateManifest(manifest, target)
  const packable = validateDistContents(isStoreTarget(target))
  await validateZipBytes(target, packable, manifest.version)

  const rpr6 = findSiblingFileDependencies()
  if (rpr6.length) {
    note('RPR-6 blocker (not concealed): sibling file: dependencies remain (advisory; packaging continues)')
    for (const hit of rpr6) note(`  [${hit.source}] ${hit.section} ${hit.name}=${hit.spec}`)
  }

  if (process.exitCode) {
    console.error('Package validation failed')
    process.exit(process.exitCode)
  }
  console.log(`Package validation passed (target=${target})`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err)
  process.exit(1)
})
