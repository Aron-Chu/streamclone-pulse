/**
 * Report sibling `file:` package dependencies as an RPR-6 blocker.
 * This is intentionally separate from RPR-2 ZIP artifact hygiene.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export function findSiblingFileDependencies(pkgJson = null) {
  const pkg = pkgJson ?? JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const hits = []
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const block = pkg[section] ?? {}
    for (const [name, spec] of Object.entries(block)) {
      const value = String(spec ?? '')
      if (value.startsWith('file:') && (value.includes('..') || value.includes('streampulse-backend'))) {
        hits.push({ section, name, spec: value })
      }
    }
  }
  return hits
}

function main() {
  const hits = findSiblingFileDependencies()
  if (hits.length === 0) {
    console.log('check-public-source-readiness: ok (no sibling file: deps)')
    return
  }
  console.log('check-public-source-readiness: RPR-6 blocker — sibling file: dependencies remain:')
  for (const hit of hits) {
    console.log(`  ${hit.section} ${hit.name}=${hit.spec}`)
  }
  console.log(
    'RPR-2 artifact validation does not claim to solve the RPR-6 clean-source / public package boundary.',
  )
  // Non-zero so CI surfaces the debt, but packaging scripts call this as advisory.
  process.exitCode = 2
}

const entry = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : ''
if (entry.endsWith('check-public-source-readiness.mjs')) {
  main()
}
