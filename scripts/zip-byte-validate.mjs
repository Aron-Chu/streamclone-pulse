/**
 * Structured ZIP inspection with yauzl — validates entries before extract,
 * then extracts to an isolated temp dir for byte comparison / content scans.
 */
import { createHash } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'

export const ZIP_LIMITS = Object.freeze({
  maxEntries: 500,
  maxEntryUncompressedBytes: 25 * 1024 * 1024,
  maxTotalUncompressedBytes: 80 * 1024 * 1024,
  /** compressed/uncompressed below this ratio (when compressed > 64) is suspicious. */
  minCompressionRatio: 0.001,
})

/**
 * Reject unsafe ZIP entry names before extraction.
 * @returns {string|null} error message or null when safe
 */
export function validateZipEntryName(rawName) {
  const name = String(rawName ?? '')
  if (!name || name.trim() === '') return 'empty entry name'
  if (name.includes('\0')) return 'NUL in entry name'
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i)
    if (code < 32) return `control character in entry name (code ${code})`
  }
  if (name.includes('\\')) return 'backslash in entry name'
  if (name.startsWith('/')) return 'leading slash in entry name'
  if (/^[a-zA-Z]:/.test(name)) return 'drive-letter path in entry name'
  if (name.includes('://')) return 'absolute URI-like entry name'
  const parts = name.split('/')
  for (const part of parts) {
    if (part === '.' || part === '..') return 'traversal segment in entry name'
  }
  return null
}

function openZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zip) => {
      if (err) reject(err)
      else resolve(zip)
    })
  })
}

/**
 * Inspect ZIP central directory without extracting.
 * @returns {Promise<{ entries: Array<{ name: string, uncompressedSize: number, compressedSize: number, isDirectory: boolean, isSymlink: boolean }>, errors: string[] }>}
 */
export async function inspectZipCentralDirectory(zipPath, limits = ZIP_LIMITS) {
  if (!existsSync(zipPath)) {
    throw new Error(`zip not found: ${zipPath}`)
  }
  const zip = await openZip(zipPath)
  const entries = []
  const errors = []
  const seenExact = new Set()
  const seenCi = new Map()

  await new Promise((resolve, reject) => {
    zip.readEntry()
    zip.on('entry', (entry) => {
      const name = entry.fileName
      const nameErr = validateZipEntryName(name)
      if (nameErr) errors.push(`${nameErr}: ${JSON.stringify(name)}`)

      const isDirectory = /\/$/.test(name)
      // ZIP external attrs: high bit of unix mode in upper 16 bits when made by Unix.
      const external = entry.externalFileAttributes >>> 16
      const isSymlink = (external & 0o170000) === 0o120000
      if (isSymlink) errors.push(`symlink entry forbidden: ${name}`)
      // General purpose bit 0 = encrypted
      if (entry.generalPurposeBitFlag & 0x1) {
        errors.push(`encrypted entry forbidden: ${name}`)
      }

      if (!isDirectory) {
        if (seenExact.has(name)) errors.push(`duplicate entry: ${name}`)
        seenExact.add(name)
        const lower = name.toLowerCase()
        if (seenCi.has(lower) && seenCi.get(lower) !== name) {
          errors.push(`case-insensitive conflicting entries: ${seenCi.get(lower)} vs ${name}`)
        }
        seenCi.set(lower, name)

        if (entry.uncompressedSize > limits.maxEntryUncompressedBytes) {
          errors.push(`entry too large uncompressed: ${name} (${entry.uncompressedSize})`)
        }
        if (
          entry.compressedSize > 64
          && entry.uncompressedSize > 0
          && entry.compressedSize / entry.uncompressedSize < limits.minCompressionRatio
        ) {
          errors.push(`suspicious compression ratio: ${name}`)
        }
      }

      entries.push({
        name,
        uncompressedSize: entry.uncompressedSize,
        compressedSize: entry.compressedSize,
        isDirectory,
        isSymlink,
      })

      if (entries.length > limits.maxEntries) {
        errors.push(`excessive entry count (>${limits.maxEntries})`)
        zip.close()
        resolve()
        return
      }
      zip.readEntry()
    })
    zip.on('end', () => {
      zip.close()
      resolve()
    })
    zip.on('error', (err) => {
      try {
        zip.close()
      } catch {
        // ignore
      }
      reject(err)
    })
  })

  const totalUncompressed = entries
    .filter((e) => !e.isDirectory)
    .reduce((sum, e) => sum + e.uncompressedSize, 0)
  if (totalUncompressed > limits.maxTotalUncompressedBytes) {
    errors.push(`total uncompressed size exceeds limit (${totalUncompressed})`)
  }

  return { entries, errors }
}

