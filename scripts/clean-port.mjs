#!/usr/bin/env node
/**
 * Kill any process listening on a port (default 5173) before starting the dev server.
 * Guards against a zombie/leftover Vite on 5173 silently hijacking `npm run dev`
 * (which would otherwise auto-increment to a different port and confuse agents).
 *
 * Usage: node scripts/clean-port.mjs [port]
 *
 * Detection is run from the *Windows* side via PowerShell (Get-NetTCPConnection +
 * Stop-Process) when node is inside WSL pointing at a Windows port; falls back to
 * POSIX lsof/fuser for native-Linux flows. This is required because WSL `netstat`
 * lists Windows listeners but does not expose their PIDs.
 */
import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';

const port = Number(process.argv[2] ?? 5173);
const isWindows = platform === 'win32';

/** Windows: use PowerShell Get-NetTCPConnection to resolve PID-by-port. */
function windowsPidsOnPort() {
  const ps = [
    'Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue',
    `Where-Object { $_.LocalPort -eq ${port} }`,
    'Select-Object -ExpandProperty OwningProcess',
    'Sort-Object -Unique',
    'ForEach-Object { Write-Output ($_) }',
  ].join(' | ');
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], {
      encoding: 'utf8',
    });
    return out
      .split(/\r?\n/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);
  } catch {
    return [];
  }
}

/** POSIX: lsof / fuser. */
function posixPidsOnPort() {
  const pids = new Set();
  for (const cmd of [
    `lsof -ti tcp:${port} -sTCP:LISTEN`,
    `fuser ${port}/tcp 2>/dev/null`,
  ]) {
    try {
      const out = execFileSync('sh', ['-c', cmd], { encoding: 'utf8' });
      for (const pid of out.trim().split(/\s+/)) {
        const n = Number(pid);
        if (Number.isInteger(n) && n > 0) pids.add(n);
      }
    } catch {
      // command not found or nothing matched — continue
    }
  }
  return [...pids];
}

function killPid(pid) {
  try {
    if (isWindows) {
      execFileSync('taskkill', ['/PID', String(pid), '/F', '/T'], { stdio: 'ignore' });
    } else {
      execFileSync('kill', ['-9', String(pid)], { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

const pids = isWindows ? windowsPidsOnPort() : posixPidsOnPort();

if (pids.length === 0) {
  console.log(`[clean-port] port ${port} is free — starting clean.`);
  process.exit(0);
}

console.log(`[clean-port] freeing port ${port}: killing ${pids.join(', ')}`);
const killed = pids.filter(killPid);
console.log(`[clean-port] killed ${killed.length}/${pids.length} pid(s) on :${port}.`);
process.exit(0);
