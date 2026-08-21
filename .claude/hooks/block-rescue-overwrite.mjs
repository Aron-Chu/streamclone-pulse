#!/usr/bin/env node
// Block recursive bulk file copy from untrusted rescue directories into the repo.
// Whitelist explicit per-file copies; deny wildcards and recursive copies.
//
// Why: in August 2026 a session-context injection described a long prior session
// with chart zoom, hover-only game dividers, mutation filter, etc. None of that
// work was in git; it survived only as an editor buffer that was preserved to
// /mnt/c/Users/Aron/pulse-history-rescue/. An agent following unverified
// instructions nearly ran `cp` of 27+ files at once without per-step verification.
// This hook is the safety net.

import { execSync } from 'node:child_process'

const RESCUE_PATHS = [
  '/mnt/c/Users/Aron/pulse-history-rescue/',
  'C:\\Users\\Aron\\pulse-history-rescue\\',
]

const REPO_ROOT = '/mnt/c/Users/Aron/streamclone-pulse'

function readStdin() {
  return new Promise(resolve => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => { data += chunk })
    process.stdin.on('end', () => resolve(data))
  })
}

async function main() {
  const raw = await readStdin()
  if (!raw.trim()) {
    process.exit(0)
  }

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    process.exit(0)
  }

  const toolName = payload?.tool_name ?? ''
  if (toolName !== 'Bash') process.exit(0)

  const cmd = payload?.tool_input?.command ?? ''
  if (!cmd.trim()) process.exit(0)

  // Only flag operations that target the repo root.
  if (!cmd.includes(REPO_ROOT) && !cmd.match(/\/src\/|\/tests\/|\/streampulse-web\//)) {
    process.exit(0)
  }

  const lowered = cmd.toLowerCase()
  const isCopy = lowered.includes('cp ') || lowered.includes('robocopy') || lowered.includes('xcopy')
  // Tokenize flags as space-separated tokens (path components may legitimately contain
  // dashes — only flag *tokens* that are pure flag characters).
  const tokens = lowered.split(/\s+/)
  const isRecursive = tokens.some(t => /^(-r|-rf|-r |-r$|--recursive)$/.test(t) || t === '/e' || t === '/s')
  const targetsRescue = RESCUE_PATHS.some(p => cmd.includes(p))

  if (!(isCopy && targetsRescue)) process.exit(0)

  // Allow single-file explicit copies (each on its own line, no wildcards).
  // A `cp` line is allowed only when:
  //   1. It contains exactly one source and one destination path
  //   2. Neither path contains a wildcard (* ? [...])
  //   3. No `-r` / `--recursive` flag
  if (!isRecursive) {
    const lines = cmd.split(/\r?\n/)
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('cp ')) continue
      if (/[*?[\]]/.test(trimmed)) {
        deny('Wildcard in cp command is not allowed from a rescue directory.')
      }
      // Tokenize: cp [flags] SRC DEST
      const tokens = trimmed.split(/\s+/).slice(1)
      const sources = tokens.filter(t => RESCUE_PATHS.some(p => t.includes(p)))
      if (sources.length !== 1) {
        deny('Multi-source cp from a rescue directory is not allowed.')
      }
    }
    process.exit(0)
  }

  deny(
    'Recursive copy from /mnt/c/Users/Aron/pulse-history-rescue/ into the repo is blocked. ' +
    'Restore from this directory one file at a time, with explicit source + destination paths, ' +
    'after verifying each file exists and is the version you intend.'
  )
}

function deny(message) {
  const out = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: message,
    },
  }
  process.stdout.write(JSON.stringify(out))
  process.exit(0)
}

main().catch(err => {
  // Never crash a tool call; log and allow.
  process.stderr.write(`[block-rescue-overwrite] hook error: ${err.message}\n`)
  process.exit(0)
})
