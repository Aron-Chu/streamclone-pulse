/**
 * Validate the trusted source claims emitted by `gh attestation verify --format json`.
 * The GitHub CLI performs signature, subject, ref, and digest verification; this
 * validator makes the source binding explicit in retained release evidence.
 *
 * Usage: node scripts/verify-release-attestation.mjs <verification.json> <ref> <sha> <subject>
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'

function fail(message) {
  throw new Error(`verify-release-attestation: ${message}`)
}

/**
 * @param {unknown} evidence
 * @param {string} expectedRef
 * @param {string} expectedSha
 * @param {string} subjectPath
 */
export function validateAttestationEvidence(evidence, expectedRef, expectedSha, subjectPath) {
  if (!/^refs\/tags\/v[0-9]+\.[0-9]+\.[0-9]+$/.test(expectedRef)) {
    fail(`expected ref is not an exact version tag: ${expectedRef}`)
  }
  if (!/^[0-9a-f]{40}$/i.test(expectedSha)) {
    fail(`expected source digest is not a full commit SHA: ${expectedSha}`)
  }

  if (!Array.isArray(evidence) || evidence.length === 0) {
    fail('verification output must be a non-empty JSON array')
  }

  const expectedDigest = expectedSha.toLowerCase()
  const expectedSubject = basename(subjectPath)
  for (const [index, item] of evidence.entries()) {
    const certificate = item?.verificationResult?.signature?.certificate
    if (!certificate || typeof certificate !== 'object') {
      fail(`entry ${index} has no verified signature certificate`)
    }
    if (certificate.sourceRepositoryRef !== expectedRef) {
      fail(
        `entry ${index} source ref ${certificate.sourceRepositoryRef ?? '<missing>'} does not match ${expectedRef}`,
      )
    }
    if (String(certificate.sourceRepositoryDigest ?? '').toLowerCase() !== expectedDigest) {
      fail(
        `entry ${index} source digest ${certificate.sourceRepositoryDigest ?? '<missing>'} does not match ${expectedSha}`,
      )
    }

    const subjects = item?.verificationResult?.statement?.subject
    if (!Array.isArray(subjects) || !subjects.some((subject) => basename(String(subject?.name ?? '')) === expectedSubject)) {
      fail(`entry ${index} does not name subject ${expectedSubject}`)
    }
  }

  console.log(`verified ${expectedSubject}: ${expectedRef} @ ${expectedSha}`)
}

function main() {
  const [, , evidencePath, expectedRef, expectedSha, subjectPath] = process.argv
  if (!evidencePath || !expectedRef || !expectedSha || !subjectPath) {
    console.error('usage: verify-release-attestation.mjs <verification.json> <ref> <sha> <subject>')
    process.exitCode = 2
    return
  }
  let evidence
  try {
    evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
  } catch (error) {
    fail(`could not parse ${evidencePath}: ${error.message}`)
  }
  validateAttestationEvidence(evidence, expectedRef, expectedSha, subjectPath)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
