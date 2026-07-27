#!/usr/bin/env node
/**
 * Final CI gate — validates classifier + job outcomes + E2E execution proofs.
 * Usage:
 *   node scripts/ci-final-gate.mjs \
 *     --guard success \
 *     --classification ci-classification/classification.json \
 *     --extension skipped \
 *     --portal success \
 *     --e2e-executed skipped \
 *     --portal-e2e-executed true
 */
import { readFileSync } from 'node:fs'
import { evaluateFinalGate } from './ci-change-classifier.mjs'

function main(argv) {
  const args = [...argv]
  let guard = ''
  let classificationPath = ''
  let extension = 'skipped'
  let portal = 'skipped'
  let e2eExecuted = ''
  let portalE2eExecuted = ''

  while (args.length) {
    const a = args.shift()
    if (a === '--guard') guard = args.shift() || ''
    else if (a === '--classification') classificationPath = args.shift() || ''
    else if (a === '--extension') extension = args.shift() || 'skipped'
    else if (a === '--portal') portal = args.shift() || 'skipped'
    else if (a === '--e2e-executed') e2eExecuted = args.shift() || ''
    else if (a === '--portal-e2e-executed') portalE2eExecuted = args.shift() || ''
    else {
      console.error(`unknown arg ${a}`)
      process.exit(2)
    }
  }

  let classification = null
  try {
    classification = JSON.parse(readFileSync(classificationPath, 'utf8'))
  } catch {
    classification = null
  }

  const result = evaluateFinalGate({
    guardResult: guard,
    classification,
    jobResults: { extension, portal },
    e2eExecuted: e2eExecuted === '' ? undefined : e2eExecuted,
    portalE2eExecuted: portalE2eExecuted === '' ? undefined : portalE2eExecuted,
  })

  if (!result.ok) {
    for (const e of result.errors) console.error(`final-gate: ${e}`)
    process.exit(1)
  }
  console.log('final-gate OK')
}

main(process.argv.slice(2))
