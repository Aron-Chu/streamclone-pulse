#!/usr/bin/env node
/**
 * Classify changed paths for CI (GitHub Actions entrypoint).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import {
  classifyChangedPaths,
  formatGithubOutput,
  pathsFromDiffNameStatus,
} from './ci-change-classifier.mjs'

function usage() {
  console.error(`Usage:
  node scripts/ci-classify-changes.mjs --base <sha> --head <sha> [--force-full]
  node scripts/ci-classify-changes.mjs --paths-file <file> [--force-full]
`)
}

function gitDiffNameStatus(base, head) {
  const r = spawnSync('git', ['diff', '--name-status', '-M', `${base}...${head}`], {
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    console.error('git diff failed — fail-safe full classification')
    console.error(r.stderr || r.stdout || '')
    return null
  }
  return r.stdout
}

function writeOutput(result, outDir) {
  mkdirSync(outDir, { recursive: true })
  const jsonPath = `${outDir}/classification.json`
  writeFileSync(jsonPath, JSON.stringify(result, null, 2) + '\n', 'utf8')
  const gh = process.env.GITHUB_OUTPUT
  if (gh) {
    writeFileSync(gh, formatGithubOutput(result) + '\n', { flag: 'a' })
  }
  console.log(formatGithubOutput(result))
  console.log(`wrote ${jsonPath}`)
}

function failSafe(reason) {
  return {
    classification: 'unknown',
    run_extension: true,
    run_portal: true,
    run_e2e: true,
    run_portal_e2e: true,
    force_full: false,
    reason,
    paths: [],
  }
}

function main(argv) {
  const args = [...argv]
  let base = ''
  let head = ''
  let pathsFile = ''
  let forceFull = false
  let outDir = 'ci-classification'

  while (args.length) {
    const a = args.shift()
    if (a === '--base') base = args.shift() || ''
    else if (a === '--head') head = args.shift() || ''
    else if (a === '--paths-file') pathsFile = args.shift() || ''
    else if (a === '--force-full') forceFull = true
    else if (a === '--out-dir') outDir = args.shift() || outDir
    else if (a === '--help' || a === '-h') {
      usage()
      process.exit(0)
    } else {
      console.error(`unknown arg ${a}`)
      usage()
      process.exit(2)
    }
  }

  if (process.env.INPUT_FORCE_FULL === 'true' || process.env.FORCE_FULL === 'true') {
    forceFull = true
  }

  if (forceFull && !pathsFile && !(base && head)) {
    writeOutput(classifyChangedPaths([], { forceFull: true }), outDir)
    return
  }

  let paths = []
  if (pathsFile) {
    paths = pathsFromDiffNameStatus(readFileSync(pathsFile, 'utf8'))
  } else if (base && head) {
    if (!/^[0-9a-f]{7,40}$/i.test(base) || !/^[0-9a-f]{7,40}$/i.test(head)) {
      writeOutput(failSafe('invalid or missing SHA — fail-safe full graph'), outDir)
      return
    }
    const diff = gitDiffNameStatus(base, head)
    if (diff === null) {
      writeOutput(failSafe('git diff failed — fail-safe full graph'), outDir)
      return
    }
    paths = pathsFromDiffNameStatus(diff)
  } else {
    usage()
    process.exit(2)
  }

  writeOutput(classifyChangedPaths(paths, { forceFull }), outDir)
}

main(process.argv.slice(2))
