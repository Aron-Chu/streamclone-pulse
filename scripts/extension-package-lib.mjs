/**
 * Shared helpers for CWS extension packaging / validation.
 * Valid plain JavaScript — importable from other scripts and focused tests.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

export const ZIP_NAME = 'streampulse-extension.zip'
export const CHECKSUM_SUFFIX = '.sha256'

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

/**
 * List ZIP entry paths. Fail closed if entries cannot be inspected.
 * @returns {{ entries: string[], method: string }}
 */
export function listZipEntries(zipPath) {
  if (!existsSync(zipPath)) {
    throw new Error(`zip not found: ${zipPath}`)
  }

  const unzip = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' })
  if (unzip.status === 0) {
    const entries = unzip.stdout
      .split(/\r?\n/)
      .map((s) => normalizeZipEntry(s))
      .filter(Boolean)
    if (entries.length === 0) {
      throw new Error('unzip returned zero entries')
    }
    return { entries, method: 'unzip' }
  }

  if (process.platform === 'win32') {
    const escaped = zipPath.replace(/'/g, "''")
    const ps = `
      $ErrorActionPreference = 'Stop'
      Add-Type -AssemblyName System.IO.Compression.FileSystem
      $z = [IO.Compression.ZipFile]::OpenRead('${escaped}')
      try {
        $z.Entries | ForEach-Object { $_.FullName }
      } finally {
        $z.Dispose()
      }
    `
    const listed = spawnSync('powershell', ['-NoProfile', '-Command', ps], {
      encoding: 'utf8',
    })
    if (listed.status !== 0) {
      throw new Error(
        `unable to inspect zip entries (unzip unavailable; ZipFile listing failed): ${listed.stderr || listed.stdout || listed.status}`,
      )
    }
    const entries = listed.stdout
      .split(/\r?\n/)
      .map((s) => normalizeZipEntry(s))
      .filter(Boolean)
    if (entries.length === 0) {
      throw new Error('ZipFile listing returned zero entries')
    }
    return { entries, method: 'dotnet-ZipFile' }
  }

  throw new Error(
    `unable to inspect zip entries: unzip failed with status ${unzip.status ?? 'unknown'} and no Windows ZipFile fallback`,
  )
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
