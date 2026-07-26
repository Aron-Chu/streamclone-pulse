/**
 * Shared helpers for CWS extension packaging / validation.
 * Valid plain JavaScript — importable from other scripts and focused tests.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** @deprecated Prefer targetArtifactNames() — kept for transitional tests. */
export const ZIP_NAME = 'streampulse-extension.zip'
export const CHECKSUM_SUFFIX = '.sha256'

/**
 * Unambiguous per-target artifact filenames.
 * Legacy bare `streampulse-extension.zip` must not be produced for store targets.
 */
export function targetArtifactNames(target, version) {
  const ver = String(version ?? '0.0.0').replace(/[^0-9A-Za-z._-]/g, '')
  if (target === 'cws' || target === 'edge') {
    const zipName = `streampulse-extension-${target}-${ver}.zip`
    return {
      zipName,
      checksumName: `${zipName}.sha256`,
      reportName: `streampulse-extension-${target}-${ver}.validation.json`,
    }
  }
  const zipName = `streampulse-extension-development-${ver}.zip`
  return {
    zipName,
    checksumName: `${zipName}.sha256`,
    reportName: `streampulse-extension-development-${ver}.validation.json`,
  }
}

export const FORBIDDEN_ZIP_SUBSTRINGS = [
  '.map',
  'node_modules/',
  '__tests__/',
  '/tests/',
  '.env',
]

/** True when a relative dist path must not be packaged. */
export function shouldSkipPackagedPath(relPath) {
  const lower = String(relPath ?? '')
    .replace(/\\/g, '/')
    .toLowerCase()
  if (!lower) return true
  if (lower.endsWith('.map')) return true
  if (lower.endsWith('.env') || lower.includes('.env.')) return true
  if (lower.endsWith('.local')) return true
  if (lower.includes('node_modules/')) return true
  if (lower.includes('__tests__/') || /(^|\/)tests\//.test(lower)) return true
  if (lower === 'extension-target.json') return true
  return false
}

export function normalizeZipEntry(entry) {
  return String(entry ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
}

/** Lexically sorted relative paths under dist that are allowed in the CWS zip. */
export function listPackableDistFiles(distDir) {
  if (!existsSync(distDir)) return []
  const out = []
  function walk(dir, base = distDir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full, base)
        continue
      }
      const rel = relative(base, full).split(sep).join('/')
      if (shouldSkipPackagedPath(rel)) continue
      out.push(rel)
    }
  }
  walk(distDir)
  return out.sort((a, b) => a.localeCompare(b))
}

export function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

/** PNG signature + IHDR width/height. Throws on invalid / truncated buffers. */
export function readPngDimensions(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  if (bytes.length < 24) {
    throw new Error(`PNG too small (${bytes.length} bytes)`)
  }
  if (bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error('missing PNG signature')
  }
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('missing IHDR chunk')
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bytes: bytes.length,
  }
}

/** Expected CWS icon paths → exact pixel size. */
export const REQUIRED_ICON_SPECS = Object.freeze({
  'icons/icon16.png': 16,
  'icons/icon48.png': 48,
  'icons/icon128.png': 128,
})

/**
 * Validate icon PNGs under a root (dist/ or public/).
 * Rejects missing files, wrong dimensions, and tiny stub payloads.
 */
export function validateIconPngFiles(rootDir, specs = REQUIRED_ICON_SPECS, minBytes = 200) {
  const errors = []
  for (const [rel, size] of Object.entries(specs)) {
    const full = join(rootDir, rel)
    if (!existsSync(full)) {
      errors.push(`missing icon: ${rel}`)
      continue
    }
    try {
      const buf = readFileSync(full)
      const dim = readPngDimensions(buf)
      if (dim.width !== size || dim.height !== size) {
        errors.push(`${rel} is ${dim.width}x${dim.height}, expected ${size}x${size}`)
      }
      if (dim.bytes < minBytes) {
        errors.push(`${rel} is only ${dim.bytes} bytes (stub threshold ${minBytes})`)
      }
      // All three stubs historically shared an identical 16x16 buffer — catch that class.
      if (size !== 16 && dim.width === 16 && dim.height === 16) {
        errors.push(`${rel} is a stretched/duplicated 16x16 stub`)
      }
    } catch (err) {
      errors.push(`${rel}: ${err instanceof Error ? err.message : err}`)
    }
  }
  return { ok: errors.length === 0, errors }
}

