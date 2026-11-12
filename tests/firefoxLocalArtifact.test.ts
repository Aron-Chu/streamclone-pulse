import { describe, expect, it } from 'vitest'
import { verifyBuildProvenance } from '../scripts/lib/firefox-local-artifact.mjs'

const head = '2e374f22f95b83041095e621c3462238b48cc522'
const buildId = 'dev-2e374f22f95b-clean'
const good = () => ({
  head,
  metadata: { buildId },
  inputState: { dirty: false, digest: 'a'.repeat(64) },
  distHashes: { 'manifest.json': 'b'.repeat(64) },
  provenance: { packageBuildCommit: head, inputStatusDigest: 'a'.repeat(64), worktreeState: 'clean', buildId, files: { 'manifest.json': 'b'.repeat(64) } },
})

describe('local Firefox artifact build provenance', () => {
  it('accepts unchanged build-time source and bytes', () => {
    expect(() => verifyBuildProvenance(good())).not.toThrow()
  })
  it('rejects an old build on a newer checkout before restamping it', () => {
    expect(() => verifyBuildProvenance({ ...good(), head: 'f'.repeat(40) })).toThrow('source revision')
  })
  it('rejects changed inputs even when the revision is unchanged', () => {
    expect(() => verifyBuildProvenance({ ...good(), inputState: { dirty: true, digest: 'c'.repeat(64) } })).toThrow('inputs changed')
  })
  it('rejects edited dist bytes', () => {
    expect(() => verifyBuildProvenance({ ...good(), distHashes: { 'manifest.json': 'd'.repeat(64) } })).toThrow('Dist bytes')
  })
  it('rejects metadata with the wrong compiled marker', () => {
    expect(() => verifyBuildProvenance({ ...good(), metadata: { buildId: 'dev-ffffffffffff-clean' } })).toThrow('Build marker')
  })
  it('accepts a fresh dirty Vite marker without equating its digest to the build-input digest', () => {
    const artifact = good()
    artifact.metadata.buildId = 'dev-2e374f22f95b-dirty-12345678'
    artifact.provenance.buildId = artifact.metadata.buildId
    expect(() => verifyBuildProvenance(artifact)).not.toThrow()
  })
})
