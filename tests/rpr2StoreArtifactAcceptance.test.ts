import { describe, expect, it } from 'vitest'
import { unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import yazl from 'yazl'
import {
  inspectZipCentralDirectory,
  validateZipEntryName,
  extractZipToTemp,
  cleanupExtractDir,
} from '../scripts/zip-byte-validate.mjs'
import { scanRemoteCodePatterns } from '../scripts/remote-code-scan.mjs'
import { targetArtifactNames } from '../scripts/extension-package-lib.mjs'
import { findSiblingFileDependencies } from '../scripts/check-public-source-readiness.mjs'
import {
  findForbiddenBackendUrlHits,
  isForbiddenBackendHostname,
  countBareLocalhostSentinel,
} from '../streampulse-web/scripts/check-backend-url.mjs'

async function writeZipAsync(path, entries) {
  const { createWriteStream } = await import('node:fs')
  await new Promise((resolve, reject) => {
    const zipfile = new yazl.ZipFile()
    for (const [name, content] of Object.entries(entries)) {
      zipfile.addBuffer(Buffer.from(content), name)
    }
    zipfile.outputStream.pipe(createWriteStream(path)).on('close', resolve).on('error', reject)
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
    const path = join(tmpdir(), `sp-mal-dup-${process.pid}.zip`)
    await writeZipAsync(path, { 'manifest.json': '{}', 'Manifest.json': '{}' })
    const { errors } = await inspectZipCentralDirectory(path)
    expect(errors.some((e) => /case-insensitive|duplicate/i.test(e))).toBe(true)
    unlinkSync(path)
  })

  it('extracts clean zip', async () => {
    const path = join(tmpdir(), `sp-clean-${process.pid}.zip`)
    await writeZipAsync(path, { 'hello.txt': 'hi' })
    const { extractDir, files, errors } = await extractZipToTemp(path)
    expect(errors).toEqual([])
    expect(files['hello.txt'].toString()).toBe('hi')
    cleanupExtractDir(extractDir)
    unlinkSync(path)
  })
})

describe('remote code scan', () => {
  it('flags eval and new Function; allows fetch to HTTPS API', () => {
    expect(scanRemoteCodePatterns('eval("x")').ok).toBe(false)
    expect(scanRemoteCodePatterns('new Function("return 1")').ok).toBe(false)
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
  it('reports sibling file: deps without claiming RPR-2 solved them', () => {
    const hits = findSiblingFileDependencies({
      dependencies: {
        '@streampulse/pulse-core': 'file:../streampulse-backend/packages/pulse-core',
      },
    })
    expect(hits.length).toBe(1)
    expect(hits[0].spec).toContain('file:../')
  })
})

describe('portal local-origin scanner', () => {
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

  it('finds ported localhost URLs', () => {
    const hits = findForbiddenBackendUrlHits(
      'const a="http://localhost:8081/v1"; const b="http://127.0.0.1/"; const c="http://localhost"',
    )
    expect(hits.some((h) => h.includes('8081'))).toBe(true)
    expect(hits.some((h) => h.includes('127.0.0.1'))).toBe(true)
    expect(countBareLocalhostSentinel('xxhttp://localhostyy')).toBe(1)
  })
})