/**
 * Extract ZIP to an isolated temp directory after central-directory validation.
 * @returns {Promise<{ extractDir: string, files: Record<string, Buffer>, errors: string[] }>}
 */
export async function extractZipToTemp(zipPath, limits = ZIP_LIMITS) {
  const { entries, errors } = await inspectZipCentralDirectory(zipPath, limits)
  if (errors.length) {
    return { extractDir: '', files: {}, errors }
  }

  const extractDir = mkdtempSync(join(tmpdir(), 'sp-zip-extract-'))
  const files = {}
  const zip = await openZip(zipPath)

  try {
    await new Promise((resolve, reject) => {
      zip.readEntry()
      zip.on('entry', (entry) => {
        const name = entry.fileName
        if (/\/$/.test(name)) {
          mkdirSync(join(extractDir, name), { recursive: true })
          zip.readEntry()
          return
        }
        zip.openReadStream(entry, (err, readStream) => {
          if (err) {
            reject(err)
            return
          }
          const dest = join(extractDir, name)
          mkdirSync(dirname(dest), { recursive: true })
          const chunks = []
          readStream.on('data', (c) => chunks.push(c))
          readStream.on('error', reject)
          readStream.on('end', () => {
            const buf = Buffer.concat(chunks)
            if (entry.uncompressedSize > 0 && buf.length !== entry.uncompressedSize) {
              reject(
                new Error(
                  `declared uncompressed-size mismatch: ${name} declared=${entry.uncompressedSize} actual=${buf.length}`,
                ),
              )
              return
            }
            files[name] = buf
            const out = createWriteStream(dest)
            out.end(buf)
            out.on('finish', () => zip.readEntry())
            out.on('error', reject)
          })
        })
      })
      zip.on('end', () => {
        zip.close()
        resolve()
      })
      zip.on('error', (err) => {
        try {
          zip.close()
        } catch {
          // ignore close errors during rejection
        }
        reject(err)
      })
    })
  } catch (err) {
    try {
      zip.close()
    } catch {
      // ignore
    }
    rmSync(extractDir, { recursive: true, force: true })
    throw err
  }

  return { extractDir, files, errors: [] }
}

export function sha256Buffer(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * Compare extracted archive bytes to expected dist files (relative paths).
 */
export function compareExtractedToDist(files, distDir) {
  const errors = []
  const expected = []
  function walk(dir, base = distDir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full, base)
      else {
        const rel = relative(base, full).split(sep).join('/')
        expected.push(rel)
      }
    }
  }
  if (existsSync(distDir)) walk(distDir)
  expected.sort((a, b) => a.localeCompare(b))

  const actual = Object.keys(files)
    .filter((n) => !n.endsWith('/'))
    .sort((a, b) => a.localeCompare(b))

  const expectedSet = new Set(expected)
  const actualSet = new Set(actual)
  for (const rel of expected) {
    if (!actualSet.has(rel)) errors.push(`missing zip entry vs dist: ${rel}`)
  }
  for (const rel of actual) {
    if (!expectedSet.has(rel)) errors.push(`unexpected zip entry vs dist: ${rel}`)
  }
  for (const rel of actual) {
    if (!expectedSet.has(rel)) continue
    const distBuf = readFileSync(join(distDir, rel))
    const zipBuf = files[rel]
    if (!distBuf.equals(zipBuf)) {
      errors.push(
        `byte mismatch for ${rel}: dist=${sha256Buffer(distBuf)} zip=${sha256Buffer(zipBuf)}`,
      )
    }
  }
  return { ok: errors.length === 0, errors, expected, actual }
}

export function cleanupExtractDir(extractDir) {
  if (extractDir && existsSync(extractDir)) {
    rmSync(extractDir, { recursive: true, force: true })
  }
}