/**
 * List ZIP entry paths via yauzl (structured parser). Fail closed.
 * @returns {Promise<{ entries: string[], method: string, inspectErrors: string[] }>}
 */
export async function listZipEntries(zipPath) {
  if (!existsSync(zipPath)) {
    throw new Error(`zip not found: ${zipPath}`)
  }
  const { inspectZipCentralDirectory } = await import('./zip-byte-validate.mjs')
  const { entries: inspected, errors } = await inspectZipCentralDirectory(zipPath)
  if (errors.length) {
    throw new Error(`zip central-directory rejected:\n${errors.join('\n')}`)
  }
  const entries = inspected
    .filter((e) => !e.isDirectory)
    .map((e) => normalizeZipEntry(e.name))
    .filter(Boolean)
  if (entries.length === 0) {
    throw new Error('zip parser returned zero file entries')
  }
  return { entries, method: 'yauzl', inspectErrors: errors }
}

/**
 * Compare ZIP entries to the expected filtered packable set.
 * @returns {{ ok: boolean, errors: string[], expected: string[], actual: string[] }}
 */
export function compareZipEntriesToExpected(zipEntries, expectedFiles) {
  const expected = [...expectedFiles].map(normalizeZipEntry).sort((a, b) => a.localeCompare(b))
  const actual = [...zipEntries]
    .map(normalizeZipEntry)
    .filter((e) => e && !e.endsWith('/'))
    .sort((a, b) => a.localeCompare(b))

  const errors = []
  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)

  for (const rel of expected) {
    if (!actualSet.has(rel)) errors.push(`missing zip entry: ${rel}`)
  }
  for (const rel of actual) {
    if (!expectedSet.has(rel)) errors.push(`unexpected zip entry: ${rel}`)
  }

  if (!actualSet.has('manifest.json')) {
    errors.push('manifest.json must be at the archive root')
  }

  const required = [
    'background/service-worker.js',
    'content/twitch.js',
    'popup/index.html',
    'popup/popup.js',
    'options/index.html',
    'options/options.js',
    'icons/icon16.png',
    'icons/icon48.png',
    'icons/icon128.png',
  ]
  for (const rel of required) {
    if (!actualSet.has(rel)) errors.push(`required entry missing: ${rel}`)
  }

  for (const rel of actual) {
    const lower = rel.toLowerCase()
    if (lower.endsWith('.map')) errors.push(`forbidden source map in zip: ${rel}`)
    if (lower.includes('node_modules/')) errors.push(`forbidden node_modules in zip: ${rel}`)
    if (lower.includes('__tests__/') || /(^|\/)tests\//.test(lower)) {
      errors.push(`forbidden tests path in zip: ${rel}`)
    }
    if (lower.endsWith('.env') || lower.includes('.env.') || lower.endsWith('.local')) {
      errors.push(`forbidden env/local file in zip: ${rel}`)
    }
    // Flattened archive: top-level service-worker.js without background/
    if (rel === 'service-worker.js' || rel === 'twitch.js') {
      errors.push(`flattened zip path detected: ${rel}`)
    }
  }

  return { ok: errors.length === 0, errors, expected, actual }
}

export function parseChecksumFile(checksumText, expectedZipName = ZIP_NAME) {
  const line = String(checksumText ?? '')
    .trim()
    .split(/\r?\n/)[0]
  if (!line) throw new Error('checksum file is empty')
  const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(\S+)\s*$/)
  if (!match) throw new Error(`checksum line is not "digest  ${expectedZipName}" format`)
  const digest = match[1].toLowerCase()
  const filename = match[2]
  if (filename !== expectedZipName) {
    throw new Error(`checksum filename is ${JSON.stringify(filename)}, expected ${expectedZipName}`)
  }
  return { digest, filename }
}

export function validateChecksumAgainstZip(zipPath, checksumPath, expectedZipName = ZIP_NAME) {
  if (!existsSync(zipPath)) throw new Error(`zip missing: ${zipPath}`)
  if (!existsSync(checksumPath)) throw new Error(`checksum missing: ${checksumPath}`)
  const actual = sha256File(zipPath)
  const { digest, filename } = parseChecksumFile(readFileSync(checksumPath, 'utf8'), expectedZipName)
  if (digest !== actual) {
    throw new Error(`checksum mismatch: file=${actual} recorded=${digest}`)
  }
  return { digest: actual, filename, bytes: statSync(zipPath).size }
}
