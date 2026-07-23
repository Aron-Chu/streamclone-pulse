/**
 * Build a CWS zip from the filtered dist file set.
 * Valid plain JavaScript — must pass: node --check scripts/zip-dist.mjs
 *
 * Determinism: lexical file order is enforced. Byte-identical archives across
 * OS/tools are not guaranteed (timestamps/extra fields may differ).
 */
import { existsSync, unlinkSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import {
  ZIP_NAME,
  compareZipEntriesToExpected,
  listPackableDistFiles,
  listZipEntries,
  sha256File,
} from './extension-package-lib.mjs'

const dist = join(process.cwd(), 'dist')
const zipPath = join(process.cwd(), ZIP_NAME)

function zipWithInfoZip(files) {
  const args = ['-X', '-q', zipPath, ...files]
  const result = spawnSync('zip', args, { cwd: dist, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`zip exited with code ${result.status ?? 'unknown'}: ${result.stderr || ''}`)
  }
}

function zipWithTar(files) {
  // Windows tar treats an absolute `C:\...` archive path as a remote host.
  // Write from the repository root so the archive target is relative.
  const args = ['-a', '-cf', ZIP_NAME, '-C', dist, ...files]
  const result = spawnSync('tar', args, { cwd: process.cwd(), encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`tar zip exited with code ${result.status ?? 'unknown'}: ${result.stderr || ''}`)
  }
}

/**
 * Windows fallback: .NET ZipArchive from the explicit filtered relative paths.
 * Does not archive dist/* blindly.
 */
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

/**
 * Last-resort portable path: stage only filtered files, then tar/zip the stage.
 * Still uses the filtered list — never copies skipped files.
 */
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
    const result = spawnSync('tar', ['-a', '-cf', ZIP_NAME, '-C', stage, ...files], {
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

function assertZipMatchesExpected(files) {
  const { entries, method } = listZipEntries(zipPath)
  const comparison = compareZipEntriesToExpected(entries, files)
  if (!comparison.ok) {
    throw new Error(
      `zip entry validation failed (via ${method}):\n${comparison.errors.join('\n')}`,
    )
  }
  return { entries: comparison.actual, method }
}

function main() {
  if (!existsSync(join(dist, 'manifest.json'))) {
    throw new Error('dist/manifest.json missing — run `npm run build` first')
  }

  const files = listPackableDistFiles(dist)
  if (files.length === 0) {
    throw new Error('dist/ contains no packable files')
  }

  if (existsSync(zipPath)) {
    unlinkSync(zipPath)
  }

  const tool = createZip(files)
  const { entries, method } = assertZipMatchesExpected(files)

  const digest = sha256File(zipPath)
  const checksumPath = `${zipPath}.sha256`
  writeFileSync(checksumPath, `${digest}  ${ZIP_NAME}\n`, 'utf8')

  console.log(`Wrote ${zipPath} (${files.length} files) via ${tool}`)
  console.log(`Inspected ${entries.length} entries via ${method}`)
  console.log(`SHA-256 ${digest}`)
  console.log(`Checksum ${checksumPath}`)
  console.log(
    'Note: lexical entry order is enforced; byte-identical zips across OS/tools are not guaranteed.',
  )
}

main()
