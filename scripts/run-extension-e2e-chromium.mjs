import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const browser = String(process.argv[2] ?? '').trim().toLowerCase()
if (browser !== 'chrome' && browser !== 'brave') {
  throw new Error('Usage: node scripts/run-extension-e2e-chromium.mjs chrome|brave')
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function braveBinary() {
  if (process.env.BRAVE_BINARY?.trim()) return process.env.BRAVE_BINARY.trim()
  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.PROGRAMFILES ?? '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(process.env['PROGRAMFILES(X86)'] ?? '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(process.env.LOCALAPPDATA ?? '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ]
    return candidates.find(candidate => candidate && fs.existsSync(candidate))
  }
  for (const candidate of ['/usr/bin/brave-browser', '/usr/bin/brave']) {
    if (fs.existsSync(candidate)) return candidate
  }
  return undefined
}

run('npm', ['run', 'package:cws'])

const browserEnv = { ...process.env }
if (browser === 'chrome') {
  browserEnv.PULSE_EXTENSION_BROWSER_CHANNEL = 'chrome'
} else {
  const executablePath = braveBinary()
  if (!executablePath) throw new Error('Brave browser is not installed; set BRAVE_BINARY to its executable path')
  browserEnv.PULSE_EXTENSION_BROWSER_EXECUTABLE_PATH = executablePath
}

run(
  'npx',
  [
    'playwright',
    'test',
    'tests/e2e/specs/quality.mocked.spec.ts',
    '--project=extension-mocked',
    '--grep',
    process.platform === 'win32'
      ? '"packaged shared settings host|no uncaught page or service-worker errors on live-ready path"'
      : 'packaged shared settings host|no uncaught page or service-worker errors on live-ready path',
  ],
  browserEnv,
)
