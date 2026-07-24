/**
 * Validate a built extension dist/ and CWS zip for packaging gates.
 * Valid plain JavaScript — must pass: node --check scripts/validate-extension-package.mjs
 *
 * Usage:
 *   node scripts/validate-extension-package.mjs [--target=development|cws|edge]
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import {
  ZIP_NAME,
  compareZipEntriesToExpected,
  listPackableDistFiles,
  listZipEntries,
  validateChecksumAgainstZip,
  validateIconPngFiles,
} from './extension-package-lib.mjs'
import {
  isLocalOrLoopbackHost,
  isStoreTarget,
  loadManifestForTarget,
  resolveExtensionTarget,
} from './extension-target.mjs'

const root = process.cwd()
const dist = join(root, 'dist')
const zipPath = join(root, ZIP_NAME)
const checksumPath = `${zipPath}.sha256`

const REQUIRED_PERMISSIONS = ['storage', 'scripting']
const FORBIDDEN_PERMISSIONS = ['tabs', 'webRequest', 'debugger', 'nativeMessaging']
const REQUIRED_HOSTS = [
  'https://api.streampulse.stream/*',
  'https://cdn.7tv.app/*',
  'https://static-cdn.jtvnw.net/*',
  'https://cdn.frankerfacez.com/*',
  'https://gql.twitch.tv/*',
  'https://*.twitch.tv/*',
]
const FORBIDDEN_HOST_SUBSTRINGS = [':8090', ':9876', 'localhost:3000', '127.0.0.1:3000']
const DEV_OPTIONAL_LOCALHOST_HOSTS = ['http://localhost:8081/*', 'http://127.0.0.1:8081/*']

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

function assertNoRemoteExecutableRefs(filePath, contents) {
  // Best-effort static scan — does not prove absence of every dynamic remote-code pattern.
  const patterns = [
    /import\s*\(\s*['"]https?:\/\//i,
    /new\s+Worker\s*\(\s*['"]https?:\/\//i,
    /WebAssembly\.instantiateStreaming\s*\(\s*fetch\s*\(\s*['"]https?:\/\//i,
    /<script[^>]+src=['"]https?:\/\//i,
  ]
  for (const re of patterns) {
    if (re.test(contents)) {
      fail(`remote executable reference in ${filePath}: ${re}`)
    }
  }
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

  const permissions = manifest.permissions ?? []
  for (const required of REQUIRED_PERMISSIONS) {
    if (!permissions.includes(required)) fail(`missing permission: ${required}`)
  }
  for (const forbidden of FORBIDDEN_PERMISSIONS) {
    if (permissions.includes(forbidden)) fail(`forbidden permission present: ${forbidden}`)
  }
  ok(`REQUIRED: permissions=${JSON.stringify(permissions)}`)

  const hosts = manifest.host_permissions ?? []
  for (const required of REQUIRED_HOSTS) {
    if (!hosts.includes(required)) fail(`missing host_permission: ${required}`)
  }
  for (const host of hosts) {
    for (const forbidden of FORBIDDEN_HOST_SUBSTRINGS) {
      if (host.includes(forbidden)) fail(`forbidden host permission: ${host}`)
    }
    if (isLocalOrLoopbackHost(host)) {
      fail(`localhost/loopback must not appear in host_permissions: ${host}`)
    }
  }
  ok(`REQUIRED: host_permissions count=${hosts.length}`)

  const optionalHosts = manifest.optional_host_permissions ?? []
  if (isStoreTarget(target)) {
    if (optionalHosts.length > 0) {
      fail(`store target ${target} must not declare optional_host_permissions (got ${JSON.stringify(optionalHosts)})`)
    }
    for (const host of optionalHosts) {
      if (isLocalOrLoopbackHost(host)) fail(`store target forbids local optional host: ${host}`)
    }
    ok(`REQUIRED: store target ${target} has no localhost/loopback permissions`)
  } else {
    for (const localHost of DEV_OPTIONAL_LOCALHOST_HOSTS) {
      if (!optionalHosts.includes(localHost)) {
        fail(`development target missing optional host permission: ${localHost}`)
      }
    }
    for (const host of optionalHosts) {
      if (!isLocalOrLoopbackHost(host) && !DEV_OPTIONAL_LOCALHOST_HOSTS.includes(host)) {
        fail(`unexpected optional host permission: ${host}`)
      }
    }
    ok('REQUIRED: development localhost hosts are optional (not required)')
  }

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

function validateDistContents() {
  const packable = listPackableDistFiles(dist)
  const all = listAllDistFiles(dist)
  const mapsInDist = all.filter((f) => f.toLowerCase().endsWith('.map'))
  if (mapsInDist.length) {
    note(
      `dist contains ${mapsInDist.length} .map file(s); they must be excluded from the zip (packable filter)`,
    )
  } else {
    ok('REQUIRED: no .map files in dist (or none present)')
  }

  let sawJs = false
  for (const rel of packable) {
    if (!/\.(js|mjs|html|css|json)$/i.test(rel)) continue
    const contents = readFileSync(join(dist, rel), 'utf8')
    assertNoRemoteExecutableRefs(rel, contents)
    if (/\.js$/i.test(rel)) sawJs = true
  }
  if (!sawJs) fail('no JavaScript bundles found in packable dist set')
  else {
    ok(`BEST-EFFORT: scanned ${packable.length} packable files for common remote executable refs`)
    note(
      'Static remote-code scan is best-effort and does not prove absence of every dynamic remote-code pattern.',
    )
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

function validateZipAgainstPackable(packable) {
  if (!existsSync(zipPath)) {
    note('streampulse-extension.zip not present (run npm run zip) — zip gates skipped')
    return
  }

  let entries
  let method
  try {
    ;({ entries, method } = listZipEntries(zipPath))
  } catch (err) {
    fail(`REQUIRED: zip present but cannot be inspected: ${err instanceof Error ? err.message : err}`)
    return
  }

  const comparison = compareZipEntriesToExpected(entries, packable)
  if (!comparison.ok) {
    for (const error of comparison.errors) fail(`REQUIRED: ${error}`)
  } else {
    ok(`REQUIRED: zip entries match filtered dist set (${comparison.actual.length} files via ${method})`)
  }

  try {
    const checksum = validateChecksumAgainstZip(zipPath, checksumPath, ZIP_NAME)
    ok(
      `REQUIRED: checksum matches zip (${checksum.digest}, ${checksum.bytes} bytes, name=${checksum.filename})`,
    )
  } catch (err) {
    fail(`REQUIRED: checksum validation failed: ${err instanceof Error ? err.message : err}`)
  }
}

function main() {
  const target = parseTargetArg()
  if (!existsSync(join(dist, 'manifest.json'))) {
    fail('dist/manifest.json missing — run npm run build first')
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
  const packable = validateDistContents()
  for (const rel of packable) {
    const lower = rel.toLowerCase()
    if (lower.includes('.env') || /(^|\/)\.env/.test(lower)) fail(`forbidden .env path in packable set: ${rel}`)
    if (lower.endsWith('.map')) fail(`forbidden source map in packable set: ${rel}`)
    if (lower.includes('node_modules/') || lower.includes('file:')) {
      fail(`forbidden dependency path in packable set: ${rel}`)
    }
    // Absolute Windows/Unix paths must not appear as packaged entry names.
    if (/^[a-z]:\//i.test(rel) || rel.startsWith('/')) fail(`absolute path packaged: ${rel}`)
  }
  validateZipAgainstPackable(packable)

  if (process.exitCode) {
    console.error('Package validation failed')
    process.exit(process.exitCode)
  }
  console.log(`Package validation passed (target=${target})`)
}

main()
