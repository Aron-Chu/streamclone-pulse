/**
 * Create a private temporary directory under os.tmpdir() via mkdtemp.
 * Prefer this over predictable join(tmpdir(), `name-${pid}`) paths.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * @param {string} prefix short prefix ending without separator (mkdtemp appends random)
 * @returns {string} absolute directory path
 */
export function makePrivateTempDir(prefix = 'sp-') {
  return mkdtempSync(join(tmpdir(), prefix.endsWith('-') ? prefix : `${prefix}-`))
}

/**
 * @param {string} dir
 * @param {string} name
 * @param {string | Buffer} data
 * @returns {string} absolute file path
 */
export function writePrivateTempFile(dir, name, data) {
  const path = join(dir, name)
  writeFileSync(path, data, { mode: 0o600 })
  return path
}
