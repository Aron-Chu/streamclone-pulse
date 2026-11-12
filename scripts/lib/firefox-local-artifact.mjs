import assert from 'node:assert/strict'

/** Verify build-time evidence before a packager can refresh its file inventory. */
export function verifyBuildProvenance({ metadata, provenance, head, inputState, distHashes }) {
  assert.match(head, /^[a-f0-9]{40}$/)
  assert.equal(provenance.packageBuildCommit, head, 'Build-time source revision differs from checkout')
  assert.equal(provenance.inputStatusDigest, inputState.digest, 'Build inputs changed since compilation')
  assert.equal(provenance.worktreeState, inputState.dirty ? 'dirty' : 'clean', 'Build input state changed')
  // Vite's build marker uses the whole worktree, while inputState tracks only
  // compilation inputs. Do not invent a digest equivalence between the two.
  assert.match(metadata.buildId, new RegExp(`^dev-${head.slice(0, 12)}-(?:clean|dirty-[a-f0-9]{8})$`), 'Build marker differs from source revision')
  assert.equal(provenance.buildId, metadata.buildId, 'Build-time marker differs from dist')
  assert.deepEqual(distHashes, provenance.files, 'Dist bytes differ from build-time provenance')
}
