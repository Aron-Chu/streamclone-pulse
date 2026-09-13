import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function assertEdgeFreeze(webRoot) {
  const workers = ['public/_worker.js', 'dist/_worker.js', 'functions'].filter(path => existsSync(join(webRoot, path)))
  if (workers.length) throw new Error(`EDGE_FREEZE_APPROVAL_REQUIRED: ${workers.join(', ')}. The private-beta policy excludes a Pages BFF. Review the narrow candidate and obtain a versioned policy exception before promotion.`)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { assertEdgeFreeze(join(dirname(fileURLToPath(import.meta.url)), '..')); console.log('edge freeze gate passed') }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
