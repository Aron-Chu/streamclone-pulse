/**
 * Build a filtered extension zip for the selected target.
 * Usage:
 *   EXTENSION_TARGET=cws node scripts/zip-dist.mjs
 *   node scripts/zip-dist.mjs --target=edge
 */
import { existsSync, unlinkSync, writeFileSync, mkdirSync, copyFileSync, rmSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import {
  compareZipEntriesToExpected,
  listPackableDistFiles,
  listZipEntries,
  sha256File,
  targetArtifactNames,
} from './extension-package-lib.mjs'
import { resolveExtensionTarget } from './extension-target.mjs'

function parseTargetArg(argv = process.argv.slice(2)) {
  const idx = argv.findIndex((a) => a === '--target' || a.startsWith('--target='))
  if (idx < 0) return resolveExtensionTarget(process.env.EXTENSION_TARGET)
  const raw = argv[idx].startsWith('--target=') ? argv[idx].slice('--target='.length) : argv[idx + 1]
  return resolveExtensionTarget(raw)
}

const dist = join(process.cwd(), 'dist')
const target = parseTargetArg()
const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'))
const names = targetArtifactNames(target, manifest.version)
const zipPath = join(process.cwd(), names.zipName)

function zipWithInfoZip(files) {
  const args = ['-X', '-q', zipPath, ...files]
  const result = spawnSync('zip', args, { cwd: dist, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`zip exited with code ${result.status ?? 'unknown'}: ${result.stderr || ''}`)
  }
}

function zipWithTar(files) {
  const args = ['-a', '-cf', names.zipName, '-C', dist, ...files]
  const result = spawnSync('tar', args, { cwd: process.cwd(), encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`tar zip exited with code ${result.status ?? 'unknown'}: ${result.stderr || ''}`)
  }
}

function zipWithDotNetFiltered(files) {
  const listPath = join(tmpdir(), `sp-zip-files-${process.pid}.txt`)
  writeFileSync(listPath, files.join('\n'), 'utf8')
  const distEsc = dist.replace(/'/g, "''")
  const zipEsc = zipPath.replace(/'/g, "''")
  const listEsc = listPath.replace(/'/g, "''")
  const ps = `
    $ErrorActionPreference = 'Stop'
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $dist = '${distEsc}'
    $zipPath = '${zipEsc}'
    $listPath = '${listEsc}'
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    $files = Get-Content -LiteralPath $listPath | Where-Object { $_ -and $_.Trim() -ne '' }
    if (-not $files -or $files.Count -eq 0) { throw 'filtered file list is empty' }
    $zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
      foreach ($rel in $files) {
        $relNorm = ($rel -replace '\\\\','/').TrimStart('/')
        $src = Join-Path $dist (($relNorm -replace '/','\\'))
        if (-not (Test-Path -LiteralPath $src)) { throw "missing source file: $relNorm" }
        $entry = $zip.CreateEntry($relNorm, [System.IO.Compression.CompressionLevel]::Optimal)
        $inStream = [System.IO.File]::OpenRead($src)
        $outStream = $entry.Open()
        try {
          $inStream.CopyTo($outStream)
        } finally {
          $outStream.Dispose()
          $inStream.Dispose()
        }
      }
    } finally {
      $zip.Dispose()
    }
  `
  const result = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' })
  try {
    unlinkSync(listPath)
  } catch {
    // ignore
  }
  if (result.status !== 0) {
    throw new Error(
      `ZipArchive creation failed (status ${result.status ?? 'unknown'}): ${result.stderr || result.stdout || ''}`,
    )
  }
}

function zipViaStagingDir(files) {
  const stage = join(tmpdir(), `sp-zip-stage-${process.pid}`)
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })
  for (const rel of files) {
    const src = join(dist, rel)
    const dest = join(stage, rel)
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(src, dest)
  }
  const tarProbe = spawnSync('tar', ['--version'], { encoding: 'utf8' })
  if (tarProbe.status === 0) {
    const result = spawnSync('tar', ['-a', '-cf', names.zipName, '-C', stage, ...files], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    rmSync(stage, { recursive: true, force: true })
    if (result.status !== 0) {
      throw new Error(`staged tar zip failed: ${result.stderr || result.status}`)
    }
    return
  }
  rmSync(stage, { recursive: true, force: true })
  throw new Error('No zip tool available for filtered packaging')
}

function createZip(files) {
  const zipProbe = spawnSync('zip', ['-v'], { encoding: 'utf8' })
  if (zipProbe.status === 0) {
    zipWithInfoZip(files)
    return 'info-zip'
  }
  if (process.platform === 'win32') {
    zipWithDotNetFiltered(files)
    return 'dotnet-ZipArchive'
  }
  const tarProbe = spawnSync('tar', ['--version'], { encoding: 'utf8' })
  if (tarProbe.status === 0) {
    zipWithTar(files)
    return 'tar'
  }
  zipViaStagingDir(files)
  return 'staged-fallback'
}

async function assertZipMatchesExpected(files) {
  const { entries, method } = await listZipEntries(zipPath)
  const comparison = compareZipEntriesToExpected(entries, files)
  if (!comparison.ok) {
    throw new Error(
      `zip entry validation failed (via ${method}):\n${comparison.errors.join('\n')}`,
    )
  }
  return { entries: comparison.actual, method }
}

async function main() {
  if (!existsSync(join(dist, 'manifest.json'))) {
    throw new Error('dist/manifest.json missing — run a target-aware build first')
  }

  const targetMetaPath = join(dist, 'extension-target.json')
  if (existsSync(targetMetaPath)) {
    const meta = JSON.parse(readFileSync(targetMetaPath, 'utf8'))
    if (meta.target !== target) {
      throw new Error(
        `dist target ${JSON.stringify(meta.target)} != zip target ${target}; refuse mismatched packaging`,
      )
    }
  }

  const files = listPackableDistFiles(dist).filter((f) => f !== 'extension-target.json')
  if (files.length === 0) {
    throw new Error('dist/ contains no packable files')
  }

  if (existsSync(zipPath)) {
    unlinkSync(zipPath)
  }

  const tool = createZip(files)
  const { entries, method } = await assertZipMatchesExpected(files)

  const digest = sha256File(zipPath)
  const checksumPath = join(process.cwd(), names.checksumName)
  writeFileSync(checksumPath, `${digest}  ${names.zipName}\n`, 'utf8')

  console.log(`Wrote ${zipPath} (target=${target}, ${files.length} files) via ${tool}`)
  console.log(`Inspected ${entries.length} entries via ${method}`)
  console.log(`SHA-256 ${digest}`)
  console.log(`Checksum ${checksumPath}`)
  console.log(
    'Note: lexical entry order is enforced; byte-identical zips across OS/tools are not guaranteed.',
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
