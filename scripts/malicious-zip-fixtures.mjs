/**
 * Build adversarial ZIP fixtures as raw bytes for validator tests.
 * Avoids yazl collapsing duplicates / lacking encrypted/symlink controls.
 */
import { writeFileSync } from 'node:fs'

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
  }
  return ~c >>> 0
}

function u16(n) {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n, 0)
  return b
}

function u32(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n >>> 0, 0)
  return b
}

/**
 * @param {Array<{
 *   name: string,
 *   data?: Buffer,
 *   method?: number,
 *   gpFlag?: number,
 *   externalAttrs?: number,
 *   declaredUncompressed?: number,
 *   declaredCompressed?: number,
 * }>} entries
 */
export function buildRawZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = entry.data ?? Buffer.alloc(0)
    const method = entry.method ?? 0
    const gpFlag = entry.gpFlag ?? 0
    const externalAttrs = entry.externalAttrs ?? 0
    const compressed = entry.declaredCompressed ?? data.length
    const uncompressed = entry.declaredUncompressed ?? data.length
    const crc = crc32(data)

    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(gpFlag),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed),
      u32(uncompressed),
      u16(name.length),
      u16(0),
      name,
      data,
    ])
    localParts.push(local)

    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(gpFlag),
      u16(method),
      u16(0),
      u16(0),
      u32(crc),
      u32(compressed),
      u32(uncompressed),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(externalAttrs),
      u32(offset),
      name,
    ])
    centralParts.push(central)
    offset += local.length
  }

  const centralDir = Buffer.concat(centralParts)
  const localDir = Buffer.concat(localParts)
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDir.length),
    u32(localDir.length),
    u16(0),
  ])
  return Buffer.concat([localDir, centralDir, end])
}

export function writeRawZip(path, entries) {
  writeFileSync(path, buildRawZip(entries), { mode: 0o600 })
}

/** Unix symlink mode in upper 16 bits of external attrs. */
export const ZIP_UNIX_SYMLINK_ATTRS = (0o120777 << 16) >>> 0
